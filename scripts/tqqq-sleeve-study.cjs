#!/usr/bin/env node
/**
 * scripts/tqqq-sleeve-study.cjs — target-weight TQQQ sleeve study (research).
 *
 * Implements the FROZEN pre-registration in docs/target-tqqq-sleeve-prereg.md
 * (pre-registered 2026-07-21 Asia/Taipei, before implementation code or
 * output existed). The frozen spec is not modified by this script; the
 * implementation deviation declaration is "none" (see the report header for
 * the two implementation notes that are not deviations: the
 * smallDipBuy <-> "single-low / mild-dip" key mapping, and the pure-append
 * export of the production monthlySpendWithDrip so the drip rule is reused
 * verbatim rather than copied).
 *
 * Require-able: main() only runs when executed directly; the computed study
 * object and report renderer are exported for test/tqqq-sleeve.test.cjs.
 *
 * What this script does, mapped to the frozen spec:
 *
 *   Signal side (unchanged): loadSnapshotData / buildPrices / buildStates /
 *   capeSeriesForBacktest / createSignalMachine / signalMachineClose /
 *   signalMachineDue, all exported from api/_lib.js. T+1 execution and
 *   cross-month carry-in semantics match runBacktest (a decision locked at a
 *   month-end close executes on the next trading session; the machine's
 *   pending order carries across the month boundary without swallowing the
 *   new month's own lock) — the same reuse pattern as
 *   scripts/baseline-study.cjs.
 *
 *   Retained QQQ/cash incremental actions (executed BEFORE the sleeve
 *   rebalance), copied verbatim from production applySignalAction
 *   (api/_lib.js) and checked line by line against it:
 *     smallDipBuy:  buy QQQ min(2 x monthlyAmount, cash)
 *     trimHeat:     buy QQQ min(0.5 x monthlyAmount, cash)
 *     pauseAtHigh:  buy QQQ min(0.5 x monthlyAmount, cash)
 *     normalDca:    buy QQQ monthlySpendWithDrip(portfolio, monthlyAmount)
 *                   (production function, exported from api/_lib.js)
 *     bottomAttack / rampTqqq / crashDefense: no QQQ incremental action
 *                   (bottom/ramp firepower goes through the sleeve target;
 *                   crashDefense TQQQ handling goes through the sleeve)
 *   Month-start contribution, daily cash accrual, daily updateDrawdown, and
 *   month-end recording match runBacktest.
 *
 *   Sleeve target mapping (frozen): normalDca / smallDipBuy (= the spec's
 *   "single low signal / mild drawdown" state) 10%; bottomAttack 25%;
 *   rampTqqq month k with k = 7 - decision.rampMonths: 25% + 15% x k / 6
 *   (k = 1..6 -> 27.5%, 30%, 32.5%, 35%, 37.5%, 40%; the engine's rampMonths
 *   counts down 6..1, k counts up, not inverted); trimHeat max(10%, current
 *   weight x 11/12); pauseAtHigh freeze current weight (no trade);
 *   crashDefense current weight x 50%. The 40% TQQQ cap is enforced after
 *   every monthly execution, as in production.
 *
 *   Funding waterfall (frozen): retained actions first; NAV after them sets
 *   the target value; TQQQ below target spends remaining cash first, then
 *   sells QQQ for the shortfall and buys TQQQ with the proceeds (sell before
 *   buy); TQQQ above target is sold down to target and proceeds stay in
 *   cash; 5 bps friction per buy and sell, taken from cash; fractional
 *   shares fixed on; post-trade weights booked as executed, fee drift not
 *   corrected.
 *
 *   Variants: current strategy (runBacktest portfolios.signal directly for
 *   value metrics; a line-by-line local replica with turnover
 *   instrumentation, parity-asserted in the test suite, for turnover),
 *   exact sleeve (rebalance to the precise target every month), and the 2pp
 *   tolerance-band sleeve (trade only when the build-up-state weight
 *   deviates from target by more than 2 percentage points, then rebalance to
 *   the exact target; defensive states trimHeat / pauseAtHigh /
 *   crashDefense always execute their gradual rules directly and never pass
 *   through the band).
 *
 *   Path-independence evidence: the frozen convergence protocol — fixed date
 *   D, fixed total asset value, three starting portfolios (100% cash, 100%
 *   QQQ, the current production-strategy holding at D scaled to the total),
 *   one monthly execution per build-up state (normalDca, smallDipBuy,
 *   bottomAttack, rampTqqq k = 1..6). Simulation results are returned for
 *   the test suite, which re-derives the theoretical post-trade weights from
 *   the 5 bps ledger independently and asserts on them (1e-9 relative, no
 *   adjustable fee epsilon).
 */

const fs = require("fs");
const path = require("path");
const {
  loadSnapshotData,
  buildPrices,
  buildStates,
  buildDataSnapshotId,
  capeSeriesForBacktest,
  runBacktest,
  createSignalMachine,
  signalMachineClose,
  signalMachineDue,
  emptyPortfolio,
  accrueCash,
  addContribution,
  buyQQQ,
  buyTQQQ,
  sellQQQ,
  sellTQQQ,
  updateDrawdown,
  valueOf,
  riskStats,
  monthlySpendWithDrip,
  DEFAULT_THRESHOLDS,
  RISK_POLICIES,
  MAIN_SIGNAL_POLICY_KEY,
  CORE_QQQ_HIGH_REGIME_FRACTION,
} = require("../api/_lib");

const PREREG_PATH = "docs/target-tqqq-sleeve-prereg.md";
const PREREG_DATE = "2026-07-21";
const MONTHLY = 1000;
const COST_BPS = 5;
const FEE_RATE = COST_BPS / 10000;
const MAX_TQQQ = RISK_POLICIES[MAIN_SIGNAL_POLICY_KEY].maxTqqq; // 0.40
const BAND_PP = 0.02;
const STARTS = [
  "1990-01-01", "1995-01-01", "2000-01-01", "2005-01-01", "2010-01-01",
  "2010-02-11", "2015-01-01", "2020-01-01", "2023-01-01", "2024-01-01",
  "2025-01-01",
];
const TQQQ_ACTUAL_START = "2010-02-11";
const ACTUAL_ONLY_STARTS = STARTS.filter((start) => start >= TQQQ_ACTUAL_START);
const SYNTHETIC_TQQQ_STARTS = STARTS.filter((start) => start < TQQQ_ACTUAL_START);

