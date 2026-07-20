#!/usr/bin/env node
/**
 * scripts/baseline-study.cjs — naive-baseline comparison study (research script).
 *
 * This script does not change any production strategy behavior. It reuses the
 * engine's accounting primitives (api/_lib.js) to compare four pre-registered
 * plans over 11 start dates and writes docs/baseline-study.md.
 *
 * FROZEN RULES (frozen 2026-07-20, before viewing any output of this study)
 * ------------------------------------------------------------------------
 * Common setup: $1,000 is contributed on the first trading day of each month;
 * every buy/sell pays 5 bps of friction; idle cash accrues the FEDFUNDS-based
 * short rate via the engine's accrueCash. Month-start locks use the state of
 * the month's first trading day, matching engine conventions.
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
  emptyPortfolio,
  accrueCash,
  addContribution,
  buyQQQ,
  updateDrawdown,
  valueOf,
  riskStats,
  DEFAULT_THRESHOLDS,
} = require("../api/_lib");

const FREEZE_DATE = "2026-07-20";
const MONTHLY = 1000;
const COST_BPS = 5;
const STARTS = [
  "1990-01-01", "1995-01-01", "2000-01-01", "2005-01-01", "2010-01-01",
  "2010-02-11", "2015-01-01", "2020-01-01", "2023-01-01", "2024-01-01",
  "2025-01-01",
];

// Frozen multipliers. B2: Nasdaq-100 5-day-average drawdown ladder.
// B3: VIX 5-day average rule. Both buy-only, QQQ only, spending from cash.
const B2_MULTIPLIER = (state) => (state.drawdownPct <= -20 ? 3 : state.drawdownPct <= -10 ? 2 : 1);
const B3_MULTIPLIER = (state) => (state.vix >= 30 ? 2 : 1);

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

// Monthly buy-only loop for the naive plans, mirroring the runBacktest QQQ
// sleeve: accrue cash daily; on a month change, contribute, then buy QQQ with
// min(cash, multiplier x monthlyAmount); update drawdown daily; record one
// month-end point per month.
function runNaivePlan(prices, states, startDate, multiplierFor) {
  const portfolio = emptyPortfolio(COST_BPS);
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
      addContribution(portfolio, MONTHLY, price);
      buyQQQ(portfolio, MONTHLY * multiplierFor(states[i]), price.qqq);
    }
    updateDrawdown(portfolio, price);
    previousPrice = price;
  }
  if (previousPrice) portfolio.points.push(monthPoint(portfolio, previousPrice));
  return { portfolio, finalPrices: previousPrice || prices.at(-1) };
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

function main() {
  const data = loadSnapshotData();
  const prices = buildPrices(data.nasdaq, data.qqq, data.tqqq, data.rates);
  data.prices = prices;
  const capeChrono = capeSeriesForBacktest(data.capeLatestFirst).reverse();
  const states = buildStates(prices, data.nasdaq, data.vix, capeChrono);
  const snapshotId = buildDataSnapshotId(data);

  const qqqActualStart = prices.find((point) => point.qqqSource === "actual")?.date || data.qqq?.[0]?.date || null;
  const tqqqActualStart = prices.find((point) => point.tqqqSource === "actual")?.date || data.tqqq?.[0]?.date || null;

  const plans = [
    { key: "B1", label: "B1 QQQ DCA" },
    { key: "B2", label: "B2 Drawdown ladder" },
    { key: "B3", label: "B3 VIX rule" },
    { key: "B4", label: "B4 Three-signal (standard)" },
  ];

  const rows = [];
  let maxLoopCheckDiff = 0;
  let maxB2VsB1Diff = 0;
  let maxB3VsB1Diff = 0;

  for (const start of STARTS) {
    const engine = runBacktest(data, start, MONTHLY, DEFAULT_THRESHOLDS, states, null, COST_BPS);
    const b1 = metricsOf(engine.portfolios.qqq, engine.finalPrices);
    const b4 = metricsOf(engine.portfolios.signal, engine.finalPrices);
    const b2Run = runNaivePlan(prices, states, start, B2_MULTIPLIER);
    const b2 = metricsOf(b2Run.portfolio, b2Run.finalPrices);
    const b3Run = runNaivePlan(prices, states, start, B3_MULTIPLIER);
    const b3 = metricsOf(b3Run.portfolio, b3Run.finalPrices);

    // Validation: a naive 1x loop must reproduce the engine's QQQ DCA sleeve.
    const checkRun = runNaivePlan(prices, states, start, () => 1);
    maxLoopCheckDiff = Math.max(maxLoopCheckDiff, Math.abs(valueOf(checkRun.portfolio, checkRun.finalPrices) - b1.finalValue));
    maxB2VsB1Diff = Math.max(maxB2VsB1Diff, Math.abs(b2.finalValue - b1.finalValue));
    maxB3VsB1Diff = Math.max(maxB3VsB1Diff, Math.abs(b3.finalValue - b1.finalValue));

    const syntheticQqq = qqqActualStart && start < qqqActualStart;
    const syntheticTqqq = tqqqActualStart && start < tqqqActualStart;
    const metricsByKey = { B1: b1, B2: b2, B3: b3, B4: b4 };
    for (const plan of plans) {
      const flags = [];
      if (syntheticQqq) flags.push("sQQQ");
      if (plan.key === "B4" && syntheticTqqq) flags.push("sTQQQ");
      rows.push({
        start,
        plan: plan.key,
        label: plan.label,
        ...metricsByKey[plan.key],
        synthetic: flags.length ? flags.join("+") : "—",
      });
    }
  }

  // ---- Dispersion summary: worst start row per plan (by multiple). ----
  const worstRows = plans.map((plan) => {
    const planRows = rows.filter((row) => row.plan === plan.key && row.multiple != null);
    const worst = planRows.reduce((a, b) => (b.multiple < a.multiple ? b : a));
    const best = planRows.reduce((a, b) => (b.multiple > a.multiple ? b : a));
    const worstDd = planRows.reduce((a, b) => (b.maxDrawdown < a.maxDrawdown ? b : a));
    return { plan: plan.key, label: plan.label, worst, best, worstDd };
  });

  // ---- Preliminary readings (facts only, generated from the rows). ----
  const readings = [];
  const b1Rows = rows.filter((row) => row.plan === "B1");
  for (const start of STARTS) {
    const startRows = rows.filter((row) => row.start === start);
    const byFinal = [...startRows].sort((a, b) => b.finalValue - a.finalValue);
    const b4Row = startRows.find((row) => row.plan === "B4");
    const b1Row = startRows.find((row) => row.plan === "B1");
    // Rank with explicit ties: final values within $1 are grouped with "=".
    const groups = [];
    for (const row of byFinal) {
      const last = groups.at(-1);
      if (last && Math.abs(last[0].finalValue - row.finalValue) < 1) last.push(row);
      else groups.push([row]);
    }
    const ranking = groups.map((group) => group.map((row) => row.plan).join(" = ")).join(" > ");
    const b4Rank = groups.findIndex((group) => group.some((row) => row.plan === "B4")) + 1;
    const ratio = b1Row.finalValue > 0 ? b4Row.finalValue / b1Row.finalValue : null;
    const ratioDigits = ratio != null && Math.abs(ratio - 1) < 0.005 ? 3 : 2;
    readings.push(
      `- ${start}: final-value ranking ${ranking}; `
      + `B4 ranks #${b4Rank} of ${groups.length} distinct groups, B4/B1 final value = ${ratio == null ? "—" : ratio.toFixed(ratioDigits)}x, `
      + `B4 max drawdown ${fmtPct(b4Row.maxDrawdown)} vs B1 ${fmtPct(b1Row.maxDrawdown)}.`,
    );
  }
  const b4Leads = b1Rows.filter((b1Row) => {
    const b4Row = rows.find((row) => row.start === b1Row.start && row.plan === "B4");
    return b4Row.finalValue > b1Row.finalValue;
  }).map((row) => row.start);
  const b4Lags = b1Rows.filter((b1Row) => {
    const b4Row = rows.find((row) => row.start === b1Row.start && row.plan === "B4");
    return b4Row.finalValue < b1Row.finalValue;
  }).map((row) => row.start);
  readings.push(
    `- B4 final value exceeds B1 in ${b4Leads.length} of ${STARTS.length} starts`
    + `${b4Leads.length ? ` (${b4Leads.join(", ")})` : ""}; `
    + `B4 trails B1 in ${b4Lags.length} starts${b4Lags.length ? ` (${b4Lags.join(", ")})` : ""}.`,
  );
  const ddCompare = b1Rows.map((b1Row) => {
    const b4Row = rows.find((row) => row.start === b1Row.start && row.plan === "B4");
    return { start: b1Row.start, deeper: b4Row.maxDrawdown < b1Row.maxDrawdown, diff: b4Row.maxDrawdown - b1Row.maxDrawdown };
  });
  const deeperStarts = ddCompare.filter((row) => row.deeper).map((row) => row.start);
  const shallowerStarts = ddCompare.filter((row) => !row.deeper).map((row) => row.start);
  readings.push(
    `- B4 max drawdown is deeper than B1 in ${deeperStarts.length} starts`
    + `${deeperStarts.length ? ` (${deeperStarts.join(", ")})` : ""}, shallower in ${shallowerStarts.length}`
    + `${shallowerStarts.length ? ` (${shallowerStarts.join(", ")})` : ""}.`,
  );
  if (maxB2VsB1Diff < 0.01 && maxB3VsB1Diff < 0.01) {
    readings.push(
      `- B2 and B3 match B1 to within $0.01 of final value in every start. Under the frozen cash`
      + ` mechanics, normal months deploy the full contribution, so cash never accumulates beyond one`
      + ` monthly amount and the 2x/3x multipliers never bind past the current month's contribution.`
      + ` As frozen, the naive timing rules are mechanically equivalent to QQQ DCA.`,
    );
  } else {
    readings.push(
      `- Largest B2-vs-B1 final-value gap across starts: ${fmtUsd(maxB2VsB1Diff)}; `
      + `largest B3-vs-B1 gap: ${fmtUsd(maxB3VsB1Diff)}.`,
    );
  }

  // ---- Report. ----
  const lines = [];
  lines.push("# Naive Baseline Comparison Study");
  lines.push("");
  lines.push(`Generated by \`scripts/baseline-study.cjs\` on ${new Date().toISOString().slice(0, 10)} (UTC).`);
  lines.push(`Data: versioned snapshots \`${snapshotId}\` (offline). Rules frozen ${FREEZE_DATE}, before viewing any output of this study.`);
  lines.push("");
  lines.push("## Frozen rules");
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
  lines.push("## Method");
  lines.push("");
  lines.push(`- ${STARTS.length} start dates x 5 bps cost; $${MONTHLY.toLocaleString("en-US")} contributed on each month's first trading day.`);
  lines.push("- B1 and B4 come from the engine's `runBacktest` (`portfolios.qqq` / `portfolios.signal`). B2/B3 use a small monthly loop built from the same exported accounting primitives (`emptyPortfolio`, `addContribution`, `accrueCash`, `buyQQQ`, `updateDrawdown`, `valueOf`, `riskStats`).");
  lines.push("- B2 locks the month-start `drawdownPct`, B3 the month-start `vix` (5-day averages from `buildStates`), both observed on the month's first trading day and acted on the same day, consistent with the engine's QQQ-sleeve convention.");
  lines.push("- Metrics: finalValue (terminal portfolio value), maxDrawdown (unit-NAV peak-to-trough), Sharpe (monthly excess return over the modeled cash rate, annualized by sqrt(12), engine `riskStats`), multiple (finalValue / total contributed).");
  lines.push(`- Loop validation: a 1x naive loop reproduces the engine's QQQ DCA final value within $${maxLoopCheckDiff.toFixed(4)} across all ${STARTS.length} starts.`);
  lines.push(`- Synthetic history: QQQ before ${qqqActualStart} and TQQQ before ${tqqqActualStart} are synthetic (pre-inception). Rows touching synthetic history are flagged: \`sQQQ\` affects all plans, \`sTQQQ\` affects B4 only (B1/B2/B3 hold QQQ only).`);
  lines.push("");
  lines.push("## Results by start date");
  lines.push("");
  lines.push("| Start | Plan | Final value | Max drawdown | Sharpe | Multiple | Contributed | Synthetic |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of rows) {
    lines.push(`| ${row.start} | ${row.plan} | ${fmtUsd(row.finalValue)} | ${fmtPct(row.maxDrawdown)} | ${fmtSharpe(row.sharpe)} | ${fmtX(row.multiple)} | ${fmtUsd(row.contributed)} | ${row.synthetic} |`);
  }
  lines.push("");
  lines.push("## Worst-start rows (dispersion across starts)");
  lines.push("");
  lines.push("| Plan | Worst start (by multiple) | Multiple | Max drawdown in worst start | Final value | Multiple spread (best - worst) | Deepest drawdown start | Deepest drawdown |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |");
  for (const summary of worstRows) {
    lines.push(`| ${summary.plan} | ${summary.worst.start} | ${fmtX(summary.worst.multiple)} | ${fmtPct(summary.worst.maxDrawdown)} | ${fmtUsd(summary.worst.finalValue)} | ${fmtX(summary.best.multiple - summary.worst.multiple)} | ${summary.worstDd.start} | ${fmtPct(summary.worstDd.maxDrawdown)} |`);
  }
  lines.push("");
  lines.push("## Preliminary readings (facts only, no recommendation)");
  lines.push("");
  lines.push(...readings);
  lines.push("");

  const report = `${lines.join("\n")}\n`;
  process.stdout.write(report);
  const docsDir = path.join(__dirname, "..", "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "baseline-study.md"), report);
  console.error("wrote docs/baseline-study.md");
}

main();
