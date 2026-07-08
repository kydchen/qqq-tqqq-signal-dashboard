const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";
const CAPE_URL = "https://www.multpl.com/shiller-pe/table/by-month";
const CACHE_MS = 15 * 60 * 1000;

let cache = null;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", status < 400 ? "s-maxage=900, stale-while-revalidate=3600" : "no-store");
  res.end(body);
}

async function fetchText(url, timeoutMs = 12000, headers = {}) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers });
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.text();
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function fetchYahooSeries(symbol, name) {
  const period1 = symbol === "^VIX" ? 631152000 : 497000000;
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const url = `${YAHOO_CHART}${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
  const text = await fetchText(url, 12000, { "User-Agent": "Mozilla/5.0" });
  const payload = JSON.parse(text);
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const out = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const value = Number(closes[i]);
    if (Number.isFinite(value) && value > 0) {
      out.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), value });
    }
  }
  if (out.length < 60) throw new Error(`${name} returned too few observations`);
  return out;
}

function cleanCell(text) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&#x2002;|&nbsp;/g, "")
    .trim();
}

function parseCapeTable(text) {
  const rows = [...text.matchAll(/<tr[^>]*>\s*<td>(.*?)<\/td>\s*<td>\s*(.*?)\s*<\/td>\s*<\/tr>/gis)];
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

async function loadData() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const [nasdaq, vix, capeText] = await Promise.all([
    fetchYahooSeries("^NDX", "Nasdaq-100"),
    fetchYahooSeries("^VIX", "VIX"),
    fetchText(CAPE_URL),
  ]);
  const data = {
    nasdaq,
    vix,
    capeLatestFirst: parseCapeTable(capeText),
  };
  cache = { at: Date.now(), data };
  return data;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, value) {
  return 100 * values.filter((item) => item <= value).length / values.length;
}

function calculateDecision(state) {
  const lowSignals = {
    valuationCheap: state.capePercentile < 20,
    deepDrawdown: state.drawdownPct <= -20,
    panicVix: state.vix >= 40,
  };
  const defensiveFlags = {
    valuationHigh: state.capePercentile >= 70,
    bubbleWatch: state.capePercentile >= 85,
    nearHigh: state.drawdownPct > -5,
    fastCrash: state.crash25dPct <= -12,
    quietVix: state.vix <= 12,
  };
  const lowSignalCount = Object.values(lowSignals).filter(Boolean).length;
  let key = "normalDca";
  if (lowSignalCount >= 2) key = "bottomAttack";
  else if (lowSignalCount === 1) key = "smallDipBuy";
  else if (defensiveFlags.fastCrash) key = "crashDefense";
  else if (defensiveFlags.bubbleWatch || defensiveFlags.quietVix) key = "trimHeat";
  else if (defensiveFlags.valuationHigh && defensiveFlags.nearHigh) key = "pauseAtHigh";
  return { key, lowSignalCount, lowSignals, defensiveFlags };
}

async function marketSnapshot() {
  const { nasdaq, vix, capeLatestFirst } = await loadData();
  const nasdaqValues = nasdaq.map((point) => point.value);
  const vixValues = vix.map((point) => point.value);
  const currentIndex = mean(nasdaqValues.slice(-5));
  const prior25d = mean(nasdaqValues.slice(-30, -25));
  const ath = Math.max(...nasdaqValues);
  const drawdownPct = 100 * (currentIndex / ath - 1);
  const crash25dPct = 100 * (currentIndex / prior25d - 1);
  const currentVix = mean(vixValues.slice(-5));
  const latestCape = capeLatestFirst[0];
  const capeValues = capeLatestFirst.map((point) => point.value);
  const capePercentile = percentile(capeValues, latestCape.value);
  const decision = calculateDecision({ capePercentile, drawdownPct, crash25dPct, vix: currentVix });

  return {
    generatedAt: new Date().toISOString(),
    indicators: {
      cape: {
        date: latestCape.label,
        value: latestCape.value,
        percentile: capePercentile,
        historyCount: capeValues.length,
        min: Math.min(...capeValues),
        max: Math.max(...capeValues),
      },
      nasdaq100: {
        date: nasdaq.at(-1).date,
        level5dAvg: currentIndex,
        ath,
        drawdownPct,
        crash25dPct,
      },
      vix: {
        date: vix.at(-1).date,
        value5dAvg: currentVix,
        latest: vix.at(-1).value,
      },
    },
    decision,
  };
}

function buildPrices(nasdaq) {
  const base = nasdaq[0].value;
  let tqqq = 1;
  return nasdaq.map((point, index) => {
    if (index > 0) {
      const daily = point.value / nasdaq[index - 1].value - 1;
      tqqq *= Math.max(0.0001, 1 + 3 * daily);
    }
    return {
      date: point.date,
      qqq: point.value / base,
      tqqq,
      ndx: point.value,
    };
  });
}

function emptyPortfolio() {
  return { cash: 0, qqq: 0, tqqq: 0, contributed: 0, peak: 0, maxDrawdown: 0, points: [], flows: [] };
}

function valueOf(portfolio, prices) {
  return portfolio.cash + portfolio.qqq * prices.qqq + portfolio.tqqq * prices.tqqq;
}

function buyQQQ(portfolio, amount, price) {
  const spend = Math.max(0, Math.min(portfolio.cash, amount));
  portfolio.cash -= spend;
  portfolio.qqq += spend / price;
}

function buyTQQQ(portfolio, amount, price) {
  const spend = Math.max(0, Math.min(portfolio.cash, amount));
  portfolio.cash -= spend;
  portfolio.tqqq += spend / price;
}

function sellQQQ(portfolio, amount, price) {
  const value = Math.max(0, Math.min(portfolio.qqq * price, amount));
  portfolio.qqq -= value / price;
  portfolio.cash += value;
}

function sellTQQQ(portfolio, fraction, price) {
  const shares = portfolio.tqqq * fraction;
  portfolio.tqqq -= shares;
  portfolio.cash += shares * price;
}

function sellTQQQWithFloor(portfolio, fraction, prices, floorPct) {
  const totalValue = valueOf(portfolio, prices);
  const tqqqValue = portfolio.tqqq * prices.tqqq;
  const floorValue = totalValue * floorPct;
  const sellValue = Math.max(0, Math.min(tqqqValue * fraction, tqqqValue - floorValue));
  if (sellValue <= 0) return;
  portfolio.tqqq -= sellValue / prices.tqqq;
  portfolio.cash += sellValue;
}

function buyTQQQToTarget(portfolio, targetPct, prices, rotationPct = 0) {
  const totalValue = valueOf(portfolio, prices);
  const targetValue = totalValue * targetPct;
  let need = Math.max(0, targetValue - portfolio.tqqq * prices.tqqq);
  if (need <= 0) return;
  const cashSpend = Math.min(portfolio.cash, need);
  buyTQQQ(portfolio, cashSpend, prices.tqqq);
  need -= cashSpend;
  if (need <= 0 || rotationPct <= 0) return;
  const rotateValue = Math.min(portfolio.qqq * prices.qqq * rotationPct, need);
  sellQQQ(portfolio, rotateValue, prices.qqq);
  buyTQQQ(portfolio, rotateValue, prices.tqqq);
}

function record(portfolio, prices, startTime, actionKey = null) {
  const value = valueOf(portfolio, prices);
  portfolio.peak = Math.max(portfolio.peak, value);
  if (portfolio.peak > 0) portfolio.maxDrawdown = Math.min(portfolio.maxDrawdown, value / portfolio.peak - 1);
  portfolio.points.push({
    date: prices.date,
    value,
    year: (new Date(`${prices.date}T00:00:00Z`).getTime() - startTime) / (365.25 * 24 * 3600 * 1000),
    actionKey,
  });
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
  const filtered = points.filter((point) => point.value > 0);
  const n = filtered.length;
  if (n < 36 || filtered.at(-1).year < 3) {
    return { intercept: null, slope: null, annualized: null, r2: null };
  }
  const sx = filtered.reduce((sum, point) => sum + point.year, 0);
  const sy = filtered.reduce((sum, point) => sum + Math.log(point.value), 0);
  const sxx = filtered.reduce((sum, point) => sum + point.year * point.year, 0);
  const sxy = filtered.reduce((sum, point) => sum + point.year * Math.log(point.value), 0);
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const yMean = sy / n;
  const ssTot = filtered.reduce((sum, point) => sum + (Math.log(point.value) - yMean) ** 2, 0);
  const ssRes = filtered.reduce((sum, point) => {
    const fit = intercept + slope * point.year;
    return sum + (Math.log(point.value) - fit) ** 2;
  }, 0);
  return { intercept, slope, annualized: Math.exp(slope) - 1, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot };
}

function stateAt(index, prices, nasdaq, vixByDate, capeChrono, capeCursor) {
  const current5 = mean(nasdaq.slice(Math.max(0, index - 4), index + 1).map((point) => point.value));
  const previous5 = mean(nasdaq.slice(Math.max(0, index - 29), Math.max(1, index - 24)).map((point) => point.value));
  const ath = Math.max(...nasdaq.slice(0, index + 1).map((point) => point.value));
  const drawdownPct = 100 * (current5 / ath - 1);
  const crash25dPct = previous5 ? 100 * (current5 / previous5 - 1) : 0;
  const date = prices.date;
  const vixValues = vixByDate.filter((point) => point.date <= date).slice(-5).map((point) => point.value);
  const vix = vixValues.length ? mean(vixValues) : 20;
  while (capeCursor.index + 1 < capeChrono.length && capeChrono[capeCursor.index + 1].date <= date) {
    capeCursor.index += 1;
  }
  const capeSlice = capeChrono.slice(0, capeCursor.index + 1).map((point) => point.value);
  const capePercentile = percentile(capeSlice, capeChrono[capeCursor.index].value);
  return { capePercentile, drawdownPct, crash25dPct, vix };
}

async function backtest({ start = "2000-01", monthly = 1000 } = {}) {
  const { nasdaq, vix, capeLatestFirst } = await loadData();
  const startDate = `${start.length === 7 ? `${start}-01` : start}`;
  const monthlyAmount = Math.max(100, Math.min(1000000, Number(monthly) || 1000));
  const prices = buildPrices(nasdaq);
  const capeChrono = [...capeLatestFirst].reverse();
  const portfolios = {
    qqq: emptyPortfolio(),
    tqqq: emptyPortfolio(),
    blend8020: emptyPortfolio(),
    signal: emptyPortfolio(),
  };
  let lastMonth = "";
  let startTime = null;
  let signalRampMonths = 0;
  let heatMonths = 0;
  const capeCursor = { index: 0 };

  for (let i = 30; i < prices.length; i += 1) {
    const price = prices[i];
    if (price.date < startDate) continue;
    const month = price.date.slice(0, 7);
    if (month === lastMonth) continue;
    lastMonth = month;
    if (startTime == null) startTime = new Date(`${price.date}T00:00:00Z`).getTime();

    const state = stateAt(i, price, nasdaq, vix, capeChrono, capeCursor);
    const decision = calculateDecision(state);
    for (const portfolio of Object.values(portfolios)) {
      portfolio.cash += monthlyAmount;
      portfolio.contributed += monthlyAmount;
      portfolio.flows.push({ time: new Date(`${price.date}T00:00:00Z`).getTime(), amount: -monthlyAmount });
    }

    buyQQQ(portfolios.qqq, portfolios.qqq.cash, price.qqq);
    buyTQQQ(portfolios.tqqq, portfolios.tqqq.cash, price.tqqq);
    buyQQQ(portfolios.blend8020, portfolios.blend8020.cash * 0.8, price.qqq);
    buyTQQQ(portfolios.blend8020, portfolios.blend8020.cash, price.tqqq);

    let signalAction = decision.key;
    const isHeat = decision.defensiveFlags.bubbleWatch || decision.defensiveFlags.quietVix;
    heatMonths = isHeat ? heatMonths + 1 : 0;
    if (decision.key === "bottomAttack") {
      buyTQQQ(portfolios.signal, portfolios.signal.cash, price.tqqq);
      signalRampMonths = 6;
      heatMonths = 0;
    } else if (decision.key === "crashDefense") {
      sellTQQQ(portfolios.signal, 0.5, price.tqqq);
      signalRampMonths = 0;
    } else if (signalRampMonths > 0) {
      buyTQQQToTarget(portfolios.signal, 0.9, price, 1 / signalRampMonths);
      signalRampMonths -= 1;
      signalAction = "rampTqqq";
    } else if (decision.key === "smallDipBuy") {
      buyQQQ(portfolios.signal, Math.min(portfolios.signal.cash, monthlyAmount * 2), price.qqq);
      heatMonths = 0;
    } else if (isHeat && heatMonths >= 6) {
      sellTQQQWithFloor(portfolios.signal, 1 / 12, price, 0.2);
      signalAction = "trimHeat";
    } else if (decision.key === "pauseAtHigh" || isHeat) {
      signalAction = "pauseAtHigh";
    } else if (decision.key === "normalDca") {
      buyTQQQToTarget(portfolios.signal, 0.2, price);
      const drip = Math.min(portfolios.signal.cash, monthlyAmount + Math.max(0, portfolios.signal.cash - monthlyAmount) / 6);
      buyQQQ(portfolios.signal, drip, price.qqq);
    }

    for (const [key, portfolio] of Object.entries(portfolios)) {
      record(portfolio, price, startTime, key === "signal" ? signalAction : null);
    }
  }

  const finalPrices = prices.at(-1);
  return {
    start: startDate,
    monthly: monthlyAmount,
    end: finalPrices.date,
    strategies: Object.entries(portfolios).map(([key, portfolio]) => {
      const finalValue = valueOf(portfolio, finalPrices);
      const finalTime = new Date(`${finalPrices.date}T00:00:00Z`).getTime();
      const flows = [...portfolio.flows, { time: finalTime, amount: finalValue }];
      return {
        key,
        finalValue,
        contributed: portfolio.contributed,
        multiple: finalValue / portfolio.contributed,
        irr: xirr(flows),
        maxDrawdown: portfolio.maxDrawdown,
        regression: regression(portfolio.points),
        points: portfolio.points,
      };
    }),
  };
}

module.exports = {
  backtest,
  calculateDecision,
  fetchText,
  marketSnapshot,
  parseCapeTable,
  fetchYahooSeries,
  sendJson,
};