// Convergence protocol constants (frozen protocol: fixed date, fixed total).
const CONVERGENCE_DATE_MIN = "2020-04-15"; // D = first trading day on/after this
const CONVERGENCE_TOTAL = 100000;
const CONVERGENCE_PRODUCTION_START = "2015-01-01";

// The four build-up states the 2pp band applies to. smallDipBuy is the
// engine action key for the spec's "single low signal / mild drawdown".
const BUILD_UP_KEYS = new Set(["normalDca", "smallDipBuy", "bottomAttack", "rampTqqq"]);

// ---------------------------------------------------------------------------
// Instrumented ledger: every trade flows through these wrappers so turnover
// is recorded uniformly across variants. Turnover convention (documented in
// the report): buys booked at cash spent, sells booked at gross value traded.
// ---------------------------------------------------------------------------
function makeLedger(portfolio) {
  return {
    turnover: 0,
    buyQQQ(amount, price) {
      const before = portfolio.cash;
      buyQQQ(portfolio, amount, price);
      this.turnover += before - portfolio.cash;
    },
    buyTQQQ(amount, price) {
      const before = portfolio.cash;
      buyTQQQ(portfolio, amount, price);
      this.turnover += before - portfolio.cash;
    },
    sellQQQ(amount, price) {
      const gross = Math.max(0, Math.min(portfolio.qqq * price, amount));
      sellQQQ(portfolio, amount, price);
      this.turnover += gross;
    },
    sellTQQQ(fraction, price) {
      const gross = Math.max(0, fraction) * portfolio.tqqq * price;
      sellTQQQ(portfolio, fraction, price);
      this.turnover += gross;
    },
  };
}

// Production-formula helpers copied from api/_lib.js (checked line by line;
// used by the current-strategy replica and by cap enforcement inside the
// sleeve rebalance). monthlySpendWithDrip itself is imported from _lib.
function enforceTqqqCapLocal(portfolio, prices, maxTqqq, ledger) {
  const total = valueOf(portfolio, prices);
  const tqqqValue = portfolio.tqqq * prices.tqqq;
  const excess = tqqqValue - total * maxTqqq;
  if (excess <= 0 || tqqqValue <= 0) return;
  const feeRate = (portfolio.costBps || 0) / 10000;
  const grossSale = excess / Math.max(1e-9, 1 - maxTqqq * feeRate);
  ledger.sellTQQQ(Math.min(1, grossSale / tqqqValue), prices.tqqq);
}

function sellTQQQWithFloorLocal(portfolio, fraction, prices, floorPct, ledger) {
  if (prices.tqqq <= 0) return;
  const totalValue = valueOf(portfolio, prices);
  const tqqqValue = portfolio.tqqq * prices.tqqq;
  const floorValue = totalValue * floorPct;
  const sellValue = Math.max(0, Math.min(tqqqValue * fraction, tqqqValue - floorValue));
  if (sellValue <= 0) return;
  ledger.sellTQQQ(Math.min(1, sellValue / tqqqValue), prices.tqqq);
}

function buyTQQQToTargetLocal(portfolio, targetPct, prices, rotationPct, cashLimit, ledger) {
  if (prices.tqqq <= 0) return;
  const totalValue = valueOf(portfolio, prices);
  const targetValue = totalValue * targetPct;
  let need = Math.max(0, targetValue - portfolio.tqqq * prices.tqqq);
  if (need <= 0) return;
  const cashSpend = Math.min(portfolio.cash, need, cashLimit);
  ledger.buyTQQQ(cashSpend, prices.tqqq);
  need -= cashSpend;
  if (need <= 0 || rotationPct <= 0) return;
  const rotateValue = Math.min(portfolio.qqq * prices.qqq * rotationPct, need);
  ledger.sellQQQ(rotateValue, prices.qqq);
  ledger.buyTQQQ(rotateValue, prices.tqqq);
}

// Verbatim copy of production applySignalAction (api/_lib.js) with ledger
// instrumentation. Used only by the current-strategy replica for turnover;
// the test suite asserts its final value matches runBacktest portfolios.signal.
function applyProductionActionLocal(portfolio, decision, prices, monthlyAmount, ledger) {
  const policy = RISK_POLICIES[MAIN_SIGNAL_POLICY_KEY];
  enforceTqqqCapLocal(portfolio, prices, policy.maxTqqq, ledger);
  if (decision.key === "bottomAttack") {
    buyTQQQToTargetLocal(portfolio, policy.bottomTqqqTarget, prices, 0.25, portfolio.cash / 3, ledger);
  } else if (decision.key === "crashDefense") {
    ledger.sellTQQQ(0.5, prices.tqqq);
  } else if (decision.key === "rampTqqq") {
    const cashLimit = monthlySpendWithDrip(portfolio, monthlyAmount);
    buyTQQQToTargetLocal(portfolio, policy.rampTqqqTarget, prices, 1 / Math.max(1, decision.rampMonths), cashLimit, ledger);
  } else if (decision.key === "smallDipBuy") {
    ledger.buyQQQ(Math.min(portfolio.cash, monthlyAmount * 2), prices.qqq);
  } else if (decision.key === "trimHeat") {
    ledger.buyQQQ(Math.min(portfolio.cash, monthlyAmount * CORE_QQQ_HIGH_REGIME_FRACTION), prices.qqq);
    sellTQQQWithFloorLocal(portfolio, 1 / 12, prices, policy.normalTqqqFloor, ledger);
  } else if (decision.key === "pauseAtHigh") {
    ledger.buyQQQ(Math.min(portfolio.cash, monthlyAmount * CORE_QQQ_HIGH_REGIME_FRACTION), prices.qqq);
  } else if (decision.key === "normalDca") {
    buyTQQQToTargetLocal(portfolio, policy.normalTqqqFloor, prices, 0, Infinity, ledger);
    ledger.buyQQQ(monthlySpendWithDrip(portfolio, monthlyAmount), prices.qqq);
  }
}

// ---------------------------------------------------------------------------
// Sleeve semantics (frozen).
// ---------------------------------------------------------------------------

