const test = require("node:test");
const assert = require("node:assert/strict");
const { backtest } = require("../api/_lib");
const BacktestCache = require("../assets/backtest-cache.js");

// Response-contract guards: strategies= allowlist trimming, generatedAt
// removal and API determinism, and the front-end backtest cache module.

const ALL_KEYS = ["qqq", "tqqq", "blend8020", "signal", "signalQqq", "signalTqqq"];
const VISIBLE_KEYS = ["qqq", "signalQqq", "tqqq", "signalTqqq", "signal"];

test("no strategies parameter returns the full legacy strategy set", async () => {
  const result = await backtest({ start: "2015-01-01", cost: 5 });
  assert.deepEqual(result.strategies.map((strategy) => strategy.key), ALL_KEYS);
  assert(result.events.length > 0);
  for (const event of result.events) {
    const keys = event.strategies.map((strategy) => strategy.key);
    assert(keys.includes("qqq") && keys.includes("signal"), `event ${event.key} must keep qqq and signal`);
  }
  assert(!("generatedAt" in result), "response must not contain generatedAt");
});

test("legal strategies list trims top-level and nested event strategies; qqq/signal always included", async () => {
  const result = await backtest({ start: "2015-01-01", cost: 5, strategies: "signalQqq,tqqq" });
  const topKeys = result.strategies.map((strategy) => strategy.key).sort();
  assert.deepEqual(topKeys, ["qqq", "signal", "signalQqq", "tqqq"].sort(), "trimmed to the request plus mandatory qqq/signal");
  assert(result.events.length > 0);
  for (const event of result.events) {
    for (const strategy of event.strategies) {
      assert(["qqq", "signal", "signalQqq", "tqqq"].includes(strategy.key), `event ${event.key} leaked strategy ${strategy.key}`);
    }
    const keys = event.strategies.map((strategy) => strategy.key);
    assert(keys.includes("qqq") && keys.includes("signal"), `event ${event.key} lost mandatory qqq/signal`);
  }
});

test("visible five strategies list matches the front-end fixed request set", async () => {
  const result = await backtest({ start: "2015-01-01", cost: 5, strategies: VISIBLE_KEYS.join(",") });
  assert.deepEqual(result.strategies.map((strategy) => strategy.key).sort(), [...VISIBLE_KEYS].sort());
});

test("unknown strategy key returns a 400 HttpError", async () => {
  await assert.rejects(
    backtest({ start: "2015-01-01", cost: 5, strategies: "qqq,doge" }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert(error.message.includes("doge"));
      return true;
    },
  );
});

test("backtest response is deterministic: identical input serializes byte-identically twice", async () => {
  const params = { start: "1990-01-01", cost: 5 };
  const first = JSON.stringify(await backtest(params));
  const second = JSON.stringify(await backtest(params));
  assert.equal(first, second);
  const trimmedParams = { ...params, strategies: VISIBLE_KEYS.join(",") };
  const trimmedFirst = JSON.stringify(await backtest(trimmedParams));
  const trimmedSecond = JSON.stringify(await backtest(trimmedParams));
  assert.equal(trimmedFirst, trimmedSecond);
});

test("response-size effect of strategies trimming (measured, no threshold)", async () => {
  const full = JSON.stringify(await backtest({ start: "1990-01-01", cost: 5 }));
  const trimmed = JSON.stringify(await backtest({ start: "1990-01-01", cost: 5, strategies: VISIBLE_KEYS.join(",") }));
  console.log(`response size 1990-01-01: full ${full.length} bytes, trimmed ${trimmed.length} bytes, saved ${(100 * (1 - trimmed.length / full.length)).toFixed(1)}%`);
  assert(trimmed.length < full.length, "trimmed response must be smaller than the full one");
});

test("backtest cache module: second identical request does not re-fetch", async () => {
  const cache = BacktestCache.create();
  let fetches = 0;
  const stubFetch = async (url) => {
    fetches += 1;
    return { url };
  };
  const params = { start: "2020-01-01", cost: 5 };
  const first = await BacktestCache.fetchCached(cache, params, stubFetch);
  const second = await BacktestCache.fetchCached(cache, params, stubFetch);
  assert.equal(fetches, 1, "second identical {start, cost} request must not re-fetch");
  assert.equal(second, first, "cache hit must return the cached response object");
  assert(first.url.includes(`strategies=${BacktestCache.STRATEGIES_PARAM}`), "request URL must pin the five visible strategies");
  assert.equal(BacktestCache.normalizeKey({ start: "2020-01-01", cost: 5 }), BacktestCache.normalizeKey(params));
  // A different {start, cost} is a different cache entry.
  await BacktestCache.fetchCached(cache, { start: "2024-01-01", cost: 5 }, stubFetch);
  assert.equal(fetches, 2);
});

test("backtest cache module: failed requests are not cached; clear forces a re-fetch", async () => {
  const cache = BacktestCache.create();
  let fetches = 0;
  const params = { start: "2020-01-01", cost: 5 };
  await assert.rejects(BacktestCache.fetchCached(cache, params, async () => {
    fetches += 1;
    throw new Error("HTTP 502");
  }));
  assert.equal(cache.size, 0, "failed responses must never enter the cache");
  const ok = await BacktestCache.fetchCached(cache, params, async (url) => {
    fetches += 1;
    return { url };
  });
  assert.equal(fetches, 2, "the first success after a failure must re-fetch");
  await BacktestCache.fetchCached(cache, params, async () => ({ stale: true }));
  assert.equal(fetches, 2, "cache hit after success");
  BacktestCache.clear(cache);
  assert.equal(cache.size, 0, "manual refresh must clear the cache");
  const again = await BacktestCache.fetchCached(cache, params, async (url) => {
    fetches += 1;
    return { url };
  });
  assert.equal(fetches, 3, "after a manual-refresh clear the next request must re-fetch");
  assert(again.url === ok.url);
});
