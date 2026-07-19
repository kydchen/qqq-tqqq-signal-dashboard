const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPrices,
  buildStates,
  stateAt,
  capeSeriesForBacktest,
  loadSnapshotData,
  runBacktest,
  DEFAULT_THRESHOLDS,
} = require("../api/_lib");

// Guards the O(N) buildStates against the slow reference stateAt implementation.
// The full history is compared day by day, and every supported start/cost combo
// must produce identical action trajectories and final assets under both state
// series.

const VALID_STARTS = ["1990-01-01", "1995-01-01", "2000-01-01", "2005-01-01", "2010-01-01", "2010-02-11", "2015-01-01", "2020-01-01", "2023-01-01", "2024-01-01", "2025-01-01"];
const VALID_COSTS = [0, 5, 10];
const MONTHLY = 1000;

// The old quadratic buildStates, kept verbatim as the reference implementation.
function referenceBuildStates(prices, nasdaq, vix, capeChrono) {
  const capeCursor = { index: 0 };
  return prices.map((price, index) => (index < 30 ? null : stateAt(index, price, nasdaq, vix, capeChrono, capeCursor)));
}

const data = loadSnapshotData();
const prices = buildPrices(data.nasdaq, data.qqq, data.tqqq, data.rates);
data.prices = prices;
const capeChrono = capeSeriesForBacktest(data.capeLatestFirst).reverse();
const fastStates = buildStates(prices, data.nasdaq, data.vix, capeChrono);
const referenceStates = referenceBuildStates(prices, data.nasdaq, data.vix, capeChrono);

test("buildStates matches the slow reference day by day over the full history", () => {
  assert.equal(fastStates.length, prices.length);
  assert.equal(referenceStates.length, prices.length);
  for (let i = 0; i < prices.length; i += 1) {
    const fast = fastStates[i];
    const reference = referenceStates[i];
    if (i < 30) {
      assert.equal(fast, null, `day ${i} (${prices[i].date}) should be null before warmup`);
      assert.equal(reference, null);
      continue;
    }
    for (const field of ["capePercentile", "drawdownPct", "crash25dPct", "vix", "vixAvailable"]) {
      assert(
        Object.is(fast[field], reference[field]),
        `day ${i} (${prices[i].date}) ${field}: fast=${fast[field]} reference=${reference[field]}`,
      );
    }
  }
});

test("every start/cost combo produces identical trajectories and final assets", () => {
  for (const start of VALID_STARTS) {
    for (const cost of VALID_COSTS) {
      const fastRun = runBacktest(data, start, MONTHLY, DEFAULT_THRESHOLDS, fastStates, null, cost);
      const referenceRun = runBacktest(data, start, MONTHLY, DEFAULT_THRESHOLDS, referenceStates, null, cost);
      assert.deepEqual(fastRun, referenceRun, `${start} cost=${cost} backtest diverged`);
    }
  }
});

test("buildStates stays O(N) fast on the full snapshot history", () => {
  const started = performance.now();
  buildStates(prices, data.nasdaq, data.vix, capeChrono);
  const elapsedMs = performance.now() - started;
  // Expected ~50ms on a laptop; the gate keeps 20x headroom for slow CI hosts.
  assert(elapsedMs < 1000, `buildStates took ${elapsedMs.toFixed(1)}ms, expected well under 1000ms`);
});