// Retained QQQ/cash incremental legs, executed before the sleeve rebalance.
// Copied verbatim from production applySignalAction's QQQ legs.
function applyRetainedQqqLeg(portfolio, key, prices, monthlyAmount, ledger) {
  if (key === "smallDipBuy") {
    ledger.buyQQQ(Math.min(portfolio.cash, monthlyAmount * 2), prices.qqq);
  } else if (key === "trimHeat" || key === "pauseAtHigh") {
    ledger.buyQQQ(Math.min(portfolio.cash, monthlyAmount * CORE_QQQ_HIGH_REGIME_FRACTION), prices.qqq);
  } else if (key === "normalDca") {
    ledger.buyQQQ(monthlySpendWithDrip(portfolio, monthlyAmount), prices.qqq);
  }
  // bottomAttack / rampTqqq / crashDefense: no QQQ incremental action.
}

// Frozen target mapping. currentWeight is the TQQQ weight after the
// retained legs, on post-retained NAV.
function sleeveTargetWeight(decision, currentWeight) {
  const key = decision.key;
  if (key === "normalDca" || key === "smallDipBuy") return 0.10;
  if (key === "bottomAttack") return 0.25;
  if (key === "rampTqqq") {
    const k = 7 - decision.rampMonths; // rampMonths counts down 6..1; k counts up 1..6
    return 0.25 + (0.15 * k) / 6;
  }
  if (key === "trimHeat") return Math.max(0.10, (currentWeight * 11) / 12);
  if (key === "pauseAtHigh") return currentWeight; // freeze: no trade
  if (key === "crashDefense") return currentWeight * 0.5;
  return currentWeight;
}

// Frozen funding waterfall: cash first, then sell QQQ for the shortfall and
// buy TQQQ with the proceeds (sell before buy); excess TQQQ is sold down to
// target and proceeds stay in cash. The 40% cap is enforced after the
// rebalance, as in production.
function sleeveRebalance(portfolio, prices, targetWeight, ledger) {
  const nav = valueOf(portfolio, prices);
  if (nav <= 0) return;
  const tqqqValue = portfolio.tqqq * prices.tqqq;
  const targetValue = targetWeight * nav;
  if (tqqqValue < targetValue) {
    const need = targetValue - tqqqValue;
    const cashSpend = Math.min(portfolio.cash, need);
    ledger.buyTQQQ(cashSpend, prices.tqqq);
    const remaining = need - cashSpend;
    if (remaining > 1e-12) {
      const qqqValue = portfolio.qqq * prices.qqq;
      const sale = Math.min(qqqValue, remaining);
      if (sale > 0) {
        const proceeds = sale * (1 - (portfolio.costBps || 0) / 10000);
        ledger.sellQQQ(sale, prices.qqq);
        ledger.buyTQQQ(proceeds, prices.tqqq);
      }
    }
  } else if (tqqqValue > targetValue) {
    ledger.sellTQQQ((tqqqValue - targetValue) / tqqqValue, prices.tqqq);
  }
  enforceTqqqCapLocal(portfolio, prices, MAX_TQQQ, ledger);
}

// One monthly execution of a sleeve variant: retained QQQ/cash leg, then the
// sleeve target (band-filtered for build-up states in the band variant).
// Returns the pre-rebalance weight and the target actually used, so the
// driver can record them for the invariant tests.
function executeSleeveMonth(portfolio, decision, prices, monthlyAmount, band, ledger) {
  applyRetainedQqqLeg(portfolio, decision.key, prices, monthlyAmount, ledger);
  const nav = valueOf(portfolio, prices);
  const currentWeight = nav > 0 ? (portfolio.tqqq * prices.tqqq) / nav : 0;
  let target = sleeveTargetWeight(decision, currentWeight);
  if (band && BUILD_UP_KEYS.has(decision.key) && Math.abs(currentWeight - target) <= BAND_PP) {
    target = currentWeight; // inside the band: no trade
  }
  sleeveRebalance(portfolio, prices, target, ledger);
  return { preWeight: currentWeight, target };
}

// ---------------------------------------------------------------------------
// Shared monthly-point shape (adds weights for the average-weight stats).
// ---------------------------------------------------------------------------
function sleevePoint(portfolio, price) {
  const value = valueOf(portfolio, price);
  return {
    date: price.date,
    value,
    nav: portfolio.units > 0 ? value / portfolio.units : 1,
    shortRate: price.shortRate,
    cashWeight: value > 0 ? portfolio.cash / value : 0,
    qqqWeight: value > 0 ? (portfolio.qqq * price.qqq) / value : 0,
    tqqqWeight: value > 0 ? (portfolio.tqqq * price.tqqq) / value : 0,
  };
}

// Monthly driver loop shared by the sleeve variants and the current-strategy
// replica: runBacktest conventions (month-start contribution, pending orders
// execute next session, cross-month carry-in handled by the machine).
function runActionLoop(prices, states, startDate, applyAction) {
  const portfolio = emptyPortfolio(COST_BPS);
  const ledger = makeLedger(portfolio);
  const machine = createSignalMachine(DEFAULT_THRESHOLDS);
  const stats = { months: 0, executions: [], execRecords: [], minCash: 0 };
  let lastMonth = "";
  let previousPrice = null;
  for (let i = 30; i < prices.length; i += 1) {
    const price = prices[i];
    if (price.date < startDate) continue;
    accrueCash(portfolio, price);
    const month = price.date.slice(0, 7);
    if (month !== lastMonth) {
      if (previousPrice) portfolio.points.push(sleevePoint(portfolio, previousPrice));
      lastMonth = month;
      stats.months += 1;
      addContribution(portfolio, MONTHLY, price);
    }
    const due = signalMachineDue(machine, price.date);
    if (due) {
      const info = applyAction(portfolio, due.decision, price, ledger) || {};
      const nav = valueOf(portfolio, price);
      stats.executions.push({ signalDate: due.decisionDate, executionDate: price.date });
      stats.execRecords.push({
        date: price.date,
        key: due.decision.key,
        rampMonths: due.decision.rampMonths ?? null,
        preTqqqWeight: info.preWeight ?? null,
        targetWeight: info.target ?? null,
        turnover: ledger.turnover,
        postTqqqWeight: nav > 0 ? (portfolio.tqqq * price.tqqq) / nav : 0,
      });
    }
    signalMachineClose(machine, states[i], price.date);
    stats.minCash = Math.min(stats.minCash, portfolio.cash);
    updateDrawdown(portfolio, price);
    previousPrice = price;
  }
  if (previousPrice) portfolio.points.push(sleevePoint(portfolio, previousPrice));
  return { portfolio, finalPrices: previousPrice || prices.at(-1), stats, turnover: ledger.turnover };
}

