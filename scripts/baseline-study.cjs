#!/usr/bin/env node
/**
 * scripts/baseline-study.cjs — naive-baseline comparison study (research script).
 *
 * This script does not change any production strategy behavior. It reuses the
 * engine's accounting primitives (api/_lib.js) to compare pre-registered
 * plans over 11 start dates and writes docs/baseline-study.md. It is
 * require-able: main() only runs when the file is executed directly, and the
 * computed study object is exported for test/baseline-study.test.cjs.
 *
 * ROUND 1 FROZEN RULES (frozen 2026-07-20, before viewing any round-1 output)
 * ------------------------------------------------------------------------
 * Common setup: $1,000 is contributed on the first trading day of each month;
 * every buy/sell pays 5 bps of friction; idle cash accrues the FEDFUNDS-based
 * short rate via the engine's accrueCash.
 *
 *   B1 QQQ DCA: every month the full available cash buys QQQ (the engine's
 *     portfolios.qqq from runBacktest). Reference plan.
 *   B2 Drawdown ladder (QQQ only, buy-only): at each month start, if the
 *     Nasdaq-100 5-day-average drawdown is <= -20%, invest up to 3x the
 *     monthly amount from accumulated cash; if <= -10%, invest 2x; otherwise
 *     invest 1x.
 *   B3 VIX rule (QQQ only, buy-only): at each month start, if the VIX 5-day
 *     average is >= 30, invest 2x the monthly amount; otherwise invest 1x.
 *   B4 Three-signal standard policy: the existing main strategy (runBacktest
 *     portfolios.signal), used as-is and not modified.
 *
 * B2/B3 "Nx" spends out of the plan's accumulated cash (unspent cash keeps
 * earning interest), aligned with the three-signal strategy's cash mechanics
 * for fairness.
 *
 * Declaration: the four rule sets above were frozen before any study output
 * was inspected. The B2/B3 parameters (-10%/-20%/3x/2x and 30/2x) must not be
 * retuned based on the results; results adverse to any plan are reported
 * as-is.
 *
 * ROUND 2 FROZEN RULES (frozen 2026-07-20, before viewing any round-2 output)
 * ------------------------------------------------------------------------
 * Round 1 showed that B2/B3 mechanically degenerate to B1 because normal
 * months deploy the full contribution and no cash reserve can accumulate.
 * Round 2 adds a reserve mechanism to the same naive triggers:
 *
 *   B2r Drawdown ladder with reserve (QQQ only, buy-only): in normal months
 *     invest only 50% of the monthly amount and keep the rest in cash; at
 *     each month start, if the Nasdaq-100 5-day-average drawdown is <= -20%,
 *     spend up to 3x the monthly amount from accumulated cash; if <= -10%,
 *     spend up to 2x.
 *   B3r VIX rule with reserve (QQQ only, buy-only): in normal months invest
 *     50% of the monthly amount; at each month start, if the VIX 5-day
 *     average is >= 30, spend up to 2x the monthly amount from accumulated
 *     cash.
 *
 * Rationale, stated as required: the 50% reserve fraction mirrors the
 * three-signal strategy's own high-regime throttle (50% core QQQ in
 * pause/trim months, CORE_QQQ_HIGH_REGIME_FRACTION), and the 2x/3x
 * multipliers keep the round-1 frozen values. B2r/B3r each keep an
 * independent cash ledger. 5 bps friction; idle cash accrues the
 * FEDFUNDS-based short rate as before.
 *
 * Declaration: the round-2 rules were frozen before any round-2 output was
 * inspected; results adverse to any plan are reported as-is.
 *
 * ROUND 3 FROZEN RULES (frozen 2026-07-20, before viewing any round-3 output)
 * ------------------------------------------------------------------------
 * Round 3 applies the PR #7 review fix list.
 *
 *   (1) T+1 execution alignment (retroactive to B2/B3/B2r/B3r and applying
 *     to all new naive plans): the month-start signal is confirmed at the
 *     close of the month's first trading day and the order executes at the
 *     next trading session at that session's price — the same convention as
 *     B4's signal sleeve in runBacktest. Reserve replenishment decisions
 *     follow the same T+1 rule. A signal locked on the last month of data
 *     simply stays unexecuted, matching engine behavior. B1 remains the
 *     engine's same-day month-start DCA benchmark, unchanged.
 *
 *   (2) Capped-reserve baselines (new; the uncapped B2r/B3r are kept as
 *     controls):
 *     B2c Capped drawdown ladder (QQQ only, buy-only): extra reserve capped
 *       at 2 monthly amounts. Normal months: while the reserve is below the
 *       cap, invest 50% of the monthly amount and stock the rest; once the
 *       reserve is full, resume 100% QQQ DCA. Trigger months: drawdown
 *       <= -10% spends up to 2x the monthly amount from cash, <= -20% up to
 *       3x; the reserve refills afterwards under the same rule.
 *     B3c Capped VIX rule (QQQ only, buy-only): same, with the reserve
 *       capped at 1 monthly amount; VIX 5-day average >= 30 spends up to 2x.
 *     Precise reserve definition (frozen): the portfolio's only cash source
 *     is undeployed contributions, so "extra reserve" is the cash balance.
 *     Cash is fungible, so trigger-month spending draws from total available
 *     cash with no ordering distinction between the reserve and the current
 *     month's contribution. The cap is enforced by the normal-month spend
 *     rule at execution: spend = min(cash, max(0.5 x monthly, cash - cap)),
 *     which guarantees the reserve immediately after each execution is <=
 *     the cap; between executions accrued interest can push the cash balance
 *     slightly above the cap (interest income, not active hoarding).
 *
 *   (3) Bottom-leverage ablation:
 *     signalQqq: the engine's existing sleeve (runBacktest
 *       portfolios.signalQqq) — same signals, trades QQQ only.
 *     B4-no-bottom-leverage (B4nbl): the full three-signal standard policy
 *       with every signal, the normal TQQQ floor, trimHeat/pause, crash
 *       defense, and the TQQQ cap unchanged; ONLY the TQQQ purchases inside
 *       bottomAttack and rampTqqq actions are converted into equal-dollar
 *       QQQ purchases. The QQQ->TQQQ rotation leg of those actions is
 *       omitted, because with the purchase leg ablated to QQQ it would
 *       round-trip QQQ through fees. Built inside this script from the
 *       exported signal machine (createSignalMachine / signalMachineClose /
 *       signalMachineDue) and accounting primitives, with runBacktest's
 *       execution conventions (month-start contribution, pending orders
 *       execute next session, cross-month carry-in handled by the machine).
 *       api/_lib.js is NOT modified for this variant.
 *
 * Declaration: the round-3 rules above were frozen before any round-3 output
 * was inspected; results adverse to any plan are reported as-is.
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
  DEFAULT_THRESHOLDS,
  RISK_POLICIES,
  MAIN_SIGNAL_POLICY_KEY,
  CORE_QQQ_HIGH_REGIME_FRACTION,
} = require("../api/_lib");

const FREEZE_DATE = "2026-07-20";
const MONTHLY = 1000;
const COST_BPS = 5;
const STARTS = [
  "1990-01-01", "1995-01-01", "2000-01-01", "2005-01-01", "2010-01-01",
  "2010-02-11", "2015-01-01", "2020-01-01", "2023-01-01", "2024-01-01",
  "2025-01-01",
];
// Actual-only starts: TQQQ history is fully actual (inception 2010-02-11).
const TQQQ_ACTUAL_START = "2010-02-11";
const ACTUAL_ONLY_STARTS = STARTS.filter((start) => start >= TQQQ_ACTUAL_START);
const SYNTHETIC_TQQQ_STARTS = STARTS.filter((start) => start < TQQQ_ACTUAL_START);

// Frozen multipliers (rounds 1-3 share the same trigger definitions).
const B2_MULTIPLIER = (state) => (state.drawdownPct <= -20 ? 3 : state.drawdownPct <= -10 ? 2 : 1);
const B3_MULTIPLIER = (state) => (state.vix >= 30 ? 2 : 1);

// Round 2/3: normal months deploy only RESERVE_FRACTION of the monthly amount.
// The 50% fraction mirrors the three-signal strategy's high-regime throttle
// (CORE_QQQ_HIGH_REGIME_FRACTION); multipliers keep the round-1 frozen values.
const RESERVE_FRACTION = 0.5;
const B2C_RESERVE_CAP = 2 * MONTHLY;
const B3C_RESERVE_CAP = 1 * MONTHLY;

// Minimal month-end point, shaped like the engine's record() output for the
// fields riskStats consumes (date, nav, shortRate).
function monthPoint(portfolio, price) {
  const value = valueOf(portfolio, price);
  return {
    date: price.date,
    value,
    nav: portfolio.units > 0 ? value / portfolio.units : 1,
    shortRate: price.shortRate,
  };
}

// Monthly buy-only naive loop with T+1 execution, mirroring runBacktest's
// signal-sleeve convention: the month-start decision is locked at the close
// of the month's first trading day and executes at the next trading session
// at that session's price. Daily cash accrual and drawdown updates match the
// engine. A pending order left at the end of data stays unexecuted.
//
// options:
//   multiplierFor(state) -> requested multiplier locked at the signal close
//   normalTarget(cashAvailable) -> dollar target for non-trigger months,
//     evaluated at execution time (used by the capped-reserve plans)
//   reserveCap: if set, the post-execution cash balance is recorded per month
//   immediate: execute at the signal session itself (only used for the
//     engine-parity validation loop, never for a study plan)
function runNaiveT1(prices, states, startDate, options) {
  const { multiplierFor, normalTarget, reserveCap = null, immediate = false } = options;
  const portfolio = emptyPortfolio(COST_BPS);
  const stats = { months: 0, triggers: [], executions: [], reserveAfter: [] };
  let lastMonth = "";
  let previousPrice = null;
  let pending = null; // { signalDate, multiplier }
  for (let i = 30; i < prices.length; i += 1) {
    const price = prices[i];
    if (price.date < startDate) continue;
    accrueCash(portfolio, price);
    const month = price.date.slice(0, 7);

    if (pending && pending.signalDate < price.date) {
      const cashAvailable = portfolio.cash;
      const target = pending.multiplier > 1
        ? MONTHLY * pending.multiplier
        : normalTarget(cashAvailable);
      const spent = Math.max(0, Math.min(cashAvailable, target));
      if (pending.multiplier > 1) {
        stats.triggers.push({
          date: price.date,
          signalDate: pending.signalDate,
          multiplier: pending.multiplier,
          cashAvailable,
          intended: target,
          spent,
        });
      }
      buyQQQ(portfolio, target, price.qqq);
      stats.executions.push({ signalDate: pending.signalDate, executionDate: price.date });
      if (reserveCap != null) stats.reserveAfter.push({ date: price.date, reserve: portfolio.cash });
      pending = null;
    }

    if (month !== lastMonth) {
      if (previousPrice) portfolio.points.push(monthPoint(portfolio, previousPrice));
      lastMonth = month;
      stats.months += 1;
      addContribution(portfolio, MONTHLY, price);
      // Lock this month's decision at today's close; it executes next session.
      pending = { signalDate: price.date, multiplier: multiplierFor(states[i]) };
      if (immediate) {
        // Validation-only path: same-session execution, matching the engine's
        // QQQ DCA sleeve convention.
        const target = pending.multiplier > 1 ? MONTHLY * pending.multiplier : normalTarget(portfolio.cash);
        buyQQQ(portfolio, target, price.qqq);
        stats.executions.push({ signalDate: price.date, executionDate: price.date });
        pending = null;
      }
    }
    updateDrawdown(portfolio, price);
    previousPrice = price;
  }
  if (previousPrice) portfolio.points.push(monthPoint(portfolio, previousPrice));
  return { portfolio, finalPrices: previousPrice || prices.at(-1), stats };
}

// --- Local copies of engine policy helpers used by the ablation variant. ---
// They are built from exported primitives; api/_lib.js is not modified.
function monthlySpendWithDripLocal(portfolio, monthlyAmount, spareFraction = 1 / 6) {
  return Math.min(portfolio.cash, monthlyAmount + Math.max(0, portfolio.cash - monthlyAmount) * spareFraction);
}

function enforceTqqqCapLocal(portfolio, prices, maxTqqq) {
  const total = valueOf(portfolio, prices);
  const tqqqValue = portfolio.tqqq * prices.tqqq;
  const excess = tqqqValue - total * maxTqqq;
  if (excess <= 0 || tqqqValue <= 0) return;
  const feeRate = (portfolio.costBps || 0) / 10000;
  const grossSale = excess / Math.max(1e-9, 1 - maxTqqq * feeRate);
  sellTQQQ(portfolio, Math.min(1, grossSale / tqqqValue), prices.tqqq);
}

function buyTQQQToTargetLocal(portfolio, targetPct, prices) {
  if (prices.tqqq <= 0) return;
  const totalValue = valueOf(portfolio, prices);
  const need = Math.max(0, totalValue * targetPct - portfolio.tqqq * prices.tqqq);
  if (need <= 0) return;
  buyTQQQ(portfolio, Math.min(portfolio.cash, need), prices.tqqq);
}

function sellTQQQWithFloorLocal(portfolio, fraction, prices, floorPct) {
  if (prices.tqqq <= 0) return;
  const totalValue = valueOf(portfolio, prices);
  const tqqqValue = portfolio.tqqq * prices.tqqq;
  const floorValue = totalValue * floorPct;
  const sellValue = Math.max(0, Math.min(tqqqValue * fraction, tqqqValue - floorValue));
  if (sellValue <= 0) return;
  sellTQQQ(portfolio, Math.min(1, sellValue / tqqqValue), prices.tqqq);
}

// The standard-policy action mapping with ONLY the bottomAttack / rampTqqq
// TQQQ purchases converted to equal-dollar QQQ purchases. Everything else —
// the normal TQQQ floor, trimHeat/pause, crashDefense, the TQQQ cap — is
// unchanged. The rotation leg of bottomAttack/rampTqqq is omitted (it would
// round-trip QQQ through fees once the purchase leg is QQQ).
function applyNoBottomLeverageAction(portfolio, decision, prices, monthlyAmount, policy) {
  enforceTqqqCapLocal(portfolio, prices, policy.maxTqqq);
  if (decision.key === "bottomAttack") {
    const totalValue = valueOf(portfolio, prices);
    const need = Math.max(0, totalValue * policy.bottomTqqqTarget - portfolio.tqqq * prices.tqqq);
    const cashSpend = Math.min(portfolio.cash, need, portfolio.cash / 3);
    buyQQQ(portfolio, cashSpend, prices.qqq);
  } else if (decision.key === "crashDefense") {
    sellTQQQ(portfolio, 0.5, prices.tqqq);
  } else if (decision.key === "rampTqqq") {
    const totalValue = valueOf(portfolio, prices);
    const need = Math.max(0, totalValue * policy.rampTqqqTarget - portfolio.tqqq * prices.tqqq);
    const cashLimit = monthlySpendWithDripLocal(portfolio, monthlyAmount);
    buyQQQ(portfolio, Math.min(portfolio.cash, need, cashLimit), prices.qqq);
  } else if (decision.key === "smallDipBuy") {
    buyQQQ(portfolio, Math.min(portfolio.cash, monthlyAmount * 2), prices.qqq);
  } else if (decision.key === "trimHeat") {
    buyQQQ(portfolio, Math.min(portfolio.cash, monthlyAmount * CORE_QQQ_HIGH_REGIME_FRACTION), prices.qqq);
    sellTQQQWithFloorLocal(portfolio, 1 / 12, prices, policy.normalTqqqFloor);
  } else if (decision.key === "pauseAtHigh") {
    buyQQQ(portfolio, Math.min(portfolio.cash, monthlyAmount * CORE_QQQ_HIGH_REGIME_FRACTION), prices.qqq);
  } else if (decision.key === "normalDca") {
    buyTQQQToTargetLocal(portfolio, policy.normalTqqqFloor, prices);
    buyQQQ(portfolio, monthlySpendWithDripLocal(portfolio, monthlyAmount), prices.qqq);
  }
}

// B4-no-bottom-leverage: full three-signal strategy via the exported signal
// machine, with runBacktest's execution conventions (month-start
// contribution, pending orders execute next session, cross-month carry-in
// handled by signalMachineDue).
function runSignalNoBottomLeverage(prices, states, startDate, thresholds = DEFAULT_THRESHOLDS) {
  const policy = RISK_POLICIES[MAIN_SIGNAL_POLICY_KEY];
  const portfolio = emptyPortfolio(COST_BPS);
  const stats = { months: 0, triggers: [], executions: [], reserveAfter: [] };
  const machine = createSignalMachine(thresholds);
  let lastMonth = "";
  let previousPrice = null;
  for (let i = 30; i < prices.length; i += 1) {
    const price = prices[i];
    if (price.date < startDate) continue;
    accrueCash(portfolio, price);
    const month = price.date.slice(0, 7);
    if (month !== lastMonth) {
      if (previousPrice) portfolio.points.push(monthPoint(portfolio, previousPrice));
      lastMonth = month;
      stats.months += 1;
      addContribution(portfolio, MONTHLY, price);
    }
    const due = signalMachineDue(machine, price.date);
    if (due) {
      applyNoBottomLeverageAction(portfolio, due.decision, price, MONTHLY, policy);
      stats.executions.push({ signalDate: due.decisionDate, executionDate: price.date });
    }
    signalMachineClose(machine, states[i], price.date);
    updateDrawdown(portfolio, price);
    previousPrice = price;
  }
  if (previousPrice) portfolio.points.push(monthPoint(portfolio, previousPrice));
  return { portfolio, finalPrices: previousPrice || prices.at(-1), stats };
}

function metricsOf(portfolio, finalPrices) {
  const finalValue = valueOf(portfolio, finalPrices);
  return {
    finalValue,
    contributed: portfolio.contributed,
    maxDrawdown: portfolio.maxDrawdown,
    sharpe: riskStats(portfolio.points).sharpe,
    multiple: portfolio.contributed > 0 ? finalValue / portfolio.contributed : null,
  };
}

const fmtUsd = (value) => (value == null ? "—" : `$${Math.round(value).toLocaleString("en-US")}`);
const fmtPct = (value) => (value == null ? "—" : `${(value * 100).toFixed(1)}%`);
const fmtX = (value) => (value == null ? "—" : `${value.toFixed(2)}x`);
const fmtSharpe = (value) => (value == null ? "—" : value.toFixed(2));
const fmtAchieved = (value) => (value == null ? "—" : `${value.toFixed(2)}x`);
const fmtRatio = (num, den) => {
  if (!(den > 0)) return "—";
  const ratio = num / den;
  return `${ratio.toFixed(Math.abs(ratio - 1) < 0.005 ? 3 : 2)}x`;
};

function summarizeTriggers(stats) {
  const triggers = stats.triggers;
  const tier2 = triggers.filter((trigger) => trigger.multiplier === 2);
  const tier3 = triggers.filter((trigger) => trigger.multiplier === 3);
  const short = triggers.filter((trigger) => trigger.spent < trigger.intended - 1e-6);
  const achieved = triggers.map((trigger) => trigger.spent / MONTHLY);
  const achievedTier3 = tier3.map((trigger) => trigger.spent / MONTHLY);
  return {
    months: stats.months,
    triggerCount: triggers.length,
    tier2Count: tier2.length,
    tier3Count: tier3.length,
    shortCount: short.length,
    intendedTotal: triggers.reduce((sum, trigger) => sum + trigger.intended, 0),
    spentTotal: triggers.reduce((sum, trigger) => sum + trigger.spent, 0),
    avgAchieved: achieved.length ? achieved.reduce((sum, value) => sum + value, 0) / achieved.length : null,
    minAchieved: achieved.length ? Math.min(...achieved) : null,
    avgAchievedTier3: achievedTier3.length ? achievedTier3.reduce((sum, value) => sum + value, 0) / achievedTier3.length : null,
    minAchievedTier3: achievedTier3.length ? Math.min(...achievedTier3) : null,
  };
}

// Rank rows by final value with explicit ties (within $1 grouped with "=").
function rankGroups(startRows) {
  const byFinal = [...startRows].sort((a, b) => b.finalValue - a.finalValue);
  const groups = [];
  for (const row of byFinal) {
    const last = groups.at(-1);
    if (last && Math.abs(last[0].finalValue - row.finalValue) < 1) last.push(row);
    else groups.push([row]);
  }
  return groups;
}

function worstStartSummaries(planList, allRows) {
  return planList.map((plan) => {
    const planRows = allRows.filter((row) => row.plan === plan.key && row.multiple != null);
    const worst = planRows.reduce((a, b) => (b.multiple < a.multiple ? b : a));
    const best = planRows.reduce((a, b) => (b.multiple > a.multiple ? b : a));
    const worstDd = planRows.reduce((a, b) => (b.maxDrawdown < a.maxDrawdown ? b : a));
    return { plan: plan.key, label: plan.label, worst, best, worstDd };
  });
}

function leadLagSplit(allRows, candKey, baseKey) {
  const leads = (starts) => starts.filter((start) => {
    const cand = allRows.find((row) => row.start === start && row.plan === candKey);
    const base = allRows.find((row) => row.start === start && row.plan === baseKey);
    return cand && base && cand.finalValue > base.finalValue;
  });
  const lags = (starts) => starts.filter((start) => {
    const cand = allRows.find((row) => row.start === start && row.plan === candKey);
    const base = allRows.find((row) => row.start === start && row.plan === baseKey);
    return cand && base && cand.finalValue < base.finalValue;
  });
  return {
    actualLeads: leads(ACTUAL_ONLY_STARTS),
    actualLags: lags(ACTUAL_ONLY_STARTS),
    synthLeads: leads(SYNTHETIC_TQQQ_STARTS),
    synthLags: lags(SYNTHETIC_TQQQ_STARTS),
  };
}

function runStudy() {
  const data = loadSnapshotData();
  const prices = buildPrices(data.nasdaq, data.qqq, data.tqqq, data.rates);
  data.prices = prices;
  const capeChrono = capeSeriesForBacktest(data.capeLatestFirst).reverse();
  const states = buildStates(prices, data.nasdaq, data.vix, capeChrono);
  const snapshotId = buildDataSnapshotId(data);

  const qqqActualStart = prices.find((point) => point.qqqSource === "actual")?.date || data.qqq?.[0]?.date || null;
  const tqqqActualStart = prices.find((point) => point.tqqqSource === "actual")?.date || data.tqqq?.[0]?.date || null;

  const syntheticFlags = (start, planKey) => {
    const flags = [];
    if (qqqActualStart && start < qqqActualStart) flags.push("sQQQ");
    const usesTqqq = planKey === "B4" || planKey === "B4nbl";
    if (usesTqqq && tqqqActualStart && start < tqqqActualStart) flags.push("sTQQQ");
    return flags.length ? flags.join("+") : "—";
  };

  const rows = []; // round 1: B1, B2, B3, B4
  const rowsR2 = []; // round 2: B1, B2r, B3r, B4
  const rowsR3 = []; // round 3: B1, B2r, B3r, B2c, B3c, B4
  const rowsAblation = []; // ablation: B1, signalQqq, B4nbl, B4
  const triggerRows = []; // per-start overlapping observations: B2r, B3r, B2c, B3c
  const variantRuns = []; // all naive/ablation runs with stats, for tests
  let maxLoopCheckDiff = 0;
  let maxB2VsB1Diff = 0;
  let maxB3VsB1Diff = 0;

  const naiveSpecs = [
    { key: "B2", multiplierFor: B2_MULTIPLIER, normalTarget: () => MONTHLY, reserveCap: null },
    { key: "B3", multiplierFor: B3_MULTIPLIER, normalTarget: () => MONTHLY, reserveCap: null },
    { key: "B2r", multiplierFor: B2_MULTIPLIER, normalTarget: () => MONTHLY * RESERVE_FRACTION, reserveCap: null },
    { key: "B3r", multiplierFor: B3_MULTIPLIER, normalTarget: () => MONTHLY * RESERVE_FRACTION, reserveCap: null },
    { key: "B2c", multiplierFor: B2_MULTIPLIER, normalTarget: (cash) => Math.max(MONTHLY * RESERVE_FRACTION, cash - B2C_RESERVE_CAP), reserveCap: B2C_RESERVE_CAP },
    { key: "B3c", multiplierFor: B3_MULTIPLIER, normalTarget: (cash) => Math.max(MONTHLY * RESERVE_FRACTION, cash - B3C_RESERVE_CAP), reserveCap: B3C_RESERVE_CAP },
  ];

  for (const start of STARTS) {
    const engine = runBacktest(data, start, MONTHLY, DEFAULT_THRESHOLDS, states, null, COST_BPS);
    const metricsByKey = {
      B1: metricsOf(engine.portfolios.qqq, engine.finalPrices),
      B4: metricsOf(engine.portfolios.signal, engine.finalPrices),
      signalQqq: metricsOf(engine.portfolios.signalQqq, engine.finalPrices),
    };
    for (const spec of naiveSpecs) {
      const run = runNaiveT1(prices, states, start, spec);
      metricsByKey[spec.key] = metricsOf(run.portfolio, run.finalPrices);
      variantRuns.push({ start, plan: spec.key, stats: run.stats });
      if (["B2r", "B3r", "B2c", "B3c"].includes(spec.key)) {
        triggerRows.push({ start, plan: spec.key, ...summarizeTriggers(run.stats) });
      }
    }
    const nblRun = runSignalNoBottomLeverage(prices, states, start, DEFAULT_THRESHOLDS);
    metricsByKey.B4nbl = metricsOf(nblRun.portfolio, nblRun.finalPrices);
    variantRuns.push({ start, plan: "B4nbl", stats: nblRun.stats });

    // Validation: an immediate-execution 1x loop must reproduce the engine's
    // same-day QQQ DCA sleeve (accounting-parity check only, not a plan).
    const checkRun = runNaiveT1(prices, states, start, {
      multiplierFor: () => 1,
      normalTarget: () => MONTHLY,
      immediate: true,
    });
    maxLoopCheckDiff = Math.max(maxLoopCheckDiff, Math.abs(valueOf(checkRun.portfolio, checkRun.finalPrices) - metricsByKey.B1.finalValue));
    maxB2VsB1Diff = Math.max(maxB2VsB1Diff, Math.abs(metricsByKey.B2.finalValue - metricsByKey.B1.finalValue));
    maxB3VsB1Diff = Math.max(maxB3VsB1Diff, Math.abs(metricsByKey.B3.finalValue - metricsByKey.B1.finalValue));

    const pushRows = (target, keys) => {
      for (const key of keys) {
        target.push({ start, plan: key, ...metricsByKey[key], synthetic: syntheticFlags(start, key) });
      }
    };
    pushRows(rows, ["B1", "B2", "B3", "B4"]);
    pushRows(rowsR2, ["B1", "B2r", "B3r", "B4"]);
    pushRows(rowsR3, ["B1", "B2r", "B3r", "B2c", "B3c", "B4"]);
    pushRows(rowsAblation, ["B1", "signalQqq", "B4nbl", "B4"]);
  }

  const uniqueTriggerRows = triggerRows.filter((row) => row.start === STARTS[0]);

  return {
    snapshotId,
    qqqActualStart,
    tqqqActualStart,
    latestDate: prices.at(-1).date,
    rows,
    rowsR2,
    rowsR3,
    rowsAblation,
    triggerRows,
    uniqueTriggerRows,
    variantRuns,
    maxLoopCheckDiff,
    maxB2VsB1Diff,
    maxB3VsB1Diff,
  };
}

function renderReport(study) {
  const {
    snapshotId, qqqActualStart, tqqqActualStart, latestDate,
    rows, rowsR2, rowsR3, rowsAblation, triggerRows, uniqueTriggerRows,
    maxLoopCheckDiff, maxB2VsB1Diff, maxB3VsB1Diff,
  } = study;

  const plans = [
    { key: "B1", label: "B1 QQQ DCA" },
    { key: "B2", label: "B2 Drawdown ladder" },
    { key: "B3", label: "B3 VIX rule" },
    { key: "B4", label: "B4 Three-signal (standard)" },
  ];
  const plansR2 = [
    { key: "B1", label: "B1 QQQ DCA" },
    { key: "B2r", label: "B2r Drawdown ladder + 50% reserve" },
    { key: "B3r", label: "B3r VIX rule + 50% reserve" },
    { key: "B4", label: "B4 Three-signal (standard)" },
  ];
  const plansR3 = [
    { key: "B1", label: "B1 QQQ DCA" },
    { key: "B2r", label: "B2r Drawdown ladder + 50% reserve" },
    { key: "B3r", label: "B3r VIX rule + 50% reserve" },
    { key: "B2c", label: "B2c Drawdown ladder, reserve cap 2x" },
    { key: "B3c", label: "B3c VIX rule, reserve cap 1x" },
    { key: "B4", label: "B4 Three-signal (standard)" },
  ];

  const worstRows = worstStartSummaries(plans, rows);
  const worstRowsR2 = worstStartSummaries(plansR2, rowsR2);
  const worstRowsR3 = worstStartSummaries(plansR3, rowsR3);

  // ---- Round 1 readings (facts only). ----
  const readings = [];
  for (const start of STARTS) {
    const startRows = rows.filter((row) => row.start === start);
    const groups = rankGroups(startRows);
    const ranking = groups.map((group) => group.map((row) => row.plan).join(" = ")).join(" > ");
    const b4Row = startRows.find((row) => row.plan === "B4");
    const b1Row = startRows.find((row) => row.plan === "B1");
    const b4Rank = groups.findIndex((group) => group.some((row) => row.plan === "B4")) + 1;
    readings.push(
      `- ${start}: final-value ranking ${ranking}; `
      + `B4 ranks #${b4Rank} of ${groups.length} distinct groups, B4/B1 final value = ${fmtRatio(b4Row.finalValue, b1Row.finalValue)}, `
      + `B4 max drawdown ${fmtPct(b4Row.maxDrawdown)} vs B1 ${fmtPct(b1Row.maxDrawdown)}.`,
    );
  }
  const b4VsB1 = leadLagSplit(rows, "B4", "B1");
  readings.push(
    `- B4 vs B1 final value, split by sample class: leads in ${b4VsB1.actualLeads.length}/${ACTUAL_ONLY_STARTS.length} actual-only starts`
    + `${b4VsB1.actualLeads.length ? ` (${b4VsB1.actualLeads.join(", ")})` : ""}`
    + ` and ${b4VsB1.synthLeads.length}/${SYNTHETIC_TQQQ_STARTS.length} synthetic-TQQQ starts`
    + `${b4VsB1.synthLeads.length ? ` (${b4VsB1.synthLeads.join(", ")})` : ""}.`
    + ` All start windows overlap and are not independent samples.`,
  );
  const ddCompare = ACTUAL_ONLY_STARTS.concat(SYNTHETIC_TQQQ_STARTS).map((start) => {
    const b1Row = rows.find((row) => row.start === start && row.plan === "B1");
    const b4Row = rows.find((row) => row.start === start && row.plan === "B4");
    return { start, deeper: b4Row.maxDrawdown < b1Row.maxDrawdown };
  });
  const deeperStarts = ddCompare.filter((row) => row.deeper).map((row) => row.start);
  const shallowerStarts = ddCompare.filter((row) => !row.deeper).map((row) => row.start);
  readings.push(
    `- B4 max drawdown is deeper than B1 in ${deeperStarts.length} starts`
    + `${deeperStarts.length ? ` (${deeperStarts.join(", ")})` : ""}, shallower in ${shallowerStarts.length}`
    + `${shallowerStarts.length ? ` (${shallowerStarts.join(", ")})` : ""}.`,
  );
  readings.push(
    `- B2/B3 remain mechanically equivalent to a 1x DCA: normal months still deploy the full contribution, so cash`
    + ` never exceeds one monthly amount and the 2x/3x multipliers still never bind. After the T+1 alignment,`
    + ` B2/B3 differ from B1 only through the one-session execution lag — largest absolute final-value gap across`
    + ` starts: B2 vs B1 ${fmtUsd(maxB2VsB1Diff)}, B3 vs B1 ${fmtUsd(maxB3VsB1Diff)}.`,
  );

  // ---- Round 2 readings (facts only). ----
  const readingsR2 = [];
  for (const start of STARTS) {
    const startRows = rowsR2.filter((row) => row.start === start);
    const groups = rankGroups(startRows);
    const ranking = groups.map((group) => group.map((row) => row.plan).join(" = ")).join(" > ");
    const rowByPlan = Object.fromEntries(startRows.map((row) => [row.plan, row]));
    readingsR2.push(
      `- ${start}: final-value ranking ${ranking}; `
      + `B2r/B1 = ${fmtRatio(rowByPlan.B2r.finalValue, rowByPlan.B1.finalValue)}, `
      + `B3r/B1 = ${fmtRatio(rowByPlan.B3r.finalValue, rowByPlan.B1.finalValue)}, `
      + `B4/B1 = ${fmtRatio(rowByPlan.B4.finalValue, rowByPlan.B1.finalValue)}; `
      + `max drawdown B1 ${fmtPct(rowByPlan.B1.maxDrawdown)} / B2r ${fmtPct(rowByPlan.B2r.maxDrawdown)} / B3r ${fmtPct(rowByPlan.B3r.maxDrawdown)} / B4 ${fmtPct(rowByPlan.B4.maxDrawdown)}.`,
    );
  }
  for (const key of ["B2r", "B3r"]) {
    const split = leadLagSplit(rowsR2, key, "B1");
    const ddShallower = STARTS.filter((start) => {
      const cand = rowsR2.find((row) => row.start === start && row.plan === key);
      const base = rowsR2.find((row) => row.start === start && row.plan === "B1");
      return cand.maxDrawdown > base.maxDrawdown;
    });
    readingsR2.push(
      `- ${key} vs B1 final value: leads in ${split.actualLeads.length}/${ACTUAL_ONLY_STARTS.length} actual-only starts`
      + `${split.actualLeads.length ? ` (${split.actualLeads.join(", ")})` : ""} and ${split.synthLeads.length}/${SYNTHETIC_TQQQ_STARTS.length} synthetic-TQQQ starts`
      + `${split.synthLeads.length ? ` (${split.synthLeads.join(", ")})` : ""}. `
      + `${key} max drawdown is shallower than B1 in ${ddShallower.length} of ${STARTS.length} starts.`,
    );
  }

  // ---- Round 3 readings (facts only). ----
  const readingsR3 = [];
  for (const start of STARTS) {
    const startRows = rowsR3.filter((row) => row.start === start);
    const groups = rankGroups(startRows);
    const ranking = groups.map((group) => group.map((row) => row.plan).join(" = ")).join(" > ");
    const rowByPlan = Object.fromEntries(startRows.map((row) => [row.plan, row]));
    readingsR3.push(
      `- ${start}: final-value ranking ${ranking}; `
      + `B2c/B1 = ${fmtRatio(rowByPlan.B2c.finalValue, rowByPlan.B1.finalValue)}, `
      + `B3c/B1 = ${fmtRatio(rowByPlan.B3c.finalValue, rowByPlan.B1.finalValue)}, `
      + `B4/B1 = ${fmtRatio(rowByPlan.B4.finalValue, rowByPlan.B1.finalValue)}; `
      + `max drawdown B1 ${fmtPct(rowByPlan.B1.maxDrawdown)} / B2c ${fmtPct(rowByPlan.B2c.maxDrawdown)} / B3c ${fmtPct(rowByPlan.B3c.maxDrawdown)} / B4 ${fmtPct(rowByPlan.B4.maxDrawdown)}.`,
    );
  }
  for (const key of ["B2c", "B3c"]) {
    const split = leadLagSplit(rowsR3, key, "B1");
    const ddShallower = STARTS.filter((start) => {
      const cand = rowsR3.find((row) => row.start === start && row.plan === key);
      const base = rowsR3.find((row) => row.start === start && row.plan === "B1");
      return cand.maxDrawdown > base.maxDrawdown;
    });
    readingsR3.push(
      `- ${key} vs B1 final value: leads in ${split.actualLeads.length}/${ACTUAL_ONLY_STARTS.length} actual-only starts`
      + `${split.actualLeads.length ? ` (${split.actualLeads.join(", ")})` : ""} and ${split.synthLeads.length}/${SYNTHETIC_TQQQ_STARTS.length} synthetic-TQQQ starts`
      + `${split.synthLeads.length ? ` (${split.synthLeads.join(", ")})` : ""}. `
      + `${key} max drawdown is shallower than B1 in ${ddShallower.length} of ${STARTS.length} starts.`,
    );
  }
  // Recent actual-only starts, stated precisely: plain DCA ends slightly
  // higher with deeper drawdown; B4 ends slightly lower with shallower
  // drawdown; the reserve plans end below B1 with drawdowns all shallower
  // than B1's (largest cash drag, smallest drawdown relative to DCA).
  for (const start of ["2024-01-01", "2025-01-01"]) {
    const rowByPlan = Object.fromEntries(rowsR3.filter((row) => row.start === start).map((row) => [row.plan, row]));
    const reservePlans = ["B2r", "B3r", "B2c", "B3c"].map((key) => rowByPlan[key]);
    const reserveFinalMin = Math.min(...reservePlans.map((row) => row.finalValue));
    const reserveFinalMax = Math.max(...reservePlans.map((row) => row.finalValue));
    const reserveDdShallowest = Math.max(...reservePlans.map((row) => row.maxDrawdown));
    const reserveDdDeepest = Math.min(...reservePlans.map((row) => row.maxDrawdown));
    const allShallowerThanB1 = reservePlans.every((row) => row.maxDrawdown > rowByPlan.B1.maxDrawdown);
    const allBelowB1 = reservePlans.every((row) => row.finalValue < rowByPlan.B1.finalValue);
    readingsR3.push(
      `- ${start} (actual-only): plain QQQ DCA ends at ${fmtUsd(rowByPlan.B1.finalValue)} with max drawdown ${fmtPct(rowByPlan.B1.maxDrawdown)}; `
      + `B4 ends ${rowByPlan.B4.finalValue < rowByPlan.B1.finalValue ? "lower" : "higher"} at ${fmtUsd(rowByPlan.B4.finalValue)} with a shallower max drawdown of ${fmtPct(rowByPlan.B4.maxDrawdown)}; `
      + `the reserve plans end at ${fmtUsd(reserveFinalMin)}–${fmtUsd(reserveFinalMax)}`
      + `${allBelowB1 ? " (all below B1)" : ""} with drawdowns of ${fmtPct(reserveDdDeepest)} to ${fmtPct(reserveDdShallowest)}`
      + `${allShallowerThanB1 ? ", all shallower than B1's" : ""} — the largest cash drag and the smallest drawdowns relative to DCA.`,
    );
  }
  // Leverage ablation bullets.
  const ablationByStart = STARTS.map((start) => Object.fromEntries(rowsAblation.filter((row) => row.start === start).map((row) => [row.plan, row])));
  for (const [label, starts] of [["actual-only", ACTUAL_ONLY_STARTS], ["synthetic-TQQQ", SYNTHETIC_TQQQ_STARTS]]) {
    const subset = starts.map((start) => ablationByStart[STARTS.indexOf(start)]);
    const gaps = subset.map((rowsByPlan, index) => ({
      start: starts[index],
      removed: rowsByPlan.B4.finalValue - rowsByPlan.B4nbl.finalValue,
      edge: rowsByPlan.B4.finalValue - rowsByPlan.B1.finalValue,
      rowsByPlan,
    }));
    const identical = gaps.filter((gap) => Math.abs(gap.removed) <= 1).map((gap) => gap.start);
    const fired = gaps.filter((gap) => gap.removed > 1);
    const firedLowered = fired.filter((gap) => gap.rowsByPlan.B4nbl.finalValue < gap.rowsByPlan.B4.finalValue).length;
    const shares = fired.filter((gap) => gap.edge > 0).map((gap) => gap.removed / gap.edge);
    const minShare = shares.length ? Math.min(...shares) : null;
    const maxShare = shares.length ? Math.max(...shares) : null;
    const nblBeatsB1 = subset.filter((rowsByPlan) => rowsByPlan.B4nbl.finalValue > rowsByPlan.B1.finalValue).length;
    const sqBeatsB1 = subset.filter((rowsByPlan) => rowsByPlan.signalQqq.finalValue > rowsByPlan.B1.finalValue).length;
    readingsR3.push(
      `- Leverage ablation (${label} starts): bottomAttack/rampTqqq TQQQ purchases fired in ${fired.length}/${subset.length} ${label} starts`
      + `${fired.length ? ` (${fired.map((gap) => gap.start).join(", ")})` : ""}, lowering B4 final value in ${firedLowered} of them`
      + `${shares.length ? `; the removed amount equals ${(100 * minShare).toFixed(0)}%–${(100 * maxShare).toFixed(0)}% of B4's final-value edge over B1 in those starts` : ""}. `
      + (identical.length ? `B4nbl is identical to B4 in ${identical.join(", ")} (no bottom purchase fired in those windows). ` : "")
      + `B4nbl still exceeds B1 in ${nblBeatsB1}/${subset.length} ${label} starts; signalQqq exceeds B1 in ${sqBeatsB1}/${subset.length}.`,
    );
  }
  readingsR3.push(
    `- Attribution caveat: the ablation removes only bottomAttack/rampTqqq TQQQ purchases. Signal timing, the cash throttle,`
    + ` the normal TQQQ floor, and crash-defense sales remain in B4nbl, so the B4 vs B4nbl gap cannot be credited to`
    + ` leverage alone; the B4nbl vs signalQqq gap additionally mixes the normal TQQQ floor with QQQ-side action-mapping`
    + ` differences. These numbers are consistent with bottom leverage contributing a large share of B4's edge over DCA,`
    + ` but they do not isolate it.`,
  );

  // ---- Trigger-stat aggregates. ----
  const triggerAggBullets = [];
  for (const key of ["B2r", "B3r", "B2c", "B3c"]) {
    const row = uniqueTriggerRows.find((item) => item.plan === key);
    if (!row) continue;
    const tier3Note = row.tier3Count > 0
      ? ` In 3x months the achieved spend averaged ${fmtAchieved(row.avgAchievedTier3)} of the monthly amount (worst month ${fmtAchieved(row.minAchievedTier3)}).`
      : "";
    triggerAggBullets.push(
      `- ${key} (unique months, ${STARTS[0]} start only): ${row.triggerCount} trigger months out of ${row.months} `
      + `(${row.tier2Count} at 2x, ${row.tier3Count} at 3x); cash covered the full requested multiplier in ${row.triggerCount - row.shortCount} of ${row.triggerCount} trigger months, `
      + `${row.shortCount} were cash-constrained; intended ${fmtUsd(row.intendedTotal)} vs actual ${fmtUsd(row.spentTotal)} (${row.intendedTotal > 0 ? `${(100 * row.spentTotal / row.intendedTotal).toFixed(1)}%` : "—"} deployed).${tier3Note}`,
    );
  }

  // ---- Report. ----
  const lines = [];
  lines.push("# Naive Baseline Comparison Study");
  lines.push("");
  lines.push(`Generated by \`scripts/baseline-study.cjs\` on ${new Date().toISOString().slice(0, 10)} (UTC).`);
  lines.push(`Data: versioned snapshots \`${snapshotId}\` (offline), last market date ${latestDate}. Round-1 rules frozen ${FREEZE_DATE} before viewing any round-1 output; round-2 rules frozen ${FREEZE_DATE} before viewing any round-2 output; round-3 rules (T+1 alignment, capped reserves, bottom-leverage ablation) frozen ${FREEZE_DATE} before viewing any round-3 output.`);
  lines.push("");
  lines.push("Sample classes used throughout: **actual-only starts** (TQQQ history fully actual): " + ACTUAL_ONLY_STARTS.join(", ") + ". **Synthetic-TQQQ starts**: " + SYNTHETIC_TQQQ_STARTS.join(", ") + " (B4/B4nbl rows include synthetic TQQQ before 2010-02-11). All start windows overlap and are not independent samples; overall counts like \"x of 11\" are subordinate to the per-class counts.");
  lines.push("");
  lines.push("## Round 1 — frozen rules");
  lines.push("");
  lines.push("Common setup: $1,000 contributed on the first trading day of each month; 5 bps friction on every trade; idle cash accrues the FEDFUNDS-based short rate (engine `accrueCash`). Month-start locks use the state of the month's first trading day, matching engine conventions.");
  lines.push("");
  lines.push("- **B1 QQQ DCA**: every month the full available cash buys QQQ (engine `portfolios.qqq`). Reference plan.");
  lines.push("- **B2 Drawdown ladder** (QQQ only, buy-only): at each month start, if the Nasdaq-100 5-day-average drawdown is <= -20%, invest up to 3x the monthly amount from accumulated cash; if <= -10%, invest 2x; otherwise 1x.");
  lines.push("- **B3 VIX rule** (QQQ only, buy-only): at each month start, if the VIX 5-day average is >= 30, invest 2x the monthly amount; otherwise 1x.");
  lines.push("- **B4 Three-signal standard policy**: the existing main strategy (`runBacktest` `portfolios.signal`), used as-is; not modified.");
  lines.push("");
  lines.push(`B2/B3 "Nx" spends out of the plan's accumulated cash (unspent cash keeps earning interest), aligned with the three-signal strategy's cash mechanics for fairness.`);
  lines.push("");
  lines.push("Declaration: the four rule sets above were frozen before any study output was inspected. The B2/B3 parameters (-10%/-20%/3x/2x and 30/2x) must not be retuned based on these results; results adverse to any plan are reported as-is.");
  lines.push("");
  lines.push("## Round 1 — method");
  lines.push("");
  lines.push(`- ${STARTS.length} start dates x 5 bps cost; $${MONTHLY.toLocaleString("en-US")} contributed on each month's first trading day.`);
  lines.push("- B1 and B4 come from the engine's `runBacktest` (`portfolios.qqq` / `portfolios.signal`). B2/B3 use a small monthly loop built from the same exported accounting primitives (`emptyPortfolio`, `addContribution`, `accrueCash`, `buyQQQ`, `updateDrawdown`, `valueOf`, `riskStats`).");
  lines.push("- Execution alignment (round-3 fix, applied retroactively): B2/B3 lock the month-start signal at the close of the month's first trading day and execute at the next trading session, the same convention as B4's signal sleeve. All tables in this report are regenerated under T+1 and supersede the earlier same-day figures. B1 remains the engine's same-day month-start DCA benchmark, unchanged.");
  lines.push("- Metrics: finalValue (terminal portfolio value), maxDrawdown (unit-NAV peak-to-trough), Sharpe (monthly excess return over the modeled cash rate, annualized by sqrt(12), engine `riskStats`), multiple (finalValue / total contributed).");
  lines.push(`- Loop validation: an immediate-execution 1x naive loop reproduces the engine's same-day QQQ DCA final value within $${maxLoopCheckDiff.toFixed(4)} across all ${STARTS.length} starts.`);
  lines.push(`- Synthetic history: QQQ before ${qqqActualStart} and TQQQ before ${tqqqActualStart} are synthetic (pre-inception). Rows touching synthetic history are flagged: \`sQQQ\` affects all plans, \`sTQQQ\` affects B4/B4nbl only (B1/B2/B3/B2r/B3r/B2c/B3c/signalQqq hold QQQ only).`);
  lines.push("");
  lines.push("## Round 1 — results by start date");
  lines.push("");
  lines.push("| Start | Plan | Final value | Max drawdown | Sharpe | Multiple | Contributed | Synthetic |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of rows) {
    lines.push(`| ${row.start} | ${row.plan} | ${fmtUsd(row.finalValue)} | ${fmtPct(row.maxDrawdown)} | ${fmtSharpe(row.sharpe)} | ${fmtX(row.multiple)} | ${fmtUsd(row.contributed)} | ${row.synthetic} |`);
  }
  lines.push("");
  lines.push("## Round 1 — worst-start rows (dispersion across starts)");
  lines.push("");
  lines.push("| Plan | Worst start (by multiple) | Multiple | Max drawdown in worst start | Final value | Multiple spread (best - worst) | Deepest drawdown start | Deepest drawdown |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |");
  for (const summary of worstRows) {
    lines.push(`| ${summary.plan} | ${summary.worst.start} | ${fmtX(summary.worst.multiple)} | ${fmtPct(summary.worst.maxDrawdown)} | ${fmtUsd(summary.worst.finalValue)} | ${fmtX(summary.best.multiple - summary.worst.multiple)} | ${summary.worstDd.start} | ${fmtPct(summary.worstDd.maxDrawdown)} |`);
  }
  lines.push("");
  lines.push("## Round 1 — preliminary readings (facts only, no recommendation)");
  lines.push("");
  lines.push(...readings);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`## Round 2 — reserve-based naive rules (frozen ${FREEZE_DATE})`);
  lines.push("");
  lines.push("Round 1 showed that B2/B3 mechanically degenerate to B1: normal months deploy the full contribution, so no cash reserve can accumulate and the 2x/3x multipliers never bind. Round 2 repeats the comparison with a reserve mechanism added to the same naive triggers, and instruments every trigger month for cash sufficiency.");
  lines.push("");
  lines.push("### Frozen rules (round 2)");
  lines.push("");
  lines.push("- **B2r Drawdown ladder with reserve** (QQQ only, buy-only): in normal months invest only 50% of the monthly amount and keep the rest in cash; at each month start, if the Nasdaq-100 5-day-average drawdown is <= -20%, spend up to 3x the monthly amount from accumulated cash; if <= -10%, spend up to 2x.");
  lines.push("- **B3r VIX rule with reserve** (QQQ only, buy-only): in normal months invest 50% of the monthly amount; at each month start, if the VIX 5-day average is >= 30, spend up to 2x the monthly amount from accumulated cash.");
  lines.push("- Rationale, stated as required: the 50% reserve fraction mirrors the three-signal strategy's own high-regime throttle (50% core QQQ in pause/trim months, `CORE_QQQ_HIGH_REGIME_FRACTION`); the 2x/3x multipliers and the -10%/-20%/30 thresholds keep the round-1 frozen values. B2r/B3r each keep an independent cash ledger. Same 5 bps friction and FEDFUNDS cash accrual as round 1.");
  lines.push("");
  lines.push("Declaration: the round-2 rules above were frozen before any round-2 output was inspected; results adverse to any plan are reported as-is.");
  lines.push("");
  lines.push("### Method (round 2)");
  lines.push("");
  lines.push("- Identical setup to round 1; B1 and B4 are reused from the round-1 runs. B2r/B3r run the same monthly T+1 loop as B2/B3 with normal months buying `min(cash, 0.5 x monthly)` and trigger months buying `min(cash, N x monthly)`, executed at the next session after the month-start lock.");
  lines.push("");
  lines.push("### Results by start date (round 2)");
  lines.push("");
  lines.push("| Start | Plan | Final value | Max drawdown | Sharpe | Multiple | Contributed | Synthetic |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of rowsR2) {
    lines.push(`| ${row.start} | ${row.plan} | ${fmtUsd(row.finalValue)} | ${fmtPct(row.maxDrawdown)} | ${fmtSharpe(row.sharpe)} | ${fmtX(row.multiple)} | ${fmtUsd(row.contributed)} | ${row.synthetic} |`);
  }
  lines.push("");
  lines.push("### Worst-start rows (round 2, dispersion across starts)");
  lines.push("");
  lines.push("| Plan | Worst start (by multiple) | Multiple | Max drawdown in worst start | Final value | Multiple spread (best - worst) | Deepest drawdown start | Deepest drawdown |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |");
  for (const summary of worstRowsR2) {
    lines.push(`| ${summary.plan} | ${summary.worst.start} | ${fmtX(summary.worst.multiple)} | ${fmtPct(summary.worst.maxDrawdown)} | ${fmtUsd(summary.worst.finalValue)} | ${fmtX(summary.best.multiple - summary.worst.multiple)} | ${summary.worstDd.start} | ${fmtPct(summary.worstDd.maxDrawdown)} |`);
  }
  lines.push("");
  lines.push("### Preliminary readings (round 2, facts only, no recommendation)");
  lines.push("");
  lines.push(...readingsR2);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`## Round 3 — T+1 alignment, capped reserves, bottom-leverage ablation (frozen ${FREEZE_DATE})`);
  lines.push("");
  lines.push("Round 3 applies the PR #7 review fix list: (1) all naive signal plans now execute T+1 (applied retroactively, see round-1 method note); (2) capped-reserve baselines B2c/B3c are added next to the uncapped B2r/B3r; (3) a direct bottom-leverage ablation (signalQqq + B4-no-bottom-leverage) replaces indirect inference.");
  lines.push("");
  lines.push("### Frozen rules (round 3)");
  lines.push("");
  lines.push("- **B2c Capped drawdown ladder** (QQQ only, buy-only): extra reserve capped at 2 monthly amounts. Normal months: while the reserve is below the cap, invest 50% of the monthly amount and stock the rest; once the reserve is full, resume 100% QQQ DCA. Trigger months: drawdown <= -10% spends up to 2x the monthly amount from cash, <= -20% up to 3x; the reserve refills afterwards under the same rule.");
  lines.push("- **B3c Capped VIX rule** (QQQ only, buy-only): same, with the reserve capped at 1 monthly amount; VIX 5-day average >= 30 spends up to 2x the monthly amount.");
  lines.push("- **Reserve definition (frozen)**: the portfolio's only cash source is undeployed contributions, so the extra reserve IS the cash balance. Cash is fungible, so trigger-month spending draws from total available cash with no ordering distinction between the reserve and the current month's contribution. The cap is enforced by the normal-month spend rule at execution: `spend = min(cash, max(0.5 x monthly, cash - cap))`, which guarantees the reserve immediately after each execution is <= the cap; between executions, accrued interest can push the balance slightly above the cap (interest income, not active hoarding). All decisions T+1 as fixed in (1).");
  lines.push("- **B4-no-bottom-leverage (B4nbl)**: the full three-signal standard policy — every signal, the normal TQQQ floor, trimHeat/pause, crash defense, and the TQQQ cap unchanged — with ONLY the TQQQ purchases inside bottomAttack and rampTqqq converted to equal-dollar QQQ purchases. The QQQ->TQQQ rotation leg of those two actions is omitted (with the purchase leg ablated to QQQ it would round-trip QQQ through fees). Built inside this script from the exported signal machine (`createSignalMachine` / `signalMachineClose` / `signalMachineDue`) and accounting primitives, with runBacktest's execution conventions (month-start contribution, pending orders execute next session, cross-month carry-in handled by the machine). `api/_lib.js` is not modified for this variant.");
  lines.push("- **signalQqq**: the engine's existing sleeve (`runBacktest` `portfolios.signalQqq`) — same signals, trades QQQ only.");
  lines.push("");
  lines.push("Declaration: the round-3 rules above were frozen before any round-3 output was inspected; results adverse to any plan are reported as-is.");
  lines.push("");
  lines.push("### Results by start date (round 3: capped vs uncapped reserves)");
  lines.push("");
  lines.push("| Start | Plan | Final value | Max drawdown | Sharpe | Multiple | Contributed | Synthetic |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of rowsR3) {
    lines.push(`| ${row.start} | ${row.plan} | ${fmtUsd(row.finalValue)} | ${fmtPct(row.maxDrawdown)} | ${fmtSharpe(row.sharpe)} | ${fmtX(row.multiple)} | ${fmtUsd(row.contributed)} | ${row.synthetic} |`);
  }
  lines.push("");
  lines.push("### Trigger and cash-sufficiency statistics (round 3)");
  lines.push("");
  lines.push("Per-start observations below come from overlapping start windows (not independent samples). The unique-month aggregates in the bullets further down use only the 1990-01-01 start, where every month is counted once.");
  lines.push("");
  lines.push("| Start | Plan | Months | 2x trigger months | 3x trigger months | Cash-short trigger months | Avg achieved spend (x monthly) | Worst achieved (x monthly) | Intended spend | Actual spend |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of triggerRows) {
    lines.push(`| ${row.start} | ${row.plan} | ${row.months} | ${row.tier2Count} | ${row.tier3Count} | ${row.shortCount} | ${fmtAchieved(row.avgAchieved)} | ${fmtAchieved(row.minAchieved)} | ${fmtUsd(row.intendedTotal)} | ${fmtUsd(row.spentTotal)} |`);
  }
  lines.push("");
  lines.push("Unique-month aggregates (1990-01-01 start only):");
  lines.push("");
  lines.push(...triggerAggBullets);
  lines.push("");
  lines.push("### Bottom-leverage ablation");
  lines.push("");
  lines.push("| Start | Plan | Final value | Max drawdown | Sharpe | Multiple | Contributed | Synthetic |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of rowsAblation) {
    lines.push(`| ${row.start} | ${row.plan} | ${fmtUsd(row.finalValue)} | ${fmtPct(row.maxDrawdown)} | ${fmtSharpe(row.sharpe)} | ${fmtX(row.multiple)} | ${fmtUsd(row.contributed)} | ${row.synthetic} |`);
  }
  lines.push("");
  lines.push("### Worst-start rows (round 3, dispersion across starts)");
  lines.push("");
  lines.push("| Plan | Worst start (by multiple) | Multiple | Max drawdown in worst start | Final value | Multiple spread (best - worst) | Deepest drawdown start | Deepest drawdown |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |");
  for (const summary of worstRowsR3) {
    lines.push(`| ${summary.plan} | ${summary.worst.start} | ${fmtX(summary.worst.multiple)} | ${fmtPct(summary.worst.maxDrawdown)} | ${fmtUsd(summary.worst.finalValue)} | ${fmtX(summary.best.multiple - summary.worst.multiple)} | ${summary.worstDd.start} | ${fmtPct(summary.worstDd.maxDrawdown)} |`);
  }
  lines.push("");
  lines.push("### Preliminary readings (round 3, facts only, no recommendation)");
  lines.push("");
  lines.push(...readingsR3);
  lines.push("");

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function main() {
  const study = runStudy();
  const report = renderReport(study);
  process.stdout.write(report);
  const docsDir = path.join(__dirname, "..", "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "baseline-study.md"), report);
  console.error("wrote docs/baseline-study.md");
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
  RESERVE_FRACTION,
  B2C_RESERVE_CAP,
  B3C_RESERVE_CAP,
};
