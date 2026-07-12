const crypto = require("crypto");

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";
const CAPE_URL = "https://www.multpl.com/shiller-pe/table/by-month";
const CACHE_MS = 15 * 60 * 1000;
const RULESET_ID = "2026-07-v5";
const VALID_STARTS = new Set(["1990-01-01", "1995-01-01", "2000-01-01", "2005-01-01", "2010-01-01", "2010-02-11", "2015-01-01", "2020-01-01", "2023-01-01", "2024-01-01", "2025-01-01"]);
const VALID_MONTHLY = new Set([1000]);
const VALID_COST_BPS = new Set([0, 5, 10]);
const DEFAULT_COST_BPS = 5;
const CORE_QQQ_HIGH_REGIME_FRACTION = 0.5;
const CAPE_ROLLING_MONTHS = 360;
const ROLLING_HIGH_DAYS = 252 * 5;
const QQQ_DIVIDEND_YIELD = 0.007;
const TQQQ_EXPENSE_RATIO = 0.0095;
const TQQQ_SWAP_SPREAD = 0.005;
const NDX_PERIOD1 = 497000000; // 1985-10; earliest Yahoo ^NDX range used by this app.
const VIX_PERIOD1 = 631152000; // 1990-01; UI start years intentionally do not go earlier.
const DEFAULT_THRESHOLDS = {
  // Rolling CAPE percentile. The old 20th-percentile bar never fired in
  // post-1985 monthly samples (min first-of-month percentile ~24), so cheap
  // valuation was a dead signal. 35 still only lights near crisis troughs.
  cheapCape: 35,
  // Soft valuation support when price is already deeply dislocated.
  supportCape: 50,
  supportDrawdown: -25,
  highCape: 70,
  bubbleCape: 85,
  deepDrawdown: -20,
  // Mild drawdown still counts as one low signal for small-dip buys.
  mildDrawdown: -12,
  fastCrash: -12,
  // VIX 40 only lit 8 first-of-month samples since 1985. 32 matches OOS-friendly
  // walk-forward picks and still excludes ordinary pullbacks.
  panicVix: 32,
  quietVix: 12,
};
const RISK_POLICIES = Object.freeze({
  conservative: Object.freeze({ maxTqqq: 0, normalTqqqFloor: 0, bottomTqqqTarget: 0, rampTqqqTarget: 0 }),
  standard: Object.freeze({ maxTqqq: 0.4, normalTqqqFloor: 0.1, bottomTqqqTarget: 0.25, rampTqqqTarget: 0.4 }),
  aggressive: Object.freeze({ maxTqqq: 0.9, normalTqqqFloor: 0.2, bottomTqqqTarget: 0.35, rampTqqqTarget: 0.9 }),
});
const ACTION_KEYS = ["bottomAttack", "rampTqqq", "smallDipBuy", "crashDefense", "trimHeat", "pauseAtHigh", "normalDca"];
const EVENT_WINDOWS = [
  { key: "dotcom", start: "2000-03-31", end: "2002-10-31" },
  { key: "gfc", start: "2007-10-31", end: "2009-03-31" },
  { key: "covid", start: "2020-02-29", end: "2020-04-30" },
  { key: "rate2022", start: "2021-11-30", end: "2022-12-31" },
  { key: "ai2023", start: "2023-01-31", end: "2024-12-31" },
  { key: "tariff2025", start: "2025-04-01", end: "2025-05-31" },
];