function metricsOf(portfolio, finalPrices, turnover) {
  const finalValue = valueOf(portfolio, finalPrices);
  const points = portfolio.points;
  const avg = (selector) => (points.length ? points.reduce((sum, point) => sum + selector(point), 0) / points.length : null);
  return {
    finalValue,
    contributed: portfolio.contributed,
    maxDrawdown: portfolio.maxDrawdown,
    sharpe: riskStats(points).sharpe,
    multiple: portfolio.contributed > 0 ? finalValue / portfolio.contributed : null,
    turnover,
    fees: portfolio.fees,
    avgCashWeight: avg((point) => point.cashWeight),
    avgQqqWeight: avg((point) => point.qqqWeight),
    avgTqqqWeight: avg((point) => point.tqqqWeight),
  };
}

// ---------------------------------------------------------------------------
// Convergence protocol (frozen): fixed date D, fixed total asset value,
// three starting portfolios, one monthly execution per build-up state.
// The script only simulates; the test suite re-derives the theoretical
// post-trade weights from the 5 bps ledger and asserts on them.
// ---------------------------------------------------------------------------
function portfolioFromSpec(spec, prices) {
  const portfolio = emptyPortfolio(COST_BPS);
  portfolio.cash = spec.cashValue;
  portfolio.qqq = spec.qqqValue / prices.qqq;
  portfolio.tqqq = spec.tqqqValue / prices.tqqq;
  portfolio.contributed = CONVERGENCE_TOTAL;
  portfolio.units = CONVERGENCE_TOTAL;
  return portfolio;
}

function runConvergence(prices, states, data) {
  const price = prices.find((point) => point.date >= CONVERGENCE_DATE_MIN);
  const date = price.date;
  // The current production-strategy holding at D, scaled to the fixed total.
  const productionRun = runBacktest(data, CONVERGENCE_PRODUCTION_START, MONTHLY, DEFAULT_THRESHOLDS, states, date, COST_BPS);
  const prod = productionRun.portfolios.signal;
  const prodCash = prod.cash;
  const prodQqq = prod.qqq * price.qqq;
  const prodTqqq = prod.tqqq * price.tqqq;
  const prodNav = prodCash + prodQqq + prodTqqq;
  const scale = CONVERGENCE_TOTAL / prodNav;
  const portfolioSpecs = {
    cash: { cashValue: CONVERGENCE_TOTAL, qqqValue: 0, tqqqValue: 0 },
    qqq: { cashValue: 0, qqqValue: CONVERGENCE_TOTAL, tqqqValue: 0 },
    production: { cashValue: prodCash * scale, qqqValue: prodQqq * scale, tqqqValue: prodTqqq * scale },
  };
  const statesUnderTest = [
    { label: "normalDca", decision: { key: "normalDca" } },
    { label: "smallDipBuy", decision: { key: "smallDipBuy" } },
    { label: "bottomAttack", decision: { key: "bottomAttack" } },
    ...[1, 2, 3, 4, 5, 6].map((k) => ({ label: `rampTqqq k=${k}`, decision: { key: "rampTqqq", rampMonths: 7 - k } })),
  ];
  const results = { exact: {}, band: {} };
  for (const variant of ["exact", "band"]) {
    for (const state of statesUnderTest) {
      results[variant][state.label] = {};
      for (const [pfKey, spec] of Object.entries(portfolioSpecs)) {
        const portfolio = portfolioFromSpec(spec, price);
        const ledger = makeLedger(portfolio);
        addContribution(portfolio, MONTHLY, price);
        executeSleeveMonth(portfolio, state.decision, price, MONTHLY, variant === "band", ledger);
        const nav = valueOf(portfolio, price);
        results[variant][state.label][pfKey] = {
          postTqqqWeight: nav > 0 ? (portfolio.tqqq * price.tqqq) / nav : 0,
          turnover: ledger.turnover,
        };
      }
    }
  }
  return {
    date,
    prices: { date, qqq: price.qqq, tqqq: price.tqqq },
    feeRate: FEE_RATE,
    monthly: MONTHLY,
    total: CONVERGENCE_TOTAL,
    bandPp: BAND_PP,
    maxTqqq: MAX_TQQQ,
    portfolioSpecs,
    statesUnderTest: statesUnderTest.map((state) => ({
      label: state.label,
      decision: state.decision,
      target: sleeveTargetWeight(state.decision, 0), // build-up targets do not depend on currentWeight
    })),
    results,
  };
}

