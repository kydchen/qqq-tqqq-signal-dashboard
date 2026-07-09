const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";
const CAPE_URL = "https://www.multpl.com/shiller-pe/table/by-month";
const CACHE_MS = 15 * 60 * 1000;
const VALID_STARTS = new Set(["1990-01-01", "1995-01-01", "2000-01-01", "2005-01-01", "2010-01-01", "2015-01-01", "2020-01-01", "2025-01-01"]);
const VALID_MONTHLY = new Set([1000]);
const CAPE_ROLLING_MONTHS = 360;
const ROLLING_HIGH_DAYS = 252 * 5;
const QQQ_DIVIDEND_YIELD = 0.007;
const TQQQ_EXPENSE_RATIO = 0.0095;
const TQQQ_SWAP_SPREAD = 0.005;
const NDX_PERIOD1 = 497000000; // 1985-10; earliest Yahoo ^NDX range used by this app.
const VIX_PERIOD1 = 631152000; // 1990-01; UI start years intentionally do not go earlier.
const DEFAULT_THRESHOLDS = {
  cheapCape: 20,
  highCape: 70,
  bubbleCape: 85,
  deepDrawdown: -20,
  fastCrash: -12,
  panicVix: 40,
  quietVix: 12,
};
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
      await sleep(error.retryAfterMs || (500 + Math.floor(Math.random() * 500)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function fetchYahooSeries(symbol, name, options = {}) {
  const period1 = symbol === "^VIX" ? VIX_PERIOD1 : NDX_PERIOD1;
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const url = `${YAHOO_CHART}${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
  const text = await fetchText(url, 6000, { "User-Agent": "Mozilla/5.0" });
  const payload = JSON.parse(text);
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const adjCloses = result?.indicators?.adjclose?.[0]?.adjclose || [];
  const out = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const close = Number(closes[i]);
    const adjClose = Number(adjCloses[i]);
    const value = options.adjusted && Number.isFinite(adjClose) && adjClose > 0 ? adjClose : close;
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
  const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`);
  return csv.trim().split(/\r?\n/).slice(1).map((line) => {
    const [date, raw] = line.split(",");
    const value = Number(raw);
    return Number.isFinite(value) ? { date, value: value / 100 } : null;
  }).filter(Boolean);
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
  return out;
}

async function cachedSource(key, loader) {
  const cached = sourceCache[key];
  if (cached && Date.now() - cached.at < CACHE_MS) return { data: cached.data, stale: cached.stale };
  try {
    const data = await loader();
    const stale = Boolean(data.fromSnapshot);
    sourceCache[key] = { at: Date.now(), data, stale };
    return { data, stale };
  } catch (error) {
    if (cached) return { data: cached.data, stale: true, error: error.message };
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
        return parseCapeTable(await fetchText(CAPE_URL));
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
  return {
    nasdaq: nasdaq.data,
    qqq: qqq.data,
    tqqq: tqqq.data,
    vix: vix.data,
    rates: rates.data,
    capeLatestFirst: cape.data,
    staleSources: [
      nasdaq.stale ? "Nasdaq-100" : null,
      qqq.stale ? "QQQ" : null,
      tqqq.stale ? "TQQQ" : null,
      vix.stale ? "VIX" : null,
      rates.stale ? "Rates" : null,
      cape.stale ? "CAPE" : null,
    ].filter(Boolean),
  };
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

function signalGroups(state, thresholds = DEFAULT_THRESHOLDS) {
  const lowSignals = {
    valuationCheap: state.capePercentile < thresholds.cheapCape,
    deepDrawdown: state.drawdownPct <= thresholds.deepDrawdown,
    panicVix: state.vixAvailable !== false && state.vix >= thresholds.panicVix,
  };
  const defensiveFlags = {
    valuationHigh: state.capePercentile >= thresholds.highCape,
    bubbleWatch: state.capePercentile >= thresholds.bubbleCape,
    nearHigh: state.drawdownPct > -5,
    fastCrash: state.crash25dPct <= thresholds.fastCrash,
    quietVix: state.vixAvailable !== false && state.vix <= thresholds.quietVix,
  };
  return { lowSignals, defensiveFlags, lowSignalCount: Object.values(lowSignals).filter(Boolean).length };
}

function advanceSignalMonth(memory, state, month, thresholds = DEFAULT_THRESHOLDS) {
  if (memory.month === month) return memory;
  const { defensiveFlags } = signalGroups(state, thresholds);
  const isHeat = defensiveFlags.bubbleWatch || defensiveFlags.quietVix;
  return {
    ...memory,
    month,
    heatMonths: isHeat ? (memory.heatMonths || 0) + 1 : 0,
  };
}

function normalizeStart(rawStart = "2000-01") {
  const match = String(rawStart || "2000-01").trim().match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
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

function calculateDecision(state, memory = {}, thresholds = DEFAULT_THRESHOLDS) {
  const { lowSignals, defensiveFlags, lowSignalCount } = signalGroups(state, thresholds);
  const isHeat = defensiveFlags.bubbleWatch || defensiveFlags.quietVix;
  const heatMonths = memory.heatMonths || 0;
  const rampMonths = memory.rampMonths || 0;
  let key = "normalDca";

  if (lowSignalCount >= 2) {
    key = "bottomAttack";
  } else if (defensiveFlags.fastCrash) {
    key = "crashDefense";
  } else if (rampMonths > 0) {
    key = "rampTqqq";
  } else if (lowSignalCount === 1) {
    key = "smallDipBuy";
  } else if (isHeat && heatMonths >= 6) {
    key = "trimHeat";
  } else if ((defensiveFlags.valuationHigh && defensiveFlags.nearHigh) || isHeat) {
    key = "pauseAtHigh";
  }

  return {
    key,
    lowSignalCount,
    lowSignals,
    defensiveFlags,
    heatMonths,
    rampMonths,
  };
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
  };
}

async function marketSnapshot() {
  const data = await loadData();
  const { nasdaq, qqq, tqqq, vix, rates, capeLatestFirst, staleSources } = data;
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
  const memory = replayDecisionMemory(prices, nasdaq, vix, capeChrono, currentMonth, DEFAULT_THRESHOLDS, states);
  const currentState = states.at(-1);
  const decision = calculateDecision(currentState, memory);
  const rollingHigh = currentIndex / (1 + currentState.drawdownPct / 100);

  return {
    generatedAt: new Date().toISOString(),
    staleSources,
    dataQuality: buildDataQuality(data, prices),
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

function emptyPortfolio() {
  return { cash: 0, qqq: 0, tqqq: 0, contributed: 0, units: 0, peak: 0, maxDrawdown: 0, points: [], flows: [] };
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
  portfolio.cash -= spend;
  portfolio.qqq += spend / price;
}

function buyTQQQ(portfolio, amount, price) {
  if (price <= 0) return;
  const spend = Math.max(0, Math.min(portfolio.cash, amount));
  portfolio.cash -= spend;
  portfolio.tqqq += spend / price;
}

function sellQQQ(portfolio, amount, price) {
  if (price <= 0) return;
  const value = Math.max(0, Math.min(portfolio.qqq * price, amount));
  portfolio.qqq -= value / price;
  portfolio.cash += value;
}

function sellTQQQ(portfolio, fraction, price) {
  if (price <= 0) return;
  const shares = portfolio.tqqq * fraction;
  portfolio.tqqq -= shares;
  portfolio.cash += shares * price;
}

function sellTQQQWithFloor(portfolio, fraction, prices, floorPct) {
  if (prices.tqqq <= 0) return;
  const totalValue = valueOf(portfolio, prices);
  const tqqqValue = portfolio.tqqq * prices.tqqq;
  const floorValue = totalValue * floorPct;
  const sellValue = Math.max(0, Math.min(tqqqValue * fraction, tqqqValue - floorValue));
  if (sellValue <= 0) return;
  portfolio.tqqq -= sellValue / prices.tqqq;
  portfolio.cash += sellValue;
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

function record(portfolio, prices, startTime, actionKey = null, qqqPrice = null) {
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
    year: (new Date(`${prices.date}T00:00:00Z`).getTime() - startTime) / (365.25 * 24 * 3600 * 1000),
    actionKey,
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
  const returns = [];
  let peak = 0;
  const drawdowns = [];
  for (let i = 0; i < points.length; i += 1) {
    const nav = points[i].nav;
    if (i > 0 && points[i - 1].nav > 0) returns.push(nav / points[i - 1].nav - 1);
    peak = Math.max(peak, nav);
    if (peak > 0) drawdowns.push(Math.min(0, nav / peak - 1));
  }
  const avg = returns.length ? mean(returns) : 0;
  const variance = returns.length > 1 ? returns.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (returns.length - 1) : 0;
  const sharpe = variance > 0 ? (avg / Math.sqrt(variance)) * Math.sqrt(12) : null;
  const ulcer = drawdowns.length ? Math.sqrt(drawdowns.reduce((sum, value) => sum + (value * 100) ** 2, 0) / drawdowns.length) : null;
  return { sharpe, ulcer };
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
  let executedThisMonth = new Set();
  for (let i = 30; i < prices.length; i += 1) {
    const price = prices[i];
    const month = price.date.slice(0, 7);
    if (month >= beforeMonth) break;
    if (month !== lastMonth) {
      lastMonth = month;
      executedThisMonth = new Set();
    }
    const state = states?.[i] || stateAt(i, price, nasdaq, vix, capeChrono, capeCursor);
    memory = advanceSignalMonth(memory, state, month, thresholds);
    const decision = calculateDecision(state, memory, thresholds);
    if (!executedThisMonth.has(decision.key)) {
      executedThisMonth.add(decision.key);
      memory = memoryAfterAction(memory, decision);
    }
  }
  return memory;
}

function applySignalAction(portfolio, decision, prices, monthlyAmount) {
  if (decision.key === "bottomAttack") {
    buyTQQQ(portfolio, portfolio.cash / 3, prices.tqqq);
  } else if (decision.key === "crashDefense") {
    sellTQQQ(portfolio, 0.5, prices.tqqq);
  } else if (decision.key === "rampTqqq") {
    const cashLimit = monthlySpendWithDrip(portfolio, monthlyAmount);
    buyTQQQToTarget(portfolio, 0.9, prices, 1 / Math.max(1, decision.rampMonths), cashLimit);
  } else if (decision.key === "smallDipBuy") {
    buyQQQ(portfolio, Math.min(portfolio.cash, monthlyAmount * 2), prices.qqq);
  } else if (decision.key === "trimHeat") {
    sellTQQQWithFloor(portfolio, 1 / 12, prices, 0.2);
  } else if (decision.key === "normalDca") {
    buyTQQQToTarget(portfolio, 0.2, prices);
    buyQQQ(portfolio, monthlySpendWithDrip(portfolio, monthlyAmount), prices.qqq);
  }
}

function monthlySpendWithDrip(portfolio, monthlyAmount, spareFraction = 1 / 6) {
  return Math.min(portfolio.cash, monthlyAmount + Math.max(0, portfolio.cash - monthlyAmount) * spareFraction);
}

function applySignalQqqAction(portfolio, decision, prices, monthlyAmount) {
  if (decision.key === "bottomAttack") {
    buyQQQ(portfolio, monthlySpendWithDrip(portfolio, monthlyAmount, 1 / 3), prices.qqq);
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

function summarizePortfolios(portfolios, finalPrices, actionStats) {
  return Object.entries(portfolios).map(([key, portfolio]) => {
    const finalValue = valueOf(portfolio, finalPrices);
    const finalTime = new Date(`${finalPrices.date}T00:00:00Z`).getTime();
    const flows = [...portfolio.flows, { time: finalTime, amount: finalValue }];
    const signalLike = key.startsWith("signal");
    return {
      key,
      finalValue,
      contributed: portfolio.contributed,
      multiple: portfolio.contributed > 0 ? finalValue / portfolio.contributed : null,
      irr: xirr(flows),
      maxDrawdown: portfolio.maxDrawdown,
      regression: regression(portfolio.points),
      risk: riskStats(portfolio.points),
      points: portfolio.points,
      actionCounts: signalLike ? actionCountsFromStats(actionStats) : undefined,
      actionStats: key === "signal" ? actionStats : undefined,
    };
  });
}

function sensitivityGrid(data, startDate, monthlyAmount, states) {
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
      const { finalPrices, portfolios, actionCounts } = runBacktest(data, startDate, monthlyAmount, thresholds, states);
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
        startValue: first.value,
        endValue: last.value,
        returnPct: first.value > 0 ? last.value / first.value - 1 : null,
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

function walkForward(data, startDate, monthlyAmount, states) {
  const latest = (data.prices || []).at(-1)?.date;
  if (!latest) return [];
  return ["2010-01-01", "2015-01-01", "2020-01-01", "2025-01-01"].filter((split) => split > startDate && split < latest).map((split) => {
    let best = null;
    for (const thresholds of thresholdVariants()) {
      const result = runBacktest(data, startDate, monthlyAmount, thresholds, states, split);
      const finalValue = valueOf(result.portfolios.signal, result.finalPrices);
      if (!best || finalValue > best.trainFinalValue) {
        best = {
          thresholds,
          trainFinalValue: finalValue,
          trainBottomAttackCount: result.actionCounts.bottomAttack,
        };
      }
    }
    const bestForward = runBacktest(data, split, monthlyAmount, best.thresholds, states);
    const defaultForward = runBacktest(data, split, monthlyAmount, DEFAULT_THRESHOLDS, states);
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
      trainBottomAttackCount: best.trainBottomAttackCount,
      validationFinalValue: valueOf(bestForward.portfolios.signal, bestForward.finalPrices),
      defaultValidationFinalValue: valueOf(defaultForward.portfolios.signal, defaultForward.finalPrices),
      validationBottomAttackCount: bestForward.actionCounts.bottomAttack,
    };
  });
}

function runBacktest(data, startDate, monthlyAmount, thresholds = DEFAULT_THRESHOLDS, states = null, endDate = null) {
  const { nasdaq, vix, capeLatestFirst } = data;
  const prices = data.prices || buildPrices(data.nasdaq, data.qqq, data.tqqq, data.rates);
  if (startDate > prices.at(-1).date) throw new HttpError(400, "Start is after the latest available market date.");
  const capeChrono = [...capeLatestFirst].reverse();
  const portfolios = {
    qqq: emptyPortfolio(),
    tqqq: emptyPortfolio(),
    blend8020: emptyPortfolio(),
    signal: emptyPortfolio(),
    signalQqq: emptyPortfolio(),
    signalTqqq: emptyPortfolio(),
  };
  let lastMonth = "";
  let startTime = null;
  let signalMemory = { heatMonths: 0, rampMonths: 0, month: "" };
  const capeCursor = { index: 0 };
  let executedThisMonth = new Set();
  let monthAction = null;
  let previousPrice = null;
  let lastSignalRecordedValue = null;
  const actionStats = emptyActionStats();

  const recordMonth = () => {
    if (!previousPrice || startTime == null) return;
    const signalValue = valueOf(portfolios.signal, previousPrice);
    const attributionKey = monthAction || "normalDca";
    if (lastSignalRecordedValue != null && actionStats[attributionKey]) {
      actionStats[attributionKey].estimatedPnL += signalValue - lastSignalRecordedValue - monthlyAmount;
    }
    lastSignalRecordedValue = signalValue;
    const qqqPrice = previousPrice.qqqClose || null;
    for (const [key, portfolio] of Object.entries(portfolios)) {
      record(portfolio, previousPrice, startTime, key.startsWith("signal") ? monthAction : null, qqqPrice);
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
      executedThisMonth = new Set();
      monthAction = null;

      for (const portfolio of Object.values(portfolios)) {
        addContribution(portfolio, monthlyAmount, price);
      }

      buyQQQ(portfolios.qqq, portfolios.qqq.cash, price.qqq);
      buyTQQQ(portfolios.tqqq, portfolios.tqqq.cash, price.tqqq);
      buyQQQ(portfolios.blend8020, portfolios.blend8020.cash * 0.8, price.qqq);
      buyTQQQ(portfolios.blend8020, portfolios.blend8020.cash, price.tqqq);
    }

    const state = states?.[i] || stateAt(i, price, nasdaq, vix, capeChrono, capeCursor);
    signalMemory = advanceSignalMonth(signalMemory, state, month, thresholds);
    const decision = calculateDecision(state, signalMemory, thresholds);
    if (!executedThisMonth.has(decision.key)) {
      executedThisMonth.add(decision.key);
      applySignalAction(portfolios.signal, decision, price, monthlyAmount);
      applySignalQqqAction(portfolios.signalQqq, decision, price, monthlyAmount);
      applySignalTqqqAction(portfolios.signalTqqq, decision, price, monthlyAmount);
      signalMemory = memoryAfterAction(signalMemory, decision);
      monthAction = decision.key;
      actionStats[decision.key].count += 1;
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

async function backtest({ start = "2000-01", monthly = 1000 } = {}) {
  const startDate = normalizeStart(start);
  const monthlyAmount = normalizeMonthly(monthly);
  const data = await loadData();
  const prices = buildPrices(data.nasdaq, data.qqq, data.tqqq, data.rates);
  data.prices = prices;
  const capeChrono = [...data.capeLatestFirst].reverse();
  const states = buildStates(prices, data.nasdaq, data.vix, capeChrono);
  const { finalPrices, portfolios, actionStats } = runBacktest(data, startDate, monthlyAmount, DEFAULT_THRESHOLDS, states);
  const strategies = summarizePortfolios(portfolios, finalPrices, actionStats);
  return {
    generatedAt: new Date().toISOString(),
    start: startDate,
    monthly: monthlyAmount,
    staleSources: data.staleSources,
    end: finalPrices.date,
    dataQuality: buildDataQuality(data, prices),
    modelNotes: {
      cape: `CAPE percentile uses a rolling ${CAPE_ROLLING_MONTHS / 12}-year monthly window.`,
      drawdown: `Drawdown uses a rolling ${ROLLING_HIGH_DAYS / 252}-year high of 5-day Nasdaq-100 averages.`,
      costs: "QQQ/TQQQ use adjusted ETF closes when available; older pre-inception sections are synthetic. Synthetic QQQ adds a 0.7% dividend proxy. Synthetic TQQQ deducts 0.95% expense ratio plus approximate 2x financing cost. Cash earns FEDFUNDS when available, otherwise a coarse historical short-rate approximation.",
      wrappers: "Signal-guided QQQ and signal-guided TQQQ reuse the same monthly signal decision, but restrict trades to one ETF plus cash.",
    },
    strategies,
    sensitivity: sensitivityGrid(data, startDate, monthlyAmount, states),
    events: eventRecaps(strategies),
    walkForward: walkForward(data, startDate, monthlyAmount, states),
  };
}

module.exports = {
  backtest,
  calculateDecision,
  fetchText,
  loadData,
  marketSnapshot,
  parseCapeTable,
  fetchFredSeries,
  fetchYahooSeries,
  sendJson,
};