const sourceCache = {
  nasdaq: null,
  qqq: null,
  tqqq: null,
  vix: null,
  rates: null,
  capeLatestFirst: null,
};
let capeSnapshot = null;
const jsonSnapshots = {};

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJson(res, status, payload, options = {}) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const cacheable = options.cache !== false && status < 400;
  res.setHeader("Cache-Control", cacheable ? "s-maxage=900, stale-while-revalidate=3600" : "no-store");
  res.end(body);
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function fetchText(url, timeoutMs = 6000, headers = {}) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers });
      if (!res.ok) {
        const error = new Error(`${new URL(url).hostname} returned ${res.status}`);
        error.statusCode = res.status;
        const retryAfter = Number(res.headers.get("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = retryAfter * 1000;
        throw error;
      }
      return await res.text();
    } catch (error) {
      lastError = error;
      const retryable = !error.statusCode || error.statusCode === 429 || error.statusCode >= 500;
      if (!retryable || attempt === 1) break;
      await sleep(Math.min(error.retryAfterMs || (500 + Math.floor(Math.random() * 500)), 2000));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function yahooBarIsOpen(timestamp, regular, nowSeconds = Math.floor(Date.now() / 1000)) {
  return Boolean(regular && nowSeconds >= regular.start && nowSeconds < regular.end && timestamp >= regular.start && timestamp < regular.end);
}

async function fetchYahooSeries(symbol, name, options = {}) {
  const period1 = symbol === "^VIX" ? VIX_PERIOD1 : NDX_PERIOD1;
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const url = `${YAHOO_CHART}${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
  const text = await fetchText(url, 6000, { "User-Agent": "Mozilla/5.0" });
  const payload = JSON.parse(text);
  const result = payload.chart?.result?.[0];
  const regular = result?.meta?.currentTradingPeriod?.regular;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const adjCloses = result?.indicators?.adjclose?.[0]?.adjclose || [];
  const out = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const close = Number(closes[i]);
    const adjClose = Number(adjCloses[i]);
    if (yahooBarIsOpen(timestamps[i], regular, nowSeconds)) continue;
    const value = options.adjusted ? adjClose : close;
    if (Number.isFinite(value) && value > 0 && Number.isFinite(close) && close > 0) {
      const point = { date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), value };
      if (options.adjusted) {
        point.close = close;
        point.adjClose = Number.isFinite(adjClose) && adjClose > 0 ? adjClose : null;
      }
      out.push(point);
    }
  }
  if (out.length < 60) throw new Error(`${name} returned too few observations`);
  return out;
}

async function fetchFredSeries(id) {
  const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, 6000, { "User-Agent": "Mozilla/5.0" });
  const points = csv.trim().split(/\r?\n/).slice(1).map((line) => {
    const [date, raw] = line.split(",");
    const value = Number(raw);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value) ? { date, value: value / 100 } : null;
  }).filter(Boolean);
  if (points.length < 60) throw new Error(`${id} returned too few observations`);
  return points;
}

function cleanCell(text) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&#x2002;|&nbsp;/g, "")
    .replace(/&[^;]+;/g, "")
    .trim();
}

function parseCapeTable(text) {
  const rows = [...text.matchAll(/<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>\s*(.*?)\s*<\/td>\s*<\/tr>/gis)];
  const out = [];
  for (const row of rows) {
    const label = cleanCell(row[1]);
    const value = Number(cleanCell(row[2]));
    const parsed = new Date(`${label} 00:00:00 UTC`);
    if (label && Number.isFinite(value) && !Number.isNaN(parsed.getTime())) {
      out.push({ date: parsed.toISOString().slice(0, 10), label, value });
    }
  }
  if (!out.length) throw new Error("CAPE table could not be parsed");
  return [...new Map(out.map((point) => [point.date, point])).values()]
    .sort((a, b) => b.date.localeCompare(a.date));
}

const DAY_MS = 24 * 60 * 60 * 1000;

function sourceLagDays(key, points, now = Date.now()) {
  const point = key === "capeLatestFirst" ? points?.[0] : points?.at(-1);
  const timestamp = Date.parse(`${point?.date || ""}T00:00:00Z`);
  return Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / DAY_MS) : Infinity;
}

function sourceIsStale(key, points, now = Date.now()) {
  const maxLagDays = key === "rates" ? 75 : key === "capeLatestFirst" ? 45 : 5;
  return sourceLagDays(key, points, now) > maxLagDays;
}

async function cachedSource(key, loader) {
  const cached = sourceCache[key];
  if (cached && Date.now() - cached.at < CACHE_MS) return { data: cached.data, stale: cached.stale, fromSnapshot: cached.fromSnapshot };
  try {
    const data = await loader();
    const fromSnapshot = Boolean(data.fromSnapshot);
    const stale = sourceIsStale(key, data);
    sourceCache[key] = { at: Date.now(), data, stale, fromSnapshot };
    return { data, stale, fromSnapshot };
  } catch (error) {
    if (cached) return { data: cached.data, stale: sourceIsStale(key, cached.data), fromSnapshot: cached.fromSnapshot, error: error.message };
    throw error;
  }
}

async function loadData() {
  const sources = await Promise.allSettled([
    cachedSource("nasdaq", async () => {
      try {
        return await fetchYahooSeries("^NDX", "Nasdaq-100");
      } catch (error) {
        const snapshot = loadJsonSnapshot("ndx-snapshot.json");
        snapshot.fromSnapshot = true;
        if (snapshot.length) return snapshot;
        throw error;
      }
    }),
    cachedSource("qqq", async () => {
      try {
        return await fetchYahooSeries("QQQ", "QQQ", { adjusted: true });
      } catch (error) {
        const snapshot = loadJsonSnapshot("qqq-snapshot.json");
        snapshot.fromSnapshot = true;
        if (snapshot.length) return snapshot;
        throw error;
      }
    }),
    cachedSource("tqqq", async () => {
      try {
        return await fetchYahooSeries("TQQQ", "TQQQ", { adjusted: true });
      } catch (error) {
        const snapshot = loadJsonSnapshot("tqqq-snapshot.json");
        snapshot.fromSnapshot = true;
        if (snapshot.length) return snapshot;
        throw error;
      }
    }),
    cachedSource("vix", async () => {
      try {
        return await fetchYahooSeries("^VIX", "VIX");
      } catch (error) {
        const snapshot = loadJsonSnapshot("vix-snapshot.json");
        snapshot.fromSnapshot = true;
        if (snapshot.length) return snapshot;
        throw error;
      }
    }),
    cachedSource("rates", async () => {
      try {
        return await fetchFredSeries("FEDFUNDS");
      } catch (error) {
        const snapshot = loadJsonSnapshot("rates-snapshot.json");
        snapshot.fromSnapshot = true;
        if (snapshot.length) return snapshot;
        throw error;
      }
    }),
    cachedSource("capeLatestFirst", async () => {
      try {
        const points = parseCapeTable(await fetchText(CAPE_URL, 6000, { "User-Agent": "Mozilla/5.0" }));
        if (points.length < 60) throw new Error("CAPE returned too few observations");
        return points;
      } catch (error) {
        const snapshot = loadCapeSnapshot();
        snapshot.fromSnapshot = true;
        if (snapshot.length) return snapshot;
        throw error;
      }
    }),
  ]);
  const failed = sources.find((source) => source.status === "rejected");
  if (failed) throw failed.reason;
  const [nasdaq, qqq, tqqq, vix, rates, cape] = sources.map((source) => source.value);
  const staleSources = [
    nasdaq.stale ? "Nasdaq-100" : null,
    qqq.stale ? "QQQ" : null,
    tqqq.stale ? "TQQQ" : null,
    vix.stale ? "VIX" : null,
    rates.stale ? "Rates" : null,
    cape.stale ? "CAPE" : null,
  ].filter(Boolean);
  const fallbackSources = [
    nasdaq.fromSnapshot ? "Nasdaq-100" : null,
    qqq.fromSnapshot ? "QQQ" : null,
    tqqq.fromSnapshot ? "TQQQ" : null,
    vix.fromSnapshot ? "VIX" : null,
    rates.fromSnapshot ? "Rates" : null,
    cape.fromSnapshot ? "CAPE" : null,
  ].filter(Boolean);
  return {
    nasdaq: nasdaq.data,
    qqq: qqq.data,
    tqqq: tqqq.data,
    vix: vix.data,
    rates: rates.data,
    capeLatestFirst: cape.data,
    staleSources,
    fallbackSources,
    sourceMode: fallbackSources.length ? "liveWithSnapshotFallback" : "live",
    sourceLagDays: {
      nasdaq: sourceLagDays("nasdaq", nasdaq.data),
      qqq: sourceLagDays("qqq", qqq.data),
      tqqq: sourceLagDays("tqqq", tqqq.data),
      vix: sourceLagDays("vix", vix.data),
      rates: sourceLagDays("rates", rates.data),
      cape: sourceLagDays("capeLatestFirst", cape.data),
    },
  };
}

function loadSnapshotData() {
  const data = {
    nasdaq: loadJsonSnapshot("ndx-snapshot.json"),
    qqq: loadJsonSnapshot("qqq-snapshot.json"),
    tqqq: loadJsonSnapshot("tqqq-snapshot.json"),
    vix: loadJsonSnapshot("vix-snapshot.json"),
    rates: loadJsonSnapshot("rates-snapshot.json"),
    capeLatestFirst: loadCapeSnapshot(),
    staleSources: [],
    sourceMode: "versionedSnapshots",
  };
  for (const [name, points] of Object.entries(data)) {
    if (name === "staleSources" || name === "sourceMode") continue;
    if (!Array.isArray(points) || points.length < 60) throw new Error(`${name} snapshot is incomplete`);
  }
  return data;
}

function buildDataSnapshotId(data) {
  const hash = crypto.createHash("sha256");
  for (const key of ["nasdaq", "qqq", "tqqq", "vix", "rates", "capeLatestFirst"]) {
    hash.update(key);
    hash.update(JSON.stringify(data[key] || []));
  }
  return `snapshot-${hash.digest("hex").slice(0, 16)}`;
}

function loadCapeSnapshot() {
  if (capeSnapshot) return capeSnapshot;
  try {
    capeSnapshot = require("../data/cape-snapshot.json");
  } catch {
    capeSnapshot = [];
  }
  return capeSnapshot;
}

function loadJsonSnapshot(file) {
  if (jsonSnapshots[file]) return jsonSnapshots[file];
  try {
    const loaders = {
      "ndx-snapshot.json": () => require("../data/ndx-snapshot.json"),
      "qqq-snapshot.json": () => require("../data/qqq-snapshot.json"),
      "tqqq-snapshot.json": () => require("../data/tqqq-snapshot.json"),
      "vix-snapshot.json": () => require("../data/vix-snapshot.json"),
      "rates-snapshot.json": () => require("../data/rates-snapshot.json"),
    };
    jsonSnapshots[file] = loaders[file]?.() || [];
  } catch {
    jsonSnapshots[file] = [];
  }
  return jsonSnapshots[file];
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, value) {
  return 100 * values.filter((item) => item <= value).length / values.length;
}

function capeSeriesForBacktest(latestFirst) {
  return latestFirst.map((point) => {
    const date = new Date(`${point.date}T00:00:00Z`);
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
    return { ...point, date: date.toISOString().slice(0, 10) };
  });
}

function recentSeries(points, count) {
  return points.slice(-count).map((point) => ({ date: point.date, value: point.value }));
}

function shortRateForDate(date) {
  const year = Number(date.slice(0, 4));
  if (year < 2001) return 0.055;
  if (year < 2008) return 0.035;
  if (year < 2016) return 0.0025;
  if (year < 2020) return 0.018;
  if (year < 2022) return 0.001;
  if (year < 2023) return 0.025;
  if (year < 2025) return 0.052;
  return 0.045;
}

function rateForDate(date, rates = []) {
  if (!Array.isArray(rates) || !rates.length) return shortRateForDate(date);
  let lo = 0;
  let hi = rates.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (rates[mid].date <= date) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 && Number.isFinite(rates[found].value) ? rates[found].value : shortRateForDate(date);
}

function rollingPercentile(values, value, count = CAPE_ROLLING_MONTHS) {
  return percentile(values.slice(-count), value);
}

function capePercentileAt(capeChrono, index) {
  const current = capeChrono[Math.max(0, index)];
  const slice = capeChrono.slice(0, index + 1).map((point) => point.value);
  return rollingPercentile(slice, current.value);
}

function lastCapeTrigger(capeChrono, predicate) {
  for (let i = capeChrono.length - 1; i >= 0; i -= 1) {
    const pct = capePercentileAt(capeChrono, i);
    if (predicate(pct)) return { date: capeChrono[i].date, label: capeChrono[i].label, percentile: pct };
  }
  return null;
}

function isValuationCheap(state, thresholds = DEFAULT_THRESHOLDS) {
  if (state.capePercentile < thresholds.cheapCape) return true;
  // Crisis support: CAPE no longer extreme while the index is already crushed.
  const supportCape = thresholds.supportCape ?? 50;
  const supportDrawdown = thresholds.supportDrawdown ?? -25;
  return state.capePercentile < supportCape && state.drawdownPct <= supportDrawdown;
}

function isDeepDrawdown(state, thresholds = DEFAULT_THRESHOLDS) {
  return state.drawdownPct <= thresholds.deepDrawdown;
}

function isMildDrawdown(state, thresholds = DEFAULT_THRESHOLDS) {
  const mild = thresholds.mildDrawdown ?? -12;
  return state.drawdownPct <= mild && !isDeepDrawdown(state, thresholds);
}

function signalGroups(state, thresholds = DEFAULT_THRESHOLDS) {
  const lowSignals = {
    valuationCheap: isValuationCheap(state, thresholds),
    deepDrawdown: isDeepDrawdown(state, thresholds),
    panicVix: state.vixAvailable !== false && state.vix >= thresholds.panicVix,
  };
  // Mild drawdown is an extra buy-leaning cue, not one of the three core lows.
  // It upgrades a zero-low month into smallDipBuy without diluting bottomAttack.
  const softSignals = {
    mildDrawdown: isMildDrawdown(state, thresholds),
  };
  const defensiveFlags = {
    valuationHigh: state.capePercentile >= thresholds.highCape,
    bubbleWatch: state.capePercentile >= thresholds.bubbleCape,
    nearHigh: state.drawdownPct > -5,
    fastCrash: state.crash25dPct <= thresholds.fastCrash,
    quietVix: state.vixAvailable !== false && state.vix <= thresholds.quietVix,
  };
  return {
    lowSignals,
    softSignals,
    defensiveFlags,
    lowSignalCount: Object.values(lowSignals).filter(Boolean).length,
  };
}

function isHeatRegime(defensiveFlags) {
  // Quiet VIX alone is not "heat". Complacency is a caution chip, not a sell/pause trigger.
  // Heat requires bubble-level CAPE so trim/pause do not fire through ordinary calm bulls.
  return Boolean(defensiveFlags.bubbleWatch);
}

function advanceSignalMonth(memory, state, month, thresholds = DEFAULT_THRESHOLDS) {
  if (memory.month === month) return memory;
  const { defensiveFlags } = signalGroups(state, thresholds);
  const isHeat = isHeatRegime(defensiveFlags);
  return {
    ...memory,
    month,
    heatMonths: isHeat ? (memory.heatMonths || 0) + 1 : 0,
  };
}

function normalizeStart(rawStart = "2010-02-11") {
  const match = String(rawStart || "2010-02-11").trim().match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
  if (!match) throw new HttpError(400, "Invalid start. Use one of the year options on the page.");
  const year = Number(match[1]);
  const month = Number(match[2] || 1);
  const day = Number(match[3] || 1);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new HttpError(400, "Invalid start date.");
  }
  const normalized = date.toISOString().slice(0, 10);
  if (!VALID_STARTS.has(normalized)) {
    throw new HttpError(400, "Unsupported start. Choose one of the listed start years.");
  }
  return normalized;
}

function normalizeMonthly(rawMonthly = 1000) {
  const monthly = Number(rawMonthly || 1000);
  if (!VALID_MONTHLY.has(monthly)) {
    throw new HttpError(400, "Unsupported monthly amount. This backtest is fixed at $1,000.");
  }
  return monthly;
}

function normalizeCostBps(rawCostBps = DEFAULT_COST_BPS) {
  const costBps = Number(rawCostBps ?? DEFAULT_COST_BPS);
  if (!VALID_COST_BPS.has(costBps)) {
    throw new HttpError(400, "Unsupported trading cost. Choose 0, 5, or 10 basis points.");
  }
  return costBps;
}

function calculateDecision(state, memory = {}, thresholds = DEFAULT_THRESHOLDS) {
  const { lowSignals, softSignals, defensiveFlags, lowSignalCount } = signalGroups(state, thresholds);
  const isHeat = isHeatRegime(defensiveFlags);
  const heatMonths = memory.heatMonths || 0;
  const rampMonths = memory.rampMonths || 0;
  let key = "normalDca";
  let reason = "noSpecialRule";

  // Two core lows still override risk cuts. A fast crash with no core low signal
  // exits before the softer mild-drawdown buy cue so crashDefense is reachable.
  if (lowSignalCount >= 2) {
    key = "bottomAttack";
    reason = "lowSignalConvergence";
  } else if (rampMonths > 0) {
    key = "rampTqqq";
    reason = "postBottomRamp";
  } else if (lowSignalCount === 1) {
    key = "smallDipBuy";
    reason = "singleLowSignal";
  } else if (defensiveFlags.fastCrash) {
    key = "crashDefense";
    reason = "fastCrashNoCoreLow";
  } else if (softSignals.mildDrawdown) {
    key = "smallDipBuy";
    reason = "mildDrawdown";
  } else if (isHeat && heatMonths >= 6) {
    key = "trimHeat";
    reason = "sustainedBubbleHeat";
  } else if ((defensiveFlags.valuationHigh && defensiveFlags.nearHigh) || isHeat) {
    key = "pauseAtHigh";
    reason = isHeat ? "bubbleWatch" : "expensiveNearHigh";
  }

  return {
    key,
    reason,
    lowSignalCount,
    lowSignals,
    softSignals,
    defensiveFlags,
    heatMonths,
    rampMonths,
  };
}

function decisionConfidence(decision, state = {}) {
  const near = (value, threshold, width) => Math.abs(value - threshold) <= width;
  const borderline = (
    near(state.capePercentile ?? 50, DEFAULT_THRESHOLDS.cheapCape, 3)
    || near(state.drawdownPct ?? 0, DEFAULT_THRESHOLDS.deepDrawdown, 2)
    || near(state.drawdownPct ?? 0, DEFAULT_THRESHOLDS.mildDrawdown, 1.5)
    || near(state.vix ?? 20, DEFAULT_THRESHOLDS.panicVix, 2)
    || near(state.crash25dPct ?? 0, DEFAULT_THRESHOLDS.fastCrash, 1.5)
  );
  if (decision.key === "bottomAttack" && decision.lowSignalCount >= 3) {
    return { level: "high", note: "threeLowSignals", calibrated: false };
  }
  if (decision.key === "bottomAttack") {
    return { level: borderline ? "medium" : "high", note: "twoLowSignals", calibrated: false };
  }
  if (decision.key === "crashDefense" || decision.key === "trimHeat") {
    return { level: borderline ? "medium" : "high", note: decision.key, calibrated: false };
  }
  if (decision.key === "smallDipBuy" || decision.key === "pauseAtHigh" || decision.key === "rampTqqq") {
    return { level: borderline ? "low" : "medium", note: decision.key, calibrated: false };
  }
  return { level: borderline ? "low" : "medium", note: "normalDca", calibrated: false };
}

function actionSeverity(key) {
  const rank = {
    bottomAttack: 6,
    rampTqqq: 5,
    smallDipBuy: 4,
    normalDca: 3,
    pauseAtHigh: 2,
    trimHeat: 1,
    crashDefense: 0,
  };
  return rank[key] ?? 3;
}

function isBuyLeanAction(key) {
  return key === "bottomAttack" || key === "rampTqqq" || key === "smallDipBuy" || key === "normalDca";
}

function isRiskAction(key) {
  return key === "crashDefense" || key === "trimHeat";
}

function memoryAfterAction(memory, decision) {
  if (decision.key === "bottomAttack") return { ...memory, heatMonths: 0, rampMonths: 6 };
  if (decision.key === "crashDefense") return { ...memory, rampMonths: 0 };
  if (decision.key === "rampTqqq") return { ...memory, rampMonths: Math.max(0, (memory.rampMonths || 0) - 1) };
  if (decision.key === "smallDipBuy") return { ...memory, heatMonths: 0 };
  return memory;
}

function coverageForSeries(points) {
  return {
    start: points?.[0]?.date || null,
    end: points?.at(-1)?.date || null,
    count: Array.isArray(points) ? points.length : 0,
  };
}

function buildDataQuality(data, prices = []) {
  const actualTqqqStart = prices.find((point) => point.tqqqSource === "actual")?.date || data.tqqq?.[0]?.date || null;
  const syntheticTqqqEnd = prices.findLast?.((point) => point.tqqqSource === "synthetic")?.date
    || [...prices].reverse().find((point) => point.tqqqSource === "synthetic")?.date
    || null;
  return {
    nasdaq: coverageForSeries(data.nasdaq),
    qqq: coverageForSeries(data.qqq),
    tqqq: coverageForSeries(data.tqqq),
    vix: coverageForSeries(data.vix),
    rates: coverageForSeries(data.rates),
    cape: coverageForSeries([...data.capeLatestFirst].reverse()),
    qqqActualStart: data.qqq?.[0]?.date || null,
    tqqqActualStart: actualTqqqStart,
    tqqqSyntheticEnd: syntheticTqqqEnd,
    qqqAdjusted: true,
    tqqqAdjusted: true,
    rateSource: data.rates?.length ? "FEDFUNDS" : "approximation",
    sourceMode: data.sourceMode || "liveWithSnapshotFallback",
    capePointInTime: false,
  };
}

function buildMonthlyDecisionLog(prices, nasdaq, vix, capeChrono, states, thresholds = DEFAULT_THRESHOLDS, limit = 18) {
  let memory = { heatMonths: 0, rampMonths: 0, month: "" };
  let lastMonth = "";
  let monthAction = null;
  let monthAnchorDate = null;
  let monthAnchorDecision = null;
  let upgraded = false;
  const months = [];

  for (let i = 30; i < prices.length; i += 1) {
    const price = prices[i];
    const month = price.date.slice(0, 7);
    const state = states?.[i];
    if (!state) continue;

    if (month !== lastMonth) {
      if (lastMonth && monthAction) {
        months.push({
          month: lastMonth,
          date: monthAnchorDate,
          key: monthAction,
          lockedKey: monthAnchorDecision?.key || monthAction,
          upgraded,
          lowSignalCount: monthAnchorDecision?.lowSignalCount ?? null,
        });
      }
      lastMonth = month;
      monthAction = null;
      monthAnchorDate = price.date;
      monthAnchorDecision = null;
      upgraded = false;
      memory = advanceSignalMonth(memory, state, month, thresholds);
      const decision = calculateDecision(state, memory, thresholds);
      monthAnchorDecision = decision;
      monthAction = decision.key;
      memory = memoryAfterAction(memory, decision);
    } else {
      memory = advanceSignalMonth(memory, state, month, thresholds);
      const live = calculateDecision(state, memory, thresholds);
      if (shouldUpgradeMonthAction(monthAction, live.key)) {
        monthAction = live.key;
        upgraded = true;
        memory = memoryAfterAction(memory, live);
      }
    }
  }
  if (lastMonth && monthAction) {
    months.push({
      month: lastMonth,
      date: monthAnchorDate,
      key: monthAction,
      lockedKey: monthAnchorDecision?.key || monthAction,
      upgraded,
      lowSignalCount: monthAnchorDecision?.lowSignalCount ?? null,
    });
  }
  return months.slice(-limit);
}

function shouldUpgradeMonthAction(currentKey, liveKey) {
  if (!currentKey || currentKey === liveKey) return false;
  // Only allow upgrades that are more buy-leaning after the month opens, or a pure
  // risk cut when the month started without a core low signal. Never flip buy → sell
  // mid-month after a core low signal already fired.
  if (liveKey === "bottomAttack" && currentKey !== "bottomAttack") return true;
  if (liveKey === "smallDipBuy" && (currentKey === "normalDca" || currentKey === "pauseAtHigh" || currentKey === "trimHeat")) return true;
  if (liveKey === "crashDefense" && currentKey === "normalDca") return true;
  if (liveKey === "crashDefense" && currentKey === "pauseAtHigh") return true;
  if (liveKey === "rampTqqq" && actionSeverity(liveKey) > actionSeverity(currentKey)) return true;
  return false;
}

function firstIndexOfMonth(prices, month) {
  for (let i = 0; i < prices.length; i += 1) {
    if (prices[i].date.slice(0, 7) === month) return i;
  }
  return -1;
}

async function marketSnapshot() {
  const data = await loadData();
  const { nasdaq, qqq, tqqq, vix, rates, capeLatestFirst, staleSources, fallbackSources, sourceLagDays: lagDays } = data;
  const dataSnapshotId = buildDataSnapshotId(data);
  const nasdaqValues = nasdaq.map((point) => point.value);
  const vixValues = vix.map((point) => point.value);
  const currentIndex = mean(nasdaqValues.slice(-5));
  const prior25d = mean(nasdaqValues.slice(-30, -25));
  const crash25dPct = 100 * (currentIndex / prior25d - 1);
  const currentVix = mean(vixValues.slice(-5));
  const latestCape = capeLatestFirst[0];
  const capeValues = capeLatestFirst.map((point) => point.value);
  const prices = buildPrices(nasdaq, qqq, tqqq, rates);
  const capeChrono = [...capeLatestFirst].reverse();
  const states = buildStates(prices, nasdaq, vix, capeChrono);
  const currentMonth = prices.at(-1).date.slice(0, 7);
  const monthStartIndex = firstIndexOfMonth(prices, currentMonth);
  const memoryBeforeMonth = replayDecisionMemory(prices, nasdaq, vix, capeChrono, currentMonth, DEFAULT_THRESHOLDS, states);
  const monthStartState = states[monthStartIndex] || states.at(-1);
  const monthStartMemory = advanceSignalMonth(memoryBeforeMonth, monthStartState, currentMonth, DEFAULT_THRESHOLDS);
  const lockedDecision = calculateDecision(monthStartState, monthStartMemory, DEFAULT_THRESHOLDS);
  const currentState = states.at(-1);
  // Replay through current month with upgrades so live memory matches engine path.
  let liveMemory = { ...monthStartMemory };
  let effectiveKey = lockedDecision.key;
  let upgraded = false;
  for (let i = monthStartIndex; i < prices.length; i += 1) {
    const state = states[i];
    if (!state) continue;
    liveMemory = advanceSignalMonth(liveMemory, state, currentMonth, DEFAULT_THRESHOLDS);
    const live = calculateDecision(state, liveMemory, DEFAULT_THRESHOLDS);
    if (i === monthStartIndex) {
      effectiveKey = live.key;
      liveMemory = memoryAfterAction(liveMemory, live);
      continue;
    }
    if (shouldUpgradeMonthAction(effectiveKey, live.key)) {
      effectiveKey = live.key;
      upgraded = true;
      liveMemory = memoryAfterAction(liveMemory, live);
    }
  }
  const liveDecision = calculateDecision(currentState, liveMemory, DEFAULT_THRESHOLDS);
  const decision = {
    ...liveDecision,
    key: effectiveKey,
    lockedKey: lockedDecision.key,
    liveKey: liveDecision.key,
    upgraded,
    month: currentMonth,
    asOf: prices.at(-1).date,
    executionTiming: "nextTradingSession",
    lockedDate: prices[monthStartIndex]?.date || prices.at(-1).date,
    confidence: decisionConfidence({ ...liveDecision, key: effectiveKey }, currentState),
    thresholds: {
      cheapCape: DEFAULT_THRESHOLDS.cheapCape,
      deepDrawdown: DEFAULT_THRESHOLDS.deepDrawdown,
      mildDrawdown: DEFAULT_THRESHOLDS.mildDrawdown,
      panicVix: DEFAULT_THRESHOLDS.panicVix,
      fastCrash: DEFAULT_THRESHOLDS.fastCrash,
      highCape: DEFAULT_THRESHOLDS.highCape,
      bubbleCape: DEFAULT_THRESHOLDS.bubbleCape,
      supportCape: DEFAULT_THRESHOLDS.supportCape,
      supportDrawdown: DEFAULT_THRESHOLDS.supportDrawdown,
      quietVix: DEFAULT_THRESHOLDS.quietVix,
    },
  };
  const decisionCriticalStale = staleSources.filter((name) => ["Nasdaq-100", "VIX", "CAPE"].includes(name));
  const executionCriticalStale = staleSources.filter((name) => ["Nasdaq-100", "VIX", "CAPE", "QQQ", "TQQQ"].includes(name));
  const decisionDate = prices.at(-1).date;
  const qqqLatest = qqq.at(-1);
  const tqqqLatest = tqqq.at(-1);
  const quoteDateMismatch = qqqLatest?.date !== decisionDate || tqqqLatest?.date !== decisionDate;
  decision.available = decisionCriticalStale.length === 0;
  decision.blockedSources = decisionCriticalStale;
  const rollingHigh = currentIndex / (1 + currentState.drawdownPct / 100);
  const decisionHistory = buildMonthlyDecisionLog(prices, nasdaq, vix, capeChrono, states, DEFAULT_THRESHOLDS, 18);

  return {
    generatedAt: new Date().toISOString(),
    rulesetId: RULESET_ID,
    dataSnapshotId,
    staleSources,
    fallbackSources,
    sourceLagDays: lagDays,
    executionReady: executionCriticalStale.length === 0 && !quoteDateMismatch,
    executionBlockedSources: executionCriticalStale,
    riskPolicies: RISK_POLICIES,
    coreQqqHighRegimeFraction: CORE_QQQ_HIGH_REGIME_FRACTION,
    dataQuality: buildDataQuality(data, prices),
    cadence: {
      mode: "monthlyContributionWithIntraMonthUpgrades",
      contribution: "firstTradingDay",
      upgrades: "bottomAttack/smallDipBuy/crashDefense can upgrade later in the month",
      execution: "signal observed at close, manual order for next trading session",
      note: "Live panel shows the effective month action. Locked is first trading day. Live preview is today's re-evaluation. Orders use the next trading session, never the same closing price that created the signal.",
    },
    quotes: {
      qqq: { date: qqqLatest?.date || null, price: qqqLatest?.close || qqqLatest?.value || null },
      tqqq: { date: tqqqLatest?.date || null, price: tqqqLatest?.close || tqqqLatest?.value || null },
    },
    indicators: {
      cape: {
        date: latestCape.label,
        value: latestCape.value,
        percentile: currentState.capePercentile,
        historyCount: capeValues.length,
        rollingMonths: Math.min(CAPE_ROLLING_MONTHS, capeValues.length),
        min: Math.min(...capeValues),
        max: Math.max(...capeValues),
        lastCheap: lastCapeTrigger(capeChrono, (pct) => pct < DEFAULT_THRESHOLDS.cheapCape),
        lastBubble: lastCapeTrigger(capeChrono, (pct) => pct >= DEFAULT_THRESHOLDS.bubbleCape),
        recent: capeLatestFirst.slice(0, 12).reverse().map((point) => ({
          date: point.date,
          label: point.label,
          value: point.value,
        })),
      },
      nasdaq100: {
        date: nasdaq.at(-1).date,
        level5dAvg: currentIndex,
        ath: rollingHigh,
        drawdownPct: currentState.drawdownPct,
        crash25dPct,
        recent: recentSeries(nasdaq, 5),
        qqqClose: prices.at(-1).qqqClose,
      },
      vix: {
        date: vix.at(-1).date,
        value5dAvg: currentVix,
        latest: vix.at(-1).value,
        recent: recentSeries(vix, 5),
      },
    },
    decision,
    lockedDecision: {
      ...lockedDecision,
      confidence: decisionConfidence(lockedDecision, monthStartState),
      date: prices[monthStartIndex]?.date || null,
      month: currentMonth,
    },
    liveDecision: {
      ...liveDecision,
      confidence: decisionConfidence(liveDecision, currentState),
      date: prices.at(-1).date,
      month: currentMonth,
    },
    decisionHistory,
  };
}

function buildPrices(nasdaq, qqqSeries = [], tqqqSeries = [], rates = []) {
  const qqqByDate = new Map((qqqSeries || []).map((point) => [point.date, point]));
  const tqqqByDate = new Map((tqqqSeries || []).map((point) => [point.date, point]));
  let qqqSynthetic = 1;
  let qqq = 1;
  let qqqActualBase = null;
  let qqqActualScale = 1;
  let tqqqSynthetic = 1;
  let tqqq = 1;
  let tqqqActualBase = null;
  let tqqqActualScale = 1;
  let tqqqWipedOut = false;

  return nasdaq.map((point, index) => {
    const shortRate = rateForDate(point.date, rates);
    if (index > 0) {
      const daily = point.value / nasdaq[index - 1].value - 1;
      const dailyDividend = QQQ_DIVIDEND_YIELD / 252;
      qqqSynthetic *= Math.max(0, 1 + daily + dailyDividend);
      if (!tqqqWipedOut) {
        const tqqqCost = (TQQQ_EXPENSE_RATIO + 2 * (shortRate + TQQQ_SWAP_SPREAD)) / 252;
        const tqqqFactor = 1 + 3 * daily + 3 * dailyDividend - tqqqCost;
        if (tqqqFactor <= 0) {
          tqqqSynthetic = 0;
          tqqqWipedOut = true;
        } else {
          tqqqSynthetic *= tqqqFactor;
        }
      }
    }

    const qqqActual = qqqByDate.get(point.date);
    let qqqClose = null;
    let qqqSource = "synthetic";
    if (qqqActual && Number.isFinite(qqqActual.value) && qqqActual.value > 0) {
      if (qqqActualBase == null) {
        qqqActualBase = qqqActual.value;
        qqqActualScale = qqqSynthetic;
      }
      qqq = (qqqActual.value / qqqActualBase) * qqqActualScale;
      qqqClose = qqqActual.close || qqqActual.value;
      qqqSource = "actual";
    } else if (qqqActualBase == null) {
      qqq = qqqSynthetic;
    } else {
      qqqSource = "actual-gap";
    }

    const tqqqActual = tqqqByDate.get(point.date);
    let tqqqSource = "synthetic";
    if (tqqqActual && Number.isFinite(tqqqActual.value) && tqqqActual.value > 0) {
      if (tqqqActualBase == null) {
        tqqqActualBase = tqqqActual.value;
        tqqqActualScale = Math.max(tqqqSynthetic, 0.000001);
      }
      tqqq = (tqqqActual.value / tqqqActualBase) * tqqqActualScale;
      tqqqSource = "actual";
    } else if (tqqqActualBase == null) {
      tqqq = tqqqSynthetic;
    } else {
      tqqqSource = "actual-gap";
    }

    return {
      date: point.date,
      qqq,
      tqqq,
      ndx: point.value,
      qqqClose,
      qqqSource,
      tqqqSource,
      shortRate,
    };
  });
}

function emptyPortfolio(costBps = DEFAULT_COST_BPS) {
  return { cash: 0, qqq: 0, tqqq: 0, contributed: 0, units: 0, peak: 0, maxDrawdown: 0, points: [], flows: [], fees: 0, costBps };
}

function valueOf(portfolio, prices) {
  return portfolio.cash + portfolio.qqq * prices.qqq + portfolio.tqqq * prices.tqqq;
}

function unitNav(portfolio, prices) {
  return portfolio.units > 0 ? valueOf(portfolio, prices) / portfolio.units : 1;
}

function addContribution(portfolio, amount, prices) {
  const nav = unitNav(portfolio, prices);
  portfolio.cash += amount;
  portfolio.contributed += amount;
  portfolio.units += amount / nav;
  portfolio.flows.push({ time: new Date(`${prices.date}T00:00:00Z`).getTime(), amount: -amount });
}

function accrueCash(portfolio, prices) {
  if (portfolio.cash > 0) portfolio.cash *= 1 + (prices.shortRate ?? shortRateForDate(prices.date)) / 252;
}

function buyQQQ(portfolio, amount, price) {
  if (price <= 0) return;
  const spend = Math.max(0, Math.min(portfolio.cash, amount));
  const rate = (portfolio.costBps || 0) / 10000;
  const shares = spend / (price * (1 + rate));
  portfolio.cash -= spend;
  portfolio.qqq += shares;
  portfolio.fees += spend - shares * price;
}

function buyTQQQ(portfolio, amount, price) {
  if (price <= 0) return;
  const spend = Math.max(0, Math.min(portfolio.cash, amount));
  const rate = (portfolio.costBps || 0) / 10000;
  const shares = spend / (price * (1 + rate));
  portfolio.cash -= spend;
  portfolio.tqqq += shares;
  portfolio.fees += spend - shares * price;
}

function sellQQQ(portfolio, amount, price) {
  if (price <= 0) return;
  const value = Math.max(0, Math.min(portfolio.qqq * price, amount));
  const fee = value * ((portfolio.costBps || 0) / 10000);
  portfolio.qqq -= value / price;
  portfolio.cash += value - fee;
  portfolio.fees += fee;
}

function sellTQQQ(portfolio, fraction, price) {
  if (price <= 0) return;
  const shares = portfolio.tqqq * fraction;
  const value = shares * price;
  const fee = value * ((portfolio.costBps || 0) / 10000);
  portfolio.tqqq -= shares;
  portfolio.cash += value - fee;
  portfolio.fees += fee;
}

function sellTQQQWithFloor(portfolio, fraction, prices, floorPct) {
  if (prices.tqqq <= 0) return;
  const totalValue = valueOf(portfolio, prices);
  const tqqqValue = portfolio.tqqq * prices.tqqq;
  const floorValue = totalValue * floorPct;
  const sellValue = Math.max(0, Math.min(tqqqValue * fraction, tqqqValue - floorValue));
  if (sellValue <= 0) return;
  const fee = sellValue * ((portfolio.costBps || 0) / 10000);
  portfolio.tqqq -= sellValue / prices.tqqq;
  portfolio.cash += sellValue - fee;
  portfolio.fees += fee;
}

function buyTQQQToTarget(portfolio, targetPct, prices, rotationPct = 0, cashLimit = Infinity) {
  if (prices.tqqq <= 0) return;
  const totalValue = valueOf(portfolio, prices);
  const targetValue = totalValue * targetPct;
  let need = Math.max(0, targetValue - portfolio.tqqq * prices.tqqq);
  if (need <= 0) return;
  const cashSpend = Math.min(portfolio.cash, need, cashLimit);
  buyTQQQ(portfolio, cashSpend, prices.tqqq);
  need -= cashSpend;
  if (need <= 0 || rotationPct <= 0) return;
  const rotateValue = Math.min(portfolio.qqq * prices.qqq * rotationPct, need);
  sellQQQ(portfolio, rotateValue, prices.qqq);
  buyTQQQ(portfolio, rotateValue, prices.tqqq);
}

function record(portfolio, prices, startTime, actionKey = null, qqqPrice = null, actionMeta = {}) {
  const qqqValue = portfolio.qqq * prices.qqq;
  const tqqqValue = portfolio.tqqq * prices.tqqq;
  const cashValue = portfolio.cash;
  const value = cashValue + qqqValue + tqqqValue;
  portfolio.points.push({
    date: prices.date,
    value,
    qqqPrice,
    nav: unitNav(portfolio, prices),
    units: portfolio.units,
    cash: cashValue,
    qqqValue,
    tqqqValue,
    cashWeight: value > 0 ? cashValue / value : 0,
    qqqWeight: value > 0 ? qqqValue / value : 0,
    tqqqWeight: value > 0 ? tqqqValue / value : 0,
    tqqqSource: prices.tqqqSource,
    shortRate: prices.shortRate,
    fees: portfolio.fees,
    year: (new Date(`${prices.date}T00:00:00Z`).getTime() - startTime) / (365.25 * 24 * 3600 * 1000),
    actionKey,
    actionDecisionDate: actionMeta.decisionDate || null,
    actionExecutionDate: actionMeta.executionDate || null,
  });
}

function updateDrawdown(portfolio, prices) {
  const nav = unitNav(portfolio, prices);
  portfolio.peak = Math.max(portfolio.peak, nav);
  if (portfolio.peak > 0) portfolio.maxDrawdown = Math.min(portfolio.maxDrawdown, nav / portfolio.peak - 1);
}

function xirr(flows) {
  if (!flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) return null;
  const t0 = flows[0].time;
  const npv = (rate) => flows.reduce((sum, flow) => {
    const years = (flow.time - t0) / (365.25 * 24 * 3600 * 1000);
    return sum + flow.amount / ((1 + rate) ** years);
  }, 0);
  let lo = -0.999;
  let hi = 10;
  while (npv(hi) > 0 && hi < 1000) hi *= 2;
  for (let i = 0; i < 120; i += 1) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function regression(points) {
  const filtered = points.filter((point) => point.nav > 0);
  const n = filtered.length;
  if (n < 36 || filtered.at(-1).year < 3) {
    return { intercept: null, slope: null, annualized: null, r2: null };
  }
  const sx = filtered.reduce((sum, point) => sum + point.year, 0);
  const sy = filtered.reduce((sum, point) => sum + Math.log(point.nav), 0);
  const sxx = filtered.reduce((sum, point) => sum + point.year * point.year, 0);
  const sxy = filtered.reduce((sum, point) => sum + point.year * Math.log(point.nav), 0);
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const yMean = sy / n;
  const ssTot = filtered.reduce((sum, point) => sum + (Math.log(point.nav) - yMean) ** 2, 0);
  const ssRes = filtered.reduce((sum, point) => {
    const fit = intercept + slope * point.year;
    return sum + (Math.log(point.nav) - fit) ** 2;
  }, 0);
  return { intercept, slope, annualized: Math.exp(slope) - 1, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot };
}

function riskStats(points) {
  const excessReturns = [];
  let peak = 0;
  const drawdowns = [];
  for (let i = 0; i < points.length; i += 1) {
    const nav = points[i].nav;
    if (i > 0 && points[i - 1].nav > 0) {
      const totalReturn = nav / points[i - 1].nav - 1;
      const previousDate = new Date(`${points[i - 1].date}T00:00:00Z`).getTime();
      const currentDate = new Date(`${points[i].date}T00:00:00Z`).getTime();
      const years = Math.max(0, currentDate - previousDate) / (365.25 * 24 * 3600 * 1000);
      const annualRate = points[i - 1].shortRate || 0;
      const riskFreeReturn = (1 + annualRate) ** years - 1;
      excessReturns.push(totalReturn - riskFreeReturn);
    }
    peak = Math.max(peak, nav);
    if (peak > 0) drawdowns.push(Math.min(0, nav / peak - 1));
  }
  const avg = excessReturns.length ? mean(excessReturns) : 0;
  const variance = excessReturns.length > 1 ? excessReturns.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (excessReturns.length - 1) : 0;
  const sharpe = variance > 0 ? (avg / Math.sqrt(variance)) * Math.sqrt(12) : null;
  const ulcer = drawdowns.length ? Math.sqrt(drawdowns.reduce((sum, value) => sum + (value * 100) ** 2, 0) / drawdowns.length) : null;
  return { sharpe, ulcer, sharpeType: "monthlyExcessReturnOverCash" };
}

function stateAt(index, prices, nasdaq, vixByDate, capeChrono, capeCursor) {
  const current5 = mean(nasdaq.slice(Math.max(0, index - 4), index + 1).map((point) => point.value));
  const previous5 = mean(nasdaq.slice(Math.max(0, index - 29), Math.max(1, index - 24)).map((point) => point.value));
  let rollingHigh = current5;
  for (let i = Math.max(0, index - ROLLING_HIGH_DAYS); i <= index; i += 1) {
    const avg = mean(nasdaq.slice(Math.max(0, i - 4), i + 1).map((point) => point.value));
    rollingHigh = Math.max(rollingHigh, avg);
  }
  const drawdownPct = 100 * (current5 / rollingHigh - 1);
  const crash25dPct = previous5 ? 100 * (current5 / previous5 - 1) : 0;
  const date = prices.date;
  const vixValues = vixByDate.filter((point) => point.date <= date).slice(-5).map((point) => point.value);
  const vixAvailable = vixValues.length > 0;
  const vix = vixAvailable ? mean(vixValues) : 20;
  while (capeCursor.index + 1 < capeChrono.length && capeChrono[capeCursor.index + 1].date <= date) {
    capeCursor.index += 1;
  }
  const capePercentile = capePercentileAt(capeChrono, capeCursor.index);
  return { capePercentile, drawdownPct, crash25dPct, vix, vixAvailable };
}

function buildStates(prices, nasdaq, vix, capeChrono) {
  const capeCursor = { index: 0 };
  return prices.map((price, index) => (index < 30 ? null : stateAt(index, price, nasdaq, vix, capeChrono, capeCursor)));
}

function replayDecisionMemory(prices, nasdaq, vix, capeChrono, beforeMonth, thresholds = DEFAULT_THRESHOLDS, states = null) {
  let memory = { heatMonths: 0, rampMonths: 0, month: "" };
  const capeCursor = { index: 0 };
  let lastMonth = "";
  let monthAction = null;
  for (let i = 30; i < prices.length; i += 1) {
    const price = prices[i];
    const month = price.date.slice(0, 7);
    if (month >= beforeMonth) break;
    if (month !== lastMonth) {
      lastMonth = month;
      monthAction = null;
    }
    const state = states?.[i] || stateAt(i, price, nasdaq, vix, capeChrono, capeCursor);
    memory = advanceSignalMonth(memory, state, month, thresholds);
    const decision = calculateDecision(state, memory, thresholds);
    if (monthAction == null) {
      monthAction = decision.key;
      memory = memoryAfterAction(memory, decision);
    } else if (shouldUpgradeMonthAction(monthAction, decision.key)) {
      monthAction = decision.key;
      memory = memoryAfterAction(memory, decision);
    }
  }
  return memory;
}

function enforceTqqqCap(portfolio, prices, maxTqqq) {
  const total = valueOf(portfolio, prices);
  const tqqqValue = portfolio.tqqq * prices.tqqq;
  const excess = tqqqValue - total * maxTqqq;
  if (excess <= 0 || tqqqValue <= 0) return;
  const feeRate = (portfolio.costBps || 0) / 10000;
  const grossSale = excess / Math.max(1e-9, 1 - maxTqqq * feeRate);
  sellTQQQ(portfolio, Math.min(1, grossSale / tqqqValue), prices.tqqq);
}

function applySignalAction(portfolio, decision, prices, monthlyAmount) {
  const policy = RISK_POLICIES.aggressive;
  enforceTqqqCap(portfolio, prices, policy.maxTqqq);
  if (decision.key === "bottomAttack") {
    buyTQQQToTarget(portfolio, policy.bottomTqqqTarget, prices, 0.25, portfolio.cash / 3);
  } else if (decision.key === "crashDefense") {
    sellTQQQ(portfolio, 0.5, prices.tqqq);
  } else if (decision.key === "rampTqqq") {
    const cashLimit = monthlySpendWithDrip(portfolio, monthlyAmount);
    buyTQQQToTarget(portfolio, policy.rampTqqqTarget, prices, 1 / Math.max(1, decision.rampMonths), cashLimit);
  } else if (decision.key === "smallDipBuy") {
    buyQQQ(portfolio, Math.min(portfolio.cash, monthlyAmount * 2), prices.qqq);
  } else if (decision.key === "trimHeat") {
    buyQQQ(portfolio, Math.min(portfolio.cash, monthlyAmount * CORE_QQQ_HIGH_REGIME_FRACTION), prices.qqq);
    sellTQQQWithFloor(portfolio, 1 / 12, prices, policy.normalTqqqFloor);
  } else if (decision.key === "pauseAtHigh") {
    buyQQQ(portfolio, Math.min(portfolio.cash, monthlyAmount * CORE_QQQ_HIGH_REGIME_FRACTION), prices.qqq);
  } else if (decision.key === "normalDca") {
    buyTQQQToTarget(portfolio, policy.normalTqqqFloor, prices);
    buyQQQ(portfolio, monthlySpendWithDrip(portfolio, monthlyAmount), prices.qqq);
  }
}

function monthlySpendWithDrip(portfolio, monthlyAmount, spareFraction = 1 / 6) {
  return Math.min(portfolio.cash, monthlyAmount + Math.max(0, portfolio.cash - monthlyAmount) * spareFraction);
}

function applySignalQqqAction(portfolio, decision, prices, monthlyAmount) {
  if (decision.key === "bottomAttack") {
    buyQQQ(portfolio, monthlySpendWithDrip(portfolio, monthlyAmount, 1 / 3), prices.qqq);
  } else if (decision.key === "crashDefense") {
    sellQQQ(portfolio, portfolio.qqq * prices.qqq * 0.25, prices.qqq);
  } else if (decision.key === "trimHeat") {
    sellQQQ(portfolio, portfolio.qqq * prices.qqq / 12, prices.qqq);
  } else if (decision.key === "rampTqqq" || decision.key === "normalDca") {
    buyQQQ(portfolio, monthlySpendWithDrip(portfolio, monthlyAmount), prices.qqq);
  } else if (decision.key === "smallDipBuy") {
    buyQQQ(portfolio, Math.min(portfolio.cash, monthlyAmount * 2), prices.qqq);
  }
}

function applySignalTqqqAction(portfolio, decision, prices, monthlyAmount) {
  if (decision.key === "bottomAttack") {
    buyTQQQ(portfolio, monthlySpendWithDrip(portfolio, monthlyAmount, 1 / 3), prices.tqqq);
  } else if (decision.key === "crashDefense") {
    sellTQQQ(portfolio, 0.5, prices.tqqq);
  } else if (decision.key === "trimHeat") {
    sellTQQQ(portfolio, 1 / 12, prices.tqqq);
  } else if (decision.key === "rampTqqq" || decision.key === "normalDca") {
    buyTQQQ(portfolio, monthlySpendWithDrip(portfolio, monthlyAmount), prices.tqqq);
  } else if (decision.key === "smallDipBuy") {
    buyTQQQ(portfolio, Math.min(portfolio.cash, monthlyAmount), prices.tqqq);
  }
}

function emptyActionStats() {
  return Object.fromEntries(ACTION_KEYS.map((key) => [key, { count: 0, estimatedPnL: 0 }]));
}

function actionCountsFromStats(actionStats) {
  return Object.fromEntries(ACTION_KEYS.map((key) => [key, actionStats[key]?.count || 0]));
}

function relativeEdge(candidatePoints, benchmarkPoints) {
  if (!candidatePoints?.length || !benchmarkPoints?.length) return null;
  const n = Math.min(candidatePoints.length, benchmarkPoints.length);
  let underMonths = 0;
  let worstRelative = 0;
  let relativePeak = 1;
  let worstRelativeDrawdown = 0;
  let underperformanceStreak = 0;
  let longestUnderperformanceStreak = 0;
  let relativePeakDate = candidatePoints[0]?.date || null;
  let underwaterStartDate = null;
  let longestUnderwaterMonths = 0;
  let longestUnderwaterStart = null;
  let longestUnderwaterEnd = null;
  for (let i = 0; i < n; i += 1) {
    const cNav = candidatePoints[i].nav;
    const bNav = benchmarkPoints[i].nav;
    if (!(cNav > 0 && bNav > 0)) continue;
    const rel = cNav / bNav;
    if (i > 0) {
      const cRet = cNav / candidatePoints[i - 1].nav - 1;
      const bRet = bNav / benchmarkPoints[i - 1].nav - 1;
      if (cRet < bRet) {
        underMonths += 1;
        underperformanceStreak += 1;
        longestUnderperformanceStreak = Math.max(longestUnderperformanceStreak, underperformanceStreak);
      } else {
        underperformanceStreak = 0;
      }
    }
    worstRelative = Math.min(worstRelative, rel - 1);
    if (rel >= relativePeak) {
      relativePeak = rel;
      relativePeakDate = candidatePoints[i].date;
      underwaterStartDate = null;
    } else {
      if (!underwaterStartDate) underwaterStartDate = relativePeakDate;
      const start = new Date(`${underwaterStartDate}T00:00:00Z`);
      const end = new Date(`${candidatePoints[i].date}T00:00:00Z`);
      const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
      if (months > longestUnderwaterMonths) {
        longestUnderwaterMonths = months;
        longestUnderwaterStart = underwaterStartDate;
        longestUnderwaterEnd = candidatePoints[i].date;
      }
    }
    worstRelativeDrawdown = Math.min(worstRelativeDrawdown, rel / relativePeak - 1);
  }
  const lastC = candidatePoints[n - 1];
  const lastB = benchmarkPoints[n - 1];
  return {
    months: n,
    underperformanceMonths: underMonths,
    underperformanceRate: n > 1 ? underMonths / (n - 1) : null,
    longestUnderperformanceStreak,
    longestRelativeUnderwaterMonths: longestUnderwaterMonths,
    longestRelativeUnderwaterStart: longestUnderwaterStart,
    longestRelativeUnderwaterEnd: longestUnderwaterEnd,
    finalRelativeMultiple: lastB.value > 0 ? lastC.value / lastB.value : null,
    finalRelativeNav: lastB.nav > 0 ? lastC.nav / lastB.nav : null,
    worstRelativeGap: worstRelative,
    maxRelativeDrawdown: worstRelativeDrawdown,
  };
}

function summarizePortfolios(portfolios, finalPrices, actionStats) {
  const qqqPoints = portfolios.qqq?.points || [];
  return Object.entries(portfolios).map(([key, portfolio]) => {
    const finalValue = valueOf(portfolio, finalPrices);
    const finalTime = new Date(`${finalPrices.date}T00:00:00Z`).getTime();
    const flows = [...portfolio.flows, { time: finalTime, amount: finalValue }];
    const signalLike = key.startsWith("signal");
    const risk = riskStats(portfolio.points);
    const multiple = portfolio.contributed > 0 ? finalValue / portfolio.contributed : null;
    const vsQqq = key === "qqq" ? null : relativeEdge(portfolio.points, qqqPoints);
    return {
      key,
      finalValue,
      contributed: portfolio.contributed,
      fees: portfolio.fees,
      costBps: portfolio.costBps,
      multiple,
      irr: xirr(flows),
      maxDrawdown: portfolio.maxDrawdown,
      regression: regression(portfolio.points),
      risk,
      calmar: portfolio.maxDrawdown < 0 && Number.isFinite(risk?.sharpe)
        ? (multiple != null && portfolio.points.at(-1)?.year > 0
          ? ((multiple ** (1 / portfolio.points.at(-1).year)) - 1) / Math.abs(portfolio.maxDrawdown)
          : null)
        : null,
      vsQqq,
      points: portfolio.points,
      actionCounts: signalLike ? actionCountsFromStats(actionStats) : undefined,
      actionStats: key === "signal" ? actionStats : undefined,
    };
  });
}

function sensitivityGrid(data, startDate, monthlyAmount, states, costBps = DEFAULT_COST_BPS) {
  const drawdownMultipliers = [0.8, 1, 1.2];
  const vixMultipliers = [0.8, 1, 1.2];
  const points = [];
  for (const drawdownScale of drawdownMultipliers) {
    for (const vixScale of vixMultipliers) {
      const thresholds = {
        ...DEFAULT_THRESHOLDS,
        deepDrawdown: DEFAULT_THRESHOLDS.deepDrawdown * drawdownScale,
        panicVix: DEFAULT_THRESHOLDS.panicVix * vixScale,
      };
      const { finalPrices, portfolios, actionCounts } = runBacktest(data, startDate, monthlyAmount, thresholds, states, null, costBps);
      const signal = portfolios.signal;
      points.push({
        drawdownThreshold: thresholds.deepDrawdown,
        panicVixThreshold: thresholds.panicVix,
        finalValue: valueOf(signal, finalPrices),
        multiple: signal.contributed > 0 ? valueOf(signal, finalPrices) / signal.contributed : null,
        bottomAttackCount: actionCounts.bottomAttack,
      });
    }
  }
  const finals = points.map((point) => point.finalValue);
  return {
    varied: ["deepDrawdown", "panicVix"],
    note: "Signal strategy rerun across a 3x3 +/-20% grid for the two bottom-attack thresholds.",
    minFinalValue: Math.min(...finals),
    maxFinalValue: Math.max(...finals),
    points,
  };
}

function maxNavDrawdown(points) {
  let peak = 0;
  let drawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.nav || 0);
    if (peak > 0) drawdown = Math.min(drawdown, point.nav / peak - 1);
  }
  return drawdown;
}

function actionCountsInWindow(points) {
  const counts = Object.fromEntries(ACTION_KEYS.map((key) => [key, 0]));
  for (const point of points) {
    if (point.actionKey && counts[point.actionKey] != null) counts[point.actionKey] += 1;
  }
  return counts;
}

function eventRecaps(strategies) {
  return EVENT_WINDOWS.map((event) => {
    const strategiesInWindow = strategies.map((strategy) => {
      const points = strategy.points.filter((point) => point.date >= event.start && point.date <= event.end);
      if (points.length < 2) return null;
      const first = points[0];
      const last = points.at(-1);
      return {
        key: strategy.key,
        startNav: first.nav,
        endNav: last.nav,
        returnPct: first.nav > 0 ? last.nav / first.nav - 1 : null,
        maxDrawdown: maxNavDrawdown(points),
        actionCounts: strategy.key.startsWith("signal") ? actionCountsInWindow(points) : undefined,
      };
    }).filter(Boolean);
    return { ...event, strategies: strategiesInWindow };
  }).filter((event) => event.strategies.length);
}

function thresholdVariants() {
  const variants = [];
  for (const drawdownScale of [0.8, 1, 1.2]) {
    for (const vixScale of [0.8, 1, 1.2]) {
      variants.push({
        ...DEFAULT_THRESHOLDS,
        deepDrawdown: DEFAULT_THRESHOLDS.deepDrawdown * drawdownScale,
        panicVix: DEFAULT_THRESHOLDS.panicVix * vixScale,
      });
    }
  }
  return variants;
}

function trainScore(portfolios, finalPrices) {
  const signal = portfolios.signal;
  const qqq = portfolios.qqq;
  const signalValue = valueOf(signal, finalPrices);
  const qqqValue = valueOf(qqq, finalPrices);
  const signalRisk = riskStats(signal.points);
  const excess = qqqValue > 0 ? signalValue / qqqValue : 1;
  // Prefer risk-adjusted excess over raw terminal wealth to reduce bull-market overfitting.
  const sharpe = signalRisk.sharpe == null ? 0 : signalRisk.sharpe;
  const ddPenalty = 1 + Math.abs(signal.maxDrawdown || 0);
  return (excess * (1 + Math.max(0, sharpe))) / ddPenalty;
}

function walkForward(data, startDate, monthlyAmount, states, costBps = DEFAULT_COST_BPS) {
  const latest = (data.prices || []).at(-1)?.date;
  if (!latest) return [];
  return ["2010-01-01", "2015-01-01", "2020-01-01", "2025-01-01"].filter((split) => split > startDate && split < latest).map((split) => {
    let best = null;
    for (const thresholds of thresholdVariants()) {
      const result = runBacktest(data, startDate, monthlyAmount, thresholds, states, split, costBps);
      const score = trainScore(result.portfolios, result.finalPrices);
      const finalValue = valueOf(result.portfolios.signal, result.finalPrices);
      if (!best || score > best.trainScore) {
        best = {
          thresholds,
          trainScore: score,
          trainFinalValue: finalValue,
          trainBottomAttackCount: result.actionCounts.bottomAttack,
        };
      }
    }
    const bestForward = runBacktest(data, split, monthlyAmount, best.thresholds, states, null, costBps);
    const defaultForward = runBacktest(data, split, monthlyAmount, DEFAULT_THRESHOLDS, states, null, costBps);
    const bestSignal = valueOf(bestForward.portfolios.signal, bestForward.finalPrices);
    const bestQqq = valueOf(bestForward.portfolios.qqq, bestForward.finalPrices);
    const defaultSignal = valueOf(defaultForward.portfolios.signal, defaultForward.finalPrices);
    const defaultQqq = valueOf(defaultForward.portfolios.qqq, defaultForward.finalPrices);
    return {
      split,
      trainStart: startDate,
      trainEnd: split,
      validationStart: split,
      validationEnd: bestForward.finalPrices.date,
      bestThresholds: {
        deepDrawdown: best.thresholds.deepDrawdown,
        panicVix: best.thresholds.panicVix,
      },
      trainFinalValue: best.trainFinalValue,
      trainScore: best.trainScore,
      trainBottomAttackCount: best.trainBottomAttackCount,
      validationFinalValue: bestSignal,
      defaultValidationFinalValue: defaultSignal,
      validationVsQqq: bestQqq > 0 ? bestSignal / bestQqq : null,
      defaultValidationVsQqq: defaultQqq > 0 ? defaultSignal / defaultQqq : null,
      validationBottomAttackCount: bestForward.actionCounts.bottomAttack,
    };
  });
}

function runBacktest(data, startDate, monthlyAmount, thresholds = DEFAULT_THRESHOLDS, states = null, endDate = null, costBps = DEFAULT_COST_BPS) {
  const { nasdaq, vix, capeLatestFirst } = data;
  const prices = data.prices || buildPrices(data.nasdaq, data.qqq, data.tqqq, data.rates);
  if (startDate > prices.at(-1).date) throw new HttpError(400, "Start is after the latest available market date.");
  const capeChrono = capeSeriesForBacktest(capeLatestFirst).reverse();
  const portfolios = {
    qqq: emptyPortfolio(costBps),
    tqqq: emptyPortfolio(costBps),
    blend8020: emptyPortfolio(costBps),
    signal: emptyPortfolio(costBps),
    signalQqq: emptyPortfolio(costBps),
    signalTqqq: emptyPortfolio(costBps),
  };
  let lastMonth = "";
  let startTime = null;
  let signalMemory = { heatMonths: 0, rampMonths: 0, month: "" };
  const capeCursor = { index: 0 };
  let executedThisMonth = false;
  let monthAction = null;
  let monthDecisionDate = null;
  let monthExecutionDate = null;
  let pendingAction = null;
  let previousPrice = null;
  let lastSignalRecordedValue = null;
  const actionStats = emptyActionStats();

  const recordMonth = () => {
    if (!previousPrice || startTime == null) return;
    const signalValue = valueOf(portfolios.signal, previousPrice);
    const attributionKey = monthAction || "normalDca";
    if (lastSignalRecordedValue != null && actionStats[attributionKey]) {
      // Rough path attribution only. Includes market beta; not causal alpha.
      actionStats[attributionKey].estimatedPnL += signalValue - lastSignalRecordedValue - monthlyAmount;
    }
    lastSignalRecordedValue = signalValue;
    const qqqPrice = previousPrice.qqqClose || null;
    for (const [key, portfolio] of Object.entries(portfolios)) {
      record(portfolio, previousPrice, startTime, key.startsWith("signal") ? monthAction : null, qqqPrice, {
        decisionDate: monthDecisionDate,
        executionDate: monthExecutionDate,
      });
    }
  };

  for (let i = 30; i < prices.length; i += 1) {
    const price = prices[i];
    if (price.date < startDate) continue;
    if (endDate && price.date > endDate) break;
    if (startTime == null) startTime = new Date(`${price.date}T00:00:00Z`).getTime();

    for (const portfolio of Object.values(portfolios)) accrueCash(portfolio, price);

    const month = price.date.slice(0, 7);
    if (month !== lastMonth) {
      recordMonth();
      lastMonth = month;
      executedThisMonth = false;
      monthAction = null;
      monthDecisionDate = null;
      monthExecutionDate = null;

      for (const portfolio of Object.values(portfolios)) {
        addContribution(portfolio, monthlyAmount, price);
      }

      buyQQQ(portfolios.qqq, portfolios.qqq.cash, price.qqq);
      buyTQQQ(portfolios.tqqq, portfolios.tqqq.cash, price.tqqq);
      buyQQQ(portfolios.blend8020, portfolios.blend8020.cash * 0.8, price.qqq);
      buyTQQQ(portfolios.blend8020, portfolios.blend8020.cash, price.tqqq);
    }

    if (pendingAction && pendingAction.decisionDate < price.date) {
      const priorAction = monthAction;
      applySignalAction(portfolios.signal, pendingAction.decision, price, monthlyAmount);
      applySignalQqqAction(portfolios.signalQqq, pendingAction.decision, price, monthlyAmount);
      applySignalTqqqAction(portfolios.signalTqqq, pendingAction.decision, price, monthlyAmount);
      signalMemory = memoryAfterAction(signalMemory, pendingAction.decision);
      if (priorAction && priorAction !== pendingAction.decision.key && actionStats[priorAction]) {
        actionStats[priorAction].count = Math.max(0, actionStats[priorAction].count - 1);
      }
      monthAction = pendingAction.decision.key;
      monthDecisionDate = pendingAction.decisionDate;
      monthExecutionDate = price.date;
      actionStats[monthAction].count += 1;
      executedThisMonth = true;
      pendingAction = null;
    }

    const state = states?.[i] || stateAt(i, price, nasdaq, vix, capeChrono, capeCursor);
    signalMemory = advanceSignalMonth(signalMemory, state, month, thresholds);
    const decision = calculateDecision(state, signalMemory, thresholds);
    if (!executedThisMonth && !pendingAction) {
      pendingAction = { decision, decisionDate: price.date, month };
    } else if (shouldUpgradeMonthAction(monthAction, decision.key)) {
      // Signal is known after this close; the upgraded manual order executes next session.
      pendingAction = { decision, decisionDate: price.date, month };
    }

    for (const portfolio of Object.values(portfolios)) {
      updateDrawdown(portfolio, price);
    }
    previousPrice = price;
  }

  recordMonth();
  const actionCounts = actionCountsFromStats(actionStats);
  return { finalPrices: previousPrice || prices.at(-1), portfolios, actionCounts, actionStats };
}

function rebalanceStaticAllocation(portfolio, prices, allocation) {
  const qqqWeight = Number(allocation?.qqqWeight);
  const tqqqWeight = Number(allocation?.tqqqWeight);
  if (!Number.isFinite(qqqWeight) || !Number.isFinite(tqqqWeight) || qqqWeight < 0 || tqqqWeight < 0 || qqqWeight + tqqqWeight > 1 + 1e-6) {
    throw new Error("Static allocation weights must be finite, non-negative, and sum to no more than 1.");
  }
  const total = valueOf(portfolio, prices);
  const targetTqqq = total * tqqqWeight;
  const targetQqq = total * qqqWeight;
  const currentTqqq = portfolio.tqqq * prices.tqqq;
  const currentQqq = portfolio.qqq * prices.qqq;
  if (currentTqqq > targetTqqq && currentTqqq > 0) sellTQQQ(portfolio, (currentTqqq - targetTqqq) / currentTqqq, prices.tqqq);
  if (currentQqq > targetQqq) sellQQQ(portfolio, currentQqq - targetQqq, prices.qqq);
  const nextTqqq = portfolio.tqqq * prices.tqqq;
  if (nextTqqq < targetTqqq) buyTQQQ(portfolio, targetTqqq - nextTqqq, prices.tqqq);
  const nextQqq = portfolio.qqq * prices.qqq;
  if (nextQqq < targetQqq) buyQQQ(portfolio, targetQqq - nextQqq, prices.qqq);
}

function runStaticAllocation(data, startDate, monthlyAmount, allocation, costBps = DEFAULT_COST_BPS) {
  const prices = data.prices || buildPrices(data.nasdaq, data.qqq, data.tqqq, data.rates);
  const portfolio = emptyPortfolio(costBps);
  let lastMonth = "";
  let startTime = null;
  let previousPrice = null;
  for (const price of prices) {
    if (price.date < startDate) continue;
    if (startTime == null) startTime = new Date(`${price.date}T00:00:00Z`).getTime();
    accrueCash(portfolio, price);
    const month = price.date.slice(0, 7);
    if (month !== lastMonth) {
      if (previousPrice) record(portfolio, previousPrice, startTime, null, previousPrice.qqqClose || null);
      lastMonth = month;
      addContribution(portfolio, monthlyAmount, price);
      rebalanceStaticAllocation(portfolio, price, allocation);
    }
    updateDrawdown(portfolio, price);
    previousPrice = price;
  }
  if (previousPrice) record(portfolio, previousPrice, startTime, null, previousPrice.qqqClose || null);
  return { portfolio, finalPrices: previousPrice || prices.at(-1) };
}

async function backtest({ start = "2010-02-11", monthly = 1000, cost = DEFAULT_COST_BPS } = {}) {
  const startDate = normalizeStart(start);
  const monthlyAmount = normalizeMonthly(monthly);
  const costBps = normalizeCostBps(cost);
  const data = loadSnapshotData();
  const dataSnapshotId = buildDataSnapshotId(data);
  const prices = buildPrices(data.nasdaq, data.qqq, data.tqqq, data.rates);
  data.prices = prices;
  const capeChrono = capeSeriesForBacktest(data.capeLatestFirst).reverse();
  const states = buildStates(prices, data.nasdaq, data.vix, capeChrono);
  const { finalPrices, portfolios, actionStats } = runBacktest(data, startDate, monthlyAmount, DEFAULT_THRESHOLDS, states, null, costBps);
  const strategies = summarizePortfolios(portfolios, finalPrices, actionStats);
  const dataQuality = buildDataQuality(data, prices);
  const actualTqqqStart = dataQuality.tqqqActualStart || startDate;
  const evidenceStart = startDate < actualTqqqStart ? actualTqqqStart : startDate;
  const evidenceRun = evidenceStart === startDate
    ? { finalPrices, portfolios, actionStats }
    : runBacktest(data, evidenceStart, monthlyAmount, DEFAULT_THRESHOLDS, states, null, costBps);
  const evidenceStrategies = summarizePortfolios(evidenceRun.portfolios, evidenceRun.finalPrices, evidenceRun.actionStats);
  const evidenceByKey = Object.fromEntries(evidenceStrategies.map((strategy) => [strategy.key, strategy]));
  const signalEvidence = evidenceByKey.signal;
  const qqqEvidence = evidenceByKey.qqq;
  const averageAllocation = signalEvidence.points.length
    ? {
      cashWeight: mean(signalEvidence.points.map((point) => point.cashWeight)),
      qqqWeight: mean(signalEvidence.points.map((point) => point.qqqWeight)),
      tqqqWeight: mean(signalEvidence.points.map((point) => point.tqqqWeight)),
    }
    : { cashWeight: 1, qqqWeight: 0, tqqqWeight: 0 };
  const allocationMatchedRun = runStaticAllocation(data, evidenceStart, monthlyAmount, averageAllocation, costBps);
  const allocationMatchedRisk = riskStats(allocationMatchedRun.portfolio.points);
  const allocationMatchedFinalValue = valueOf(allocationMatchedRun.portfolio, allocationMatchedRun.finalPrices);
  const signalVsStatic = relativeEdge(signalEvidence.points, allocationMatchedRun.portfolio.points);
  return {
    generatedAt: new Date().toISOString(),
    rulesetId: RULESET_ID,
    coreQqqHighRegimeFraction: CORE_QQQ_HIGH_REGIME_FRACTION,
    dataSnapshotId,
    start: startDate,
    monthly: monthlyAmount,
    costBps,
    executionLag: "nextTradingSession",
    staleSources: data.staleSources,
    end: finalPrices.date,
    dataQuality,
    thresholds: DEFAULT_THRESHOLDS,
    headline: {
      scopeStart: evidenceStart,
      scopeEnd: evidenceRun.finalPrices.date,
      syntheticExcluded: evidenceStart > startDate,
      signalVsQqq: signalEvidence?.vsQqq || null,
      signalMultiple: signalEvidence?.multiple ?? null,
      qqqMultiple: qqqEvidence?.multiple ?? null,
      signalMaxDrawdown: signalEvidence?.maxDrawdown ?? null,
      qqqMaxDrawdown: qqqEvidence?.maxDrawdown ?? null,
      signalIrr: signalEvidence?.irr ?? null,
      qqqIrr: qqqEvidence?.irr ?? null,
      signalSharpe: signalEvidence?.risk?.sharpe ?? null,
      qqqSharpe: qqqEvidence?.risk?.sharpe ?? null,
      bottomAttackCount: signalEvidence?.actionCounts?.bottomAttack ?? 0,
      pauseMonths: (signalEvidence?.actionCounts?.pauseAtHigh || 0) + (signalEvidence?.actionCounts?.trimHeat || 0),
      allocationMatched: {
        diagnostic: true,
        method: "exPostAverageCashQqqTqqqWeights",
        averageAllocation,
        finalValue: allocationMatchedFinalValue,
        multiple: allocationMatchedRun.portfolio.contributed > 0 ? allocationMatchedFinalValue / allocationMatchedRun.portfolio.contributed : null,
        maxDrawdown: allocationMatchedRun.portfolio.maxDrawdown,
        sharpe: allocationMatchedRisk.sharpe,
        signalVsStatic,
      },
    },
    modelNotes: {
      cape: `CAPE is S&P 500 Shiller PE, not Nasdaq-100 PE. Percentile uses a rolling ${CAPE_ROLLING_MONTHS / 12}-year monthly window. Backtests expose each monthly CAPE observation from the next month to avoid using a full-month average at that month's open. Cheap fires below the ${DEFAULT_THRESHOLDS.cheapCape}th percentile, or below the ${DEFAULT_THRESHOLDS.supportCape}th percentile when Nasdaq-100 is down ${Math.abs(DEFAULT_THRESHOLDS.supportDrawdown)}%+. The free historical table is not a point-in-time revision archive, so revision bias remains a disclosed limitation.`,
      drawdown: `Drawdown uses a rolling ${ROLLING_HIGH_DAYS / 252}-year high of 5-day Nasdaq-100 averages. Deep <= ${DEFAULT_THRESHOLDS.deepDrawdown}%, mild <= ${DEFAULT_THRESHOLDS.mildDrawdown}%.`,
      vix: `VIX is S&P 500 implied vol, used as a cross-asset panic proxy. Panic threshold is ${DEFAULT_THRESHOLDS.panicVix} on the 5-day average.`,
      cadence: `Monthly cash is contributed on the first trading day. A signal observed at a daily close executes at the next trading session. Intra-month upgrades follow the same one-session lag. During pause-at-high and heat-trim months, ${CORE_QQQ_HIGH_REGIME_FRACTION * 100}% of the monthly contribution still buys core QQQ while new TQQQ buying stays paused. The main strategy enforces its ${RISK_POLICIES.aggressive.maxTqqq * 100}% TQQQ cap when a monthly action executes; market moves can drift above that cap between reviews.`,
      costs: `Each buy and sell includes ${costBps} bps of trading friction. QQQ/TQQQ use adjusted ETF closes when available; older pre-inception sections are synthetic. Synthetic QQQ adds a 0.7% dividend proxy. Synthetic TQQQ deducts 0.95% expense ratio plus approximate 2x financing cost. Cash earns FEDFUNDS when available, otherwise a coarse historical short-rate approximation.`,
      tqqqHoldingCosts: "Buying TQQQ shares with cash does not create daily broker margin calls. Fund leverage, derivatives, financing, fees, compounding, and tracking effects are embedded in actual adjusted TQQQ closes after inception and approximated in synthetic pre-inception data. Broker margin interest is excluded and should be added separately if TQQQ is bought with borrowed money.",
      wrappers: "Tactical QQQ and tactical TQQQ reuse the same monthly signal decision, but restrict trades to one ETF plus cash.",
      sharpe: "Sharpe uses monthly unit-NAV excess returns over the modeled cash rate, annualized by sqrt(12).",
      evidence: `The headline excludes synthetic TQQQ history and starts at ${evidenceStart}. The allocation-matched benchmark is an ex-post diagnostic rebalanced monthly to the signal strategy's average cash, QQQ, and TQQQ weights; it is not an investable pre-registered rule.`,
      rareActions: `Fast-crash defense executed ${signalEvidence?.actionCounts?.crashDefense || 0} times in the headline sample. Treat it as a mechanical guardrail, not a statistically validated source of protection.`,
      limits: "The 50% high-regime QQQ rate is a design choice, not an optimized parameter. It reduces long bull-market cash drag but increases cold-start drawdown: in the bundled 2023-start audit, signal max drawdown was about 26.2% versus 22.8% for QQQ. The worst recent rolling endpoint was a 2025-01 start ending 2025-04, when deliberate market participation lagged the cash-heavier prior rule by about 6.5%. No taxes, no residual tracking error after inception, and no broker constraints. Attribution is path-linked, not causal. Past edge versus QQQ DCA is not a guarantee of future edge.",
      notAdvice: "This dashboard is a research and process tool, not investment advice.",
    },
    strategies,
    sensitivity: sensitivityGrid(data, startDate, monthlyAmount, states, costBps),
    events: eventRecaps(strategies),
    walkForward: walkForward(data, startDate, monthlyAmount, states, costBps),
  };
}

module.exports = {
  backtest,
  calculateDecision,
  decisionConfidence,
  CORE_QQQ_HIGH_REGIME_FRACTION,
  DEFAULT_COST_BPS,
  DEFAULT_THRESHOLDS,
  RISK_POLICIES,
  RULESET_ID,
  buildDataSnapshotId,
  capeSeriesForBacktest,
  fetchText,
  loadData,
  loadSnapshotData,
  marketSnapshot,
  parseCapeTable,
  fetchFredSeries,
  fetchYahooSeries,
  sendJson,
  signalGroups,
  sourceIsStale,
  yahooBarIsOpen,
  runBacktest,
};