// ---------------------------------------------------------------------------
// Study driver.
// ---------------------------------------------------------------------------
function runStudy() {
  const data = loadSnapshotData();
  const prices = buildPrices(data.nasdaq, data.qqq, data.tqqq, data.rates);
  data.prices = prices;
  const capeChrono = capeSeriesForBacktest(data.capeLatestFirst).reverse();
  const states = buildStates(prices, data.nasdaq, data.vix, capeChrono);
  const snapshotId = buildDataSnapshotId(data);
  const tqqqActualStart = prices.find((point) => point.tqqqSource === "actual")?.date || data.tqqq?.[0]?.date || null;

  const rows = [];
  const sleeveRuns = []; // per start per variant: stats for invariants/T+1
  const replicaRuns = []; // current-strategy replica (turnover + parity)
  for (const start of STARTS) {
    const engine = runBacktest(data, start, MONTHLY, DEFAULT_THRESHOLDS, states, null, COST_BPS);
    const signal = engine.portfolios.signal;
    const currentMetrics = metricsOf(signal, engine.finalPrices, null);
    // Turnover for the current strategy comes from the parity-asserted replica.
    const replica = runActionLoop(prices, states, start, (portfolio, decision, price, ledger) => {
      applyProductionActionLocal(portfolio, decision, price, MONTHLY, ledger);
    });
    replicaRuns.push({ start, portfolio: replica.portfolio, finalPrices: replica.finalPrices, finalValue: valueOf(replica.portfolio, replica.finalPrices), stats: replica.stats, turnover: replica.turnover });
    currentMetrics.turnover = replica.turnover;

    const exact = runActionLoop(prices, states, start, (portfolio, decision, price, ledger) => (
      executeSleeveMonth(portfolio, decision, price, MONTHLY, false, ledger)
    ));
    const band = runActionLoop(prices, states, start, (portfolio, decision, price, ledger) => (
      executeSleeveMonth(portfolio, decision, price, MONTHLY, true, ledger)
    ));
    sleeveRuns.push({ start, variant: "exact", stats: exact.stats });
    sleeveRuns.push({ start, variant: "band", stats: band.stats });

    const synthetic = tqqqActualStart && start < tqqqActualStart ? "sTQQQ" : "—";
    const exactMetrics = metricsOf(exact.portfolio, exact.finalPrices, exact.turnover);
    const bandMetrics = metricsOf(band.portfolio, band.finalPrices, band.turnover);
    rows.push(
      { start, plan: "current", ...currentMetrics, synthetic },
      { start, plan: "sleeve-exact", ...exactMetrics, synthetic },
      { start, plan: "sleeve-2pp-band", ...bandMetrics, synthetic },
    );
  }

  const convergence = runConvergence(prices, states, data);

  return {
    snapshotId,
    tqqqActualStart,
    latestDate: prices.at(-1).date,
    dates: prices.map((point) => point.date),
    rows,
    sleeveRuns,
    replicaRuns,
    convergence,
  };
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
const fmtUsd = (value) => (value == null ? "—" : `$${Math.round(value).toLocaleString("en-US")}`);
const fmtPct = (value, digits = 1) => (value == null ? "—" : `${(value * 100).toFixed(digits)}%`);
const fmtX = (value) => (value == null ? "—" : `${value.toFixed(2)}x`);
const fmtSharpe = (value) => (value == null ? "—" : value.toFixed(2));
const fmtPp = (value, digits = 2) => (value == null ? "—" : `${(value * 100).toFixed(digits)}pp`);
const fmtRatio3 = (value) => (value == null ? "—" : value.toFixed(3));

const PLAN_LABELS = {
  current: "Current strategy (production signal)",
  "sleeve-exact": "Sleeve exact",
  "sleeve-2pp-band": "Sleeve 2pp band",
};

function renderReport(study) {
  const { snapshotId, tqqqActualStart, latestDate, rows, convergence } = study;
  const lines = [];
  lines.push("# Target-Weight TQQQ Sleeve Study");
  lines.push("");
  lines.push("Generated by `scripts/tqqq-sleeve-study.cjs` (regenerate with `node scripts/tqqq-sleeve-study.cjs`); test/tqqq-sleeve.test.cjs asserts this file matches the generator byte for byte, so the report carries no volatile timestamp.");
  lines.push(`Frozen spec: \`${PREREG_PATH}\` (pre-registered ${PREREG_DATE} Asia/Taipei, before implementation code or output existed). The rules in this study were frozen before any output was viewed; no spec parameter was changed after seeing results.`);
  lines.push(`Data: versioned snapshots \`${snapshotId}\` (offline), last market date ${latestDate}.`);
  lines.push("");
  lines.push("**Implementation deviation declaration: none.** Two implementation notes that are not deviations: (a) the spec's \"single low signal / mild drawdown\" state maps to the engine action key `smallDipBuy` (the only mild-dip action key in the engine); (b) the production `monthlySpendWithDrip` is reused verbatim via a pure-append export in `api/_lib.js` instead of being copied. The retained QQQ/cash incremental legs and the current-strategy replica's action function are verbatim copies of production `applySignalAction`, checked line by line; the replica is parity-asserted against `runBacktest` `portfolios.signal` in the test suite.");
  lines.push("");
  lines.push("## Frozen design summary");
  lines.push("");
  lines.push("- Signal side unchanged: shared monthly signal machine, thresholds, standard risk policy, T+1 execution, carry-in semantics — all reused from `api/_lib.js`.");
  lines.push("- TQQQ target mapping (frozen): normalDca / single-low (smallDipBuy) 10%; bottomAttack 25%; rampTqqq month k = 7 - `decision.rampMonths`: 25% + 15% x k / 6 (k = 1..6 -> 27.5%, 30%, 32.5%, 35%, 37.5%, 40%); trimHeat max(10%, current weight x 11/12); pauseAtHigh freeze (no trade); crashDefense current weight x 50%. 40% TQQQ cap enforced after every monthly execution.");
  lines.push("- Funding waterfall (frozen): retained QQQ/cash legs first; NAV after them sets the target value; below target spends cash first then sells QQQ for the shortfall and buys TQQQ with the proceeds (sell before buy); above target sells TQQQ down to target into cash; 5 bps friction per buy and sell from cash; fractional shares on; post-trade weights booked as executed, fee drift not corrected.");
  lines.push("- Variants: current strategy, sleeve exact (rebalance to the precise target every month), sleeve 2pp band (build-up states trade only when the weight deviates from target by more than 2pp, then to the exact target; defensive states always execute their gradual rules directly, never through the band).");
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push(`- ${STARTS.length} start dates x 5 bps x $${MONTHLY.toLocaleString("en-US")} monthly contribution. Actual-only starts (TQQQ history fully actual, gates apply): ${ACTUAL_ONLY_STARTS.join(", ")}. Synthetic-TQQQ starts (reported separately, do NOT count toward the pass gate): ${SYNTHETIC_TQQQ_STARTS.join(", ")}. All start windows overlap and are not independent samples.`);
  lines.push("- Value metrics for the current strategy come directly from `runBacktest` `portfolios.signal`. Its turnover comes from a line-by-line local replica of the production action function with ledger instrumentation; the test suite asserts the replica's final value matches the engine's signal portfolio within 1e-9 relative for every start.");
  lines.push("- Turnover convention: buys booked at cash spent, sells booked at gross value traded; contributions are not turnover. Fees are the engine ledger's accumulated 5 bps frictions. Average cash/QQQ/TQQQ weights are unweighted means over month-end points.");
  lines.push("- Metrics: finalValue, maxDrawdown (unit-NAV peak-to-trough), Sharpe (monthly excess return over the modeled cash rate, annualized by sqrt(12), engine `riskStats`), multiple (finalValue / total contributed).");
  lines.push("");

  const tableRows = (subset) => {
    const out = [];
    out.push("| Start | Plan | Final value | Max drawdown | Sharpe | Multiple | Turnover | Total fees | Avg cash weight | Avg QQQ weight | Avg TQQQ weight |");
    out.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const row of subset) {
      out.push(`| ${row.start} | ${PLAN_LABELS[row.plan]} | ${fmtUsd(row.finalValue)} | ${fmtPct(row.maxDrawdown)} | ${fmtSharpe(row.sharpe)} | ${fmtX(row.multiple)} | ${fmtUsd(row.turnover)} | ${fmtUsd(row.fees)} | ${fmtPct(row.avgCashWeight)} | ${fmtPct(row.avgQqqWeight)} | ${fmtPct(row.avgTqqqWeight)} |`);
    }
    return out;
  };

  lines.push("## Results — actual-only starts (gates apply)");
  lines.push("");
  lines.push(...tableRows(rows.filter((row) => ACTUAL_ONLY_STARTS.includes(row.start))));
  lines.push("");
  lines.push("## Results — synthetic-TQQQ starts (reported separately; do not count toward the pass gate)");
  lines.push("");
  lines.push(...tableRows(rows.filter((row) => SYNTHETIC_TQQQ_STARTS.includes(row.start))));
  lines.push("");

  // ---- Acceptance gates. ----
  const byStartPlan = Object.fromEntries(rows.map((row) => [`${row.start}|${row.plan}`, row]));
  const gateRows = ACTUAL_ONLY_STARTS.map((start) => {
    const current = byStartPlan[`${start}|current`];
    const exact = byStartPlan[`${start}|sleeve-exact`];
    const band = byStartPlan[`${start}|sleeve-2pp-band`];
    return {
      start,
      current,
      exact,
      band,
      exactRatio: exact.finalValue / current.finalValue,
      bandRatio: band.finalValue / current.finalValue,
      exactDdChange: exact.maxDrawdown - current.maxDrawdown, // negative = deeper drawdown
      bandDdChange: band.maxDrawdown - current.maxDrawdown,
    };
  });
  const exactPass = gateRows.filter((row) => row.exactRatio >= 0.97);
  const bandPass = gateRows.filter((row) => row.bandRatio >= 0.97);
  const exactDdPass = gateRows.filter((row) => row.exactDdChange >= -0.02);
  const bandDdPass = gateRows.filter((row) => row.bandDdChange >= -0.02);
  const over103 = gateRows.filter((row) => row.exactRatio > 1.03 || row.bandRatio > 1.03);

  lines.push("## Acceptance gate evaluation (frozen gates, facts)");
  lines.push("");
  lines.push("| Start | Ratio exact/current | Ratio band/current | Drawdown change exact (pp) | Drawdown change band (pp) |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const row of gateRows) {
    lines.push(`| ${row.start} | ${fmtRatio3(row.exactRatio)} | ${fmtRatio3(row.bandRatio)} | ${(row.exactDdChange * 100).toFixed(2)} | ${(row.bandDdChange * 100).toFixed(2)} |`);
  }
  lines.push("");
  lines.push(`- Gate 1 (final-value ratio sleeve/current >= 0.97 in at least 5 of 6 actual-only starts; one-sided non-inferiority, no 1.03 upper bound): exact variant passes in ${exactPass.length}/6 starts${exactPass.length < 6 ? ` (fails: ${gateRows.filter((row) => row.exactRatio < 0.97).map((row) => row.start).join(", ")})` : ""}; band variant passes in ${bandPass.length}/6 starts${bandPass.length < 6 ? ` (fails: ${gateRows.filter((row) => row.bandRatio < 0.97).map((row) => row.start).join(", ")})` : ""}. Gate is ${exactPass.length >= 5 ? "MET" : "NOT MET"} for the exact variant and ${bandPass.length >= 5 ? "MET" : "NOT MET"} for the band variant.`);
  lines.push(`- Gate 2 (max-drawdown worsening <= 2pp vs current strategy in all 6 actual-only starts): exact variant within 2pp in ${exactDdPass.length}/6 starts${exactDdPass.length < 6 ? ` (breaches: ${gateRows.filter((row) => row.exactDdChange < -0.02).map((row) => `${row.start} ${(row.exactDdChange * 100).toFixed(2)}pp`).join("; ")})` : ""} — gate ${exactDdPass.length === 6 ? "MET" : "NOT MET"}; band variant within 2pp in ${bandDdPass.length}/6 starts${bandDdPass.length < 6 ? ` (breaches: ${gateRows.filter((row) => row.bandDdChange < -0.02).map((row) => `${row.start} ${(row.bandDdChange * 100).toFixed(2)}pp`).join("; ")})` : ""} — gate ${bandDdPass.length === 6 ? "MET" : "NOT MET"}.`);
  if (over103.length) {
    const explanations = over103.map((row) => {
      const parts = [];
      if (row.exactRatio > 1.03) {
        parts.push(`${row.start} exact ratio ${fmtRatio3(row.exactRatio)}: avg TQQQ weight exact ${fmtPct(row.exact.avgTqqqWeight)} vs current ${fmtPct(row.current.avgTqqqWeight)} (Δ ${fmtPp(row.exact.avgTqqqWeight - row.current.avgTqqqWeight)}), avg cash exact ${fmtPct(row.exact.avgCashWeight)} vs current ${fmtPct(row.current.avgCashWeight)} (Δ ${fmtPp(row.exact.avgCashWeight - row.current.avgCashWeight)})`);
      }
      if (row.bandRatio > 1.03) {
        parts.push(`${row.start} band ratio ${fmtRatio3(row.bandRatio)}: avg TQQQ weight band ${fmtPct(row.band.avgTqqqWeight)} vs current ${fmtPct(row.current.avgTqqqWeight)} (Δ ${fmtPp(row.band.avgTqqqWeight - row.current.avgTqqqWeight)}), avg cash band ${fmtPct(row.band.avgCashWeight)} vs current ${fmtPct(row.current.avgCashWeight)} (Δ ${fmtPp(row.band.avgCashWeight - row.current.avgCashWeight)})`);
      }
      return parts;
    }).flat();
    lines.push(`- Ratio above 1.03 (not a failure per the frozen gate; the extra risk exposure is explained from average weights): ${explanations.join("; ")}.`);
  } else {
    lines.push("- No actual-only start has a sleeve/current ratio above 1.03.");
  }
  lines.push("- Gate 3 (convergence protocol assertions): summarized in the next section; enforced by test/tqqq-sleeve.test.cjs.");
  lines.push("- Gate 4 (full reporting of turnover, total fees, average cash/QQQ/TQQQ weights for both variants and the current strategy): see the two results tables above.");
  lines.push("");

  // ---- Convergence summary. ----
  lines.push("## Convergence protocol summary (fixed date, fixed total asset value)");
  lines.push("");
  lines.push(`Date D = ${convergence.date} (first trading day on/after ${CONVERGENCE_DATE_MIN}); total asset value ${fmtUsd(convergence.total)}; contribution ${fmtUsd(convergence.monthly)} included in the single monthly execution. Starting portfolios: 100% cash, 100% QQQ, current production-strategy holding at D (start ${CONVERGENCE_PRODUCTION_START}, scaled to the total; cash/QQQ/TQQQ = ${fmtPct(convergence.portfolioSpecs.production.cashValue / convergence.total)} / ${fmtPct(convergence.portfolioSpecs.production.qqqValue / convergence.total)} / ${fmtPct(convergence.portfolioSpecs.production.tqqqValue / convergence.total)}). Defensive states are excluded by design (their rules are holdings-dependent).`);
  lines.push("");
  lines.push("| State | Target | Exact: post weights (cash / QQQ / production starts) | Exact: max abs deviation from target | Band: post weights | Band: max pairwise difference |");
  lines.push("| --- | ---: | --- | ---: | --- | ---: |");
  for (const state of convergence.statesUnderTest) {
    const exactWeights = Object.values(convergence.results.exact[state.label]).map((result) => result.postTqqqWeight);
    const bandWeights = Object.values(convergence.results.band[state.label]).map((result) => result.postTqqqWeight);
    const maxDev = Math.max(...exactWeights.map((weight) => Math.abs(weight - state.target)));
    const pairwise = Math.max(...bandWeights) - Math.min(...bandWeights);
    lines.push(`| ${state.label} | ${fmtPct(state.target)} | ${exactWeights.map((weight) => fmtPct(weight, 3)).join(" / ")} | ${(maxDev * 100).toFixed(3)}pp | ${bandWeights.map((weight) => fmtPct(weight, 3)).join(" / ")} | ${(pairwise * 100).toFixed(3)}pp |`);
  }
  lines.push("");
  lines.push("The test suite re-derives the theoretical post-trade weights from the 5 bps ledger independently and asserts: exact-variant weights equal the ledger-derived theoretical weights within 1e-9 relative (no adjustable fee epsilon); band-variant weights sit within 2pp of the same theoretical weights (plus ledger friction) with pairwise differences within 4pp plus ledger friction.");
  lines.push("");

  // ---- Action-level semantic audit. Derived from the recorded per-execution
  // pre-rebalance weight and executed target (no backtest numbers change):
  // target > pre => buy-up to target; target < pre => sell-down to target;
  // equal => no sleeve trade (pauseAtHigh freeze, or inside the 2pp band).
  const DIRECTION_EPS = 1e-9;
  const ACTION_ORDER = ["normalDca", "smallDipBuy", "bottomAttack", "rampTqqq", "trimHeat", "pauseAtHigh", "crashDefense"];
  const auditFor = (runs) => {
    const out = [];
    for (const variant of ["exact", "band"]) {
      for (const key of ACTION_ORDER) {
        const records = runs
          .filter((run) => run.variant === variant)
          .flatMap((run) => run.stats.execRecords)
          .filter((record) => record.key === key);
        let buyUp = 0;
        let sellDown = 0;
        let noTrade = 0;
        for (const record of records) {
          const diff = record.targetWeight - record.preTqqqWeight;
          if (diff > DIRECTION_EPS) buyUp += 1;
          else if (diff < -DIRECTION_EPS) sellDown += 1;
          else noTrade += 1;
        }
        out.push({ variant, key, executions: records.length, buyUp, sellDown, noTrade });
      }
    }
    return out;
  };
  const auditAll = auditFor(study.sleeveRuns);
  const audit2010 = auditFor(study.sleeveRuns.filter((run) => run.start === "2010-02-11"));
  const auditTable = (auditRows) => {
    const out = [];
    out.push("| Variant | State | Executions | Sell-down to target | Buy-up to target | No sleeve trade |");
    out.push("| --- | --- | ---: | ---: | ---: | ---: |");
    for (const row of auditRows) {
      out.push(`| ${PLAN_LABELS[row.variant === "exact" ? "sleeve-exact" : "sleeve-2pp-band"]} | ${row.key} | ${row.executions} | ${row.sellDown} | ${row.buyUp} | ${row.noTrade} |`);
    }
    return out;
  };
  const auditCell = (auditRows, variant, key) => auditRows.find((row) => row.variant === variant && row.key === key);

  lines.push("## Action-level semantic audit");
  lines.push("");
  lines.push("Per-execution direction of the sleeve rebalance, derived from the recorded pre-rebalance weight and the executed target (audit adds recording only; no backtest number changes). Sell-down = TQQQ sold down to the target weight; buy-up = TQQQ bought up to the target weight; no sleeve trade = pauseAtHigh freeze or a build-up month inside the 2pp band.");
  lines.push("");
  lines.push("### All 11 starts");
  lines.push("");
  lines.push(...auditTable(auditAll));
  lines.push("");
  lines.push("### 2010-02-11 start (representative close read)");
  lines.push("");
  lines.push(...auditTable(audit2010));
  lines.push("");
  const exactTrim = auditCell(auditAll, "exact", "trimHeat");
  const bandTrim = auditCell(auditAll, "band", "trimHeat");
  const exactNormal = auditCell(auditAll, "exact", "normalDca");
  const exactDip = auditCell(auditAll, "exact", "smallDipBuy");
  const exactBottom = auditCell(auditAll, "exact", "bottomAttack");
  const exactRamp = auditCell(auditAll, "exact", "rampTqqq");
  const exactCrash = auditCell(auditAll, "exact", "crashDefense");
  const exactSellTotal = ACTION_ORDER.reduce((sum, key) => sum + auditCell(auditAll, "exact", key).sellDown, 0);
  const nonNormalSell = exactSellTotal - exactNormal.sellDown;
  const buildUpSellOutsideNormal = exactDip.sellDown + exactBottom.sellDown + exactRamp.sellDown;
  const pctNonNormal = exactSellTotal > 0 ? (100 * nonNormalSell / exactSellTotal).toFixed(1) : "—";
  lines.push("### Semantic notes (facts)");
  lines.push("");
  lines.push(`- The frozen trimHeat mapping \`max(10%, current weight x 11/12)\` is two-way: when the pre-execution weight is below 10% it becomes a TQQQ BUY in a defensive month, contradicting the defensive-unwind intent. This actually fired: the exact variant bought TQQQ up to the 10% floor in ${exactTrim.buyUp} of ${exactTrim.executions} trimHeat months across all 11 starts (band variant: ${bandTrim.buyUp} of ${bandTrim.executions}).`);
  lines.push(`- Sell-down-to-target is not confined to normal months. Exact variant across all 11 starts, ${exactSellTotal} sell-down executions in total: ${exactNormal.sellDown} normalDca, ${exactDip.sellDown} smallDipBuy (sold back to 10%), ${exactBottom.sellDown} bottomAttack (sold back to 25% when above), ${exactRamp.sellDown} rampTqqq (sold back to that month's ramp target when above), ${exactTrim.sellDown} trimHeat, ${exactCrash.sellDown} crashDefense — ${nonNormalSell} (${pctNonNormal}%) happened outside normalDca, ${buildUpSellOutsideNormal} of those in the other three build-up states.`);
  lines.push("");
  lines.push("## Conclusion (facts only, no recommendation)");
  lines.push("");
  lines.push("This study refutes the frozen two-way target mapping. It does not prove that target-weight rebalancing itself is ineffective, and the shortfall cannot be attributed to the normal state alone.");
  lines.push("");
  lines.push(`- Sell-downs are spread across every state, not just normalDca: ${nonNormalSell} of the exact variant's ${exactSellTotal} sell-down executions (${pctNonNormal}%) occurred outside normalDca — smallDipBuy ${exactDip.sellDown}, bottomAttack ${exactBottom.sellDown}, rampTqqq ${exactRamp.sellDown}, trimHeat ${exactTrim.sellDown}, crashDefense ${exactCrash.sellDown}.`);
  lines.push(`- The defensive mapping itself also deviates from intent: the frozen trimHeat formula bought TQQQ up to the 10% floor in ${exactTrim.buyUp} trimHeat months (band: ${bandTrim.buyUp}), i.e. it adds exposure in defensive months whenever the pre-execution weight is below 10%.`);
  lines.push(`- The gate shortfall concentrates in the long-bull starts (2010-02-11, 2015-01-01, 2020-01-01, ratios 0.666-0.836), where the production strategy's accumulated buy-and-hold TQQQ position (average weights 22.4%-30.6%) dwarfs the sleeve's 13.6%-16.2%; in the 2023-2025 starts, where the sleeve holds more TQQQ than the current strategy, ratios are 1.006-1.020 and the 2024 drawdown gate breaches. The mapping moves exposure in both directions, and both directions show up in the outcome.`);
  lines.push("");
  lines.push("### Per-start facts");
  lines.push("");
  for (const row of gateRows) {
    lines.push(`- ${row.start}: current ${fmtUsd(row.current.finalValue)} vs exact ${fmtUsd(row.exact.finalValue)} (${fmtRatio3(row.exactRatio)}) vs band ${fmtUsd(row.band.finalValue)} (${fmtRatio3(row.bandRatio)}); drawdown current ${fmtPct(row.current.maxDrawdown)} / exact ${fmtPct(row.exact.maxDrawdown)} / band ${fmtPct(row.band.maxDrawdown)}; turnover current ${fmtUsd(row.current.turnover)} / exact ${fmtUsd(row.exact.turnover)} / band ${fmtUsd(row.band.turnover)}; fees current ${fmtUsd(row.current.fees)} / exact ${fmtUsd(row.exact.fees)} / band ${fmtUsd(row.band.fees)}; avg TQQQ weight current ${fmtPct(row.current.avgTqqqWeight)} / exact ${fmtPct(row.exact.avgTqqqWeight)} / band ${fmtPct(row.band.avgTqqqWeight)}.`);
  }
  const synthGateless = rows.filter((row) => SYNTHETIC_TQQQ_STARTS.includes(row.start));
  const synthRatios = SYNTHETIC_TQQQ_STARTS.map((start) => {
    const current = byStartPlan[`${start}|current`];
    const exact = byStartPlan[`${start}|sleeve-exact`];
    const band = byStartPlan[`${start}|sleeve-2pp-band`];
    return `- ${start} (synthetic TQQQ, not gate-counted): exact/current ${fmtRatio3(exact.finalValue / current.finalValue)}, band/current ${fmtRatio3(band.finalValue / current.finalValue)}; drawdown current ${fmtPct(current.maxDrawdown)} / exact ${fmtPct(exact.maxDrawdown)} / band ${fmtPct(band.maxDrawdown)}.`;
  });
  lines.push(...synthRatios);
  lines.push("");

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "")}\n`;
}

function main() {
  const study = runStudy();
  const report = renderReport(study);
  process.stdout.write(report);
  const docsDir = path.join(__dirname, "..", "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "tqqq-sleeve-study.md"), report);
  console.error("wrote docs/tqqq-sleeve-study.md");
}

if (require.main === module) main();

module.exports = {
  runStudy,
  renderReport,
  main,
  STARTS,
  ACTUAL_ONLY_STARTS,
  SYNTHETIC_TQQQ_STARTS,
  MONTHLY,
  COST_BPS,
  FEE_RATE,
  MAX_TQQQ,
  BAND_PP,
  BUILD_UP_KEYS,
  sleeveTargetWeight,
  CONVERGENCE_TOTAL,
  // Appended for scripts/state-attribution-study.cjs reuse (pure additions;
  // runStudy/renderReport behavior is untouched, so the byte-sync test and
  // the generated report are unaffected).
  runActionLoop,
  executeSleeveMonth,
  applyProductionActionLocal,
  metricsOf,
  // Appended for scripts/oneway-floor-study.cjs reuse (pure additions;
  // runStudy/renderReport behavior is untouched).
  applyRetainedQqqLeg,
  enforceTqqqCapLocal,
};
