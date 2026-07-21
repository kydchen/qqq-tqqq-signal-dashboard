#!/usr/bin/env node
/**
 * scripts/state-attribution-study.cjs — single-state marginal attribution
 * study (research).
 *
 * Implements the FROZEN pre-registration in
 * docs/single-state-attribution-prereg.md (pre-registered 2026-07-21
 * Asia/Taipei, commit 134ccbd version, before implementation code or output
 * existed). The frozen spec is not modified by this script; the
 * implementation deviation declaration is "none".
 *
 * Variants (frozen):
 *   P   — the production strategy, taken directly from runBacktest
 *         portfolios.signal (value metrics). P's per-state TQQQ share counts
 *         come from the production-semantics replica (the same line-by-line
 *         copy of applySignalAction used and parity-asserted in the #9
 *         study), because the engine does not record per-execution share
 *         deltas; the replica's final value is parity-asserted against the
 *         engine signal portfolio within 1e-9 in the test suite.
 *   F   — the full target-weight sleeve, exact variant, REUSED from
 *         scripts/tqqq-sleeve-study.cjs (runActionLoop + executeSleeveMonth
 *         imported, not reimplemented; the #9 study's tests stay green and
 *         its report byte-identical — the only change there is a pure-append
 *         module.exports addition).
 *   S1–S7 — P with exactly one state replaced by its #9 target semantics:
 *         S1 normalDca → exact 10%; S2 smallDipBuy → exact 10%;
 *         S3 bottomAttack → exact 25%; S4 rampTqqq → 25% + 15% × k / 6 with
 *         k = 7 − decision.rampMonths; S5 trimHeat → max(10%, current ×
 *         11/12); S6 pauseAtHigh → freeze current weight; S7 crashDefense →
 *         current × 50%.
 *
 * Execution semantics (frozen): at each monthly execution of a REPLACED
 * state — month-start contribution, the state's retained QQQ/cash
 * incremental leg exactly as in production, the TQQQ target computed from
 * post-action NAV and reached via the #9 funding waterfall (cash first,
 * then QQQ sales for the shortfall, excess TQQQ sold to cash), 40% cap
 * enforced AFTER the sleeve rebalance (#9 timing). All OTHER states execute
 * the full production rules (both legs) with production cap timing (cap
 * enforced BEFORE the action, as in runBacktest). Shared conventions from
 * #9: T+1 execution, carry-in via the shared signal machine, 5 bps friction
 * per buy and sell taken from cash, fractional shares fixed on, post-trade
 * weights booked as executed.
 *
 * Metrics (frozen): per variant × start — final value, max drawdown, Sharpe,
 * average TQQQ weight, and per-state counts of executions where TQQQ SHARES
 * increased / decreased / were unchanged (the #9 buy-up/sell-down wording
 * does not apply to P or unreplaced states and is not used). Attribution:
 * fullGap = 1 − F/P, stateGap = 1 − Si/P, gapShare = stateGap / fullGap;
 * gapShare is interpreted only when fullGap ≥ 3% for that start, otherwise
 * reported as "NA — full-sleeve gap below materiality threshold" (threshold
 * frozen in the spec); gapShare is never truncated — negative means the
 * single replacement offsets the full-sleeve gap, above 100% means it
 * overshoots (state interactions). This is a descriptive single-state
 * marginal attribution, NOT a causal decomposition; shares must not be
 * summed.
 *
 * Frozen data snapshot: all runs must use snapshot-f5c36c72b6dcfa45 (data
 * through 2026-07-17); the test suite asserts the id.
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
  valueOf,
  DEFAULT_THRESHOLDS,
} = require("../api/_lib");
const {
  runActionLoop,
  executeSleeveMonth,
  applyProductionActionLocal,
  metricsOf,
  STARTS,
  ACTUAL_ONLY_STARTS,
  SYNTHETIC_TQQQ_STARTS,
  MONTHLY,
  COST_BPS,
  MAX_TQQQ,
} = require("./tqqq-sleeve-study.cjs");

const PREREG_PATH = "docs/single-state-attribution-prereg.md";
const PREREG_DATE = "2026-07-21";
const FROZEN_SNAPSHOT_ID = "snapshot-f5c36c72b6dcfa45";
const MATERIALITY_FULL_GAP = 0.03; // frozen in the spec, not chosen after inspection
const SHARE_EPS = 1e-9;

const ACTION_ORDER = ["normalDca", "smallDipBuy", "bottomAttack", "rampTqqq", "trimHeat", "pauseAtHigh", "crashDefense"];

const VARIANTS = [
  { key: "P", label: "P production strategy" },
  { key: "F", label: "F full sleeve exact" },
  { key: "S1", label: "S1 normalDca → 10%", replaced: "normalDca" },
  { key: "S2", label: "S2 smallDipBuy → 10%", replaced: "smallDipBuy" },
  { key: "S3", label: "S3 bottomAttack → 25%", replaced: "bottomAttack" },
  { key: "S4", label: "S4 rampTqqq → ramp target", replaced: "rampTqqq" },
  { key: "S5", label: "S5 trimHeat → max(10%, w×11/12)", replaced: "trimHeat" },
  { key: "S6", label: "S6 pauseAtHigh → freeze", replaced: "pauseAtHigh" },
  { key: "S7", label: "S7 crashDefense → w×50%", replaced: "crashDefense" },
];

// Hybrid action: the replaced state gets the #9 sleeve semantics (exact, no
// band); every other state gets the full production action (both legs,
// production cap timing via the replica's verbatim copy of applySignalAction).
function makeAttributionAction(replacedKey) {
  return (portfolio, decision, price, ledger) => {
    if (decision.key === replacedKey) {
      return executeSleeveMonth(portfolio, decision, price, MONTHLY, false, ledger);
    }
    applyProductionActionLocal(portfolio, decision, price, MONTHLY, ledger);
    return null;
  };
}

// Runs one variant loop, additionally logging the TQQQ share delta of every
// execution (increase / decrease / unchanged counts are derived from this).
// The callback wraps the imported runActionLoop without modifying it.
function runCountedVariant(prices, states, start, actionFn) {
  const shareLog = [];
  const run = runActionLoop(prices, states, start, (portfolio, decision, price, ledger) => {
    const before = portfolio.tqqq;
    const info = actionFn(portfolio, decision, price, ledger);
    shareLog.push({ date: price.date, key: decision.key, delta: portfolio.tqqq - before });
    return info;
  });
  return { ...run, shareLog };
}

function shareCounts(shareLog) {
  const byState = Object.fromEntries(ACTION_ORDER.map((key) => [key, { inc: 0, dec: 0, unch: 0 }]));
  for (const entry of shareLog) {
    const bucket = byState[entry.key];
    if (entry.delta > SHARE_EPS) bucket.inc += 1;
    else if (entry.delta < -SHARE_EPS) bucket.dec += 1;
    else bucket.unch += 1;
  }
  return byState;
}

function runStudy() {
  const data = loadSnapshotData();
  const prices = buildPrices(data.nasdaq, data.qqq, data.tqqq, data.rates);
  data.prices = prices;
  const capeChrono = capeSeriesForBacktest(data.capeLatestFirst).reverse();
  const states = buildStates(prices, data.nasdaq, data.vix, capeChrono);
  const snapshotId = buildDataSnapshotId(data);
  const tqqqActualStart = prices.find((point) => point.tqqqSource === "actual")?.date || data.tqqq?.[0]?.date || null;

  const rows = []; // value metrics per start per variant
  const shareRows = []; // per start per variant per state inc/dec/unch
  const variantRuns = []; // all loops with stats, for T+1 and invariant tests
  const replicaRuns = []; // P replica finals for the engine-parity test

  for (const start of STARTS) {
    const engine = runBacktest(data, start, MONTHLY, DEFAULT_THRESHOLDS, states, null, COST_BPS);
    const engineSignal = engine.portfolios.signal;
    const pMetrics = metricsOf(engineSignal, engine.finalPrices, null);

    // P replica: production semantics, instrumented for share counts.
    const pReplica = runCountedVariant(prices, states, start, (portfolio, decision, price, ledger) => {
      applyProductionActionLocal(portfolio, decision, price, MONTHLY, ledger);
      return null;
    });
    replicaRuns.push({ start, finalValue: valueOf(pReplica.portfolio, pReplica.finalPrices), stats: pReplica.stats });

    // F: full sleeve exact, reused from the #9 implementation.
    const fRun = runCountedVariant(prices, states, start, (portfolio, decision, price, ledger) => (
      executeSleeveMonth(portfolio, decision, price, MONTHLY, false, ledger)
    ));

    // S1–S7: single-state replacements.
    const sRuns = VARIANTS.filter((variant) => variant.replaced).map((variant) => ({
      variant,
      run: runCountedVariant(prices, states, start, makeAttributionAction(variant.replaced)),
    }));

    const variantData = [
      { variant: VARIANTS[0], metrics: pMetrics, shareLog: pReplica.shareLog, stats: pReplica.stats },
      { variant: VARIANTS[1], metrics: metricsOf(fRun.portfolio, fRun.finalPrices, null), shareLog: fRun.shareLog, stats: fRun.stats },
      ...sRuns.map(({ variant, run }) => ({
        variant,
        metrics: metricsOf(run.portfolio, run.finalPrices, null),
        shareLog: run.shareLog,
        stats: run.stats,
      })),
    ];

    const synthetic = tqqqActualStart && start < tqqqActualStart ? "sTQQQ" : "—";
    for (const { variant, metrics, shareLog, stats } of variantData) {
      rows.push({ start, plan: variant.key, ...metrics, synthetic });
      shareRows.push({ start, plan: variant.key, counts: shareCounts(shareLog), synthetic });
      variantRuns.push({ start, plan: variant.key, replaced: variant.replaced || null, stats });
    }
  }

  return {
    snapshotId,
    tqqqActualStart,
    latestDate: prices.at(-1).date,
    dates: prices.map((point) => point.date),
    rows,
    shareRows,
    variantRuns,
    replicaRuns,
  };
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
const fmtUsd = (value) => (value == null ? "—" : `$${Math.round(value).toLocaleString("en-US")}`);
const fmtPct = (value, digits = 1) => (value == null ? "—" : `${(value * 100).toFixed(digits)}%`);
const fmtSharpe = (value) => (value == null ? "—" : value.toFixed(2));
const NA_MATERIALITY = "NA — full-sleeve gap below materiality threshold";

function attributionForStart(rows, start) {
  const byPlan = Object.fromEntries(rows.filter((row) => row.start === start).map((row) => [row.plan, row]));
  const p = byPlan.P.finalValue;
  const fullGap = 1 - byPlan.F.finalValue / p;
  const material = fullGap >= MATERIALITY_FULL_GAP;
  const states = VARIANTS.filter((variant) => variant.replaced).map((variant) => {
    const stateGap = 1 - byPlan[variant.key].finalValue / p;
    return {
      key: variant.key,
      stateGap,
      gapShare: material ? stateGap / fullGap : null,
    };
  });
  return { start, fullGap, material, states };
}

function renderReport(study) {
  const { snapshotId, tqqqActualStart, latestDate, rows, shareRows } = study;
  const attributions = STARTS.map((start) => attributionForStart(rows, start));

  const lines = [];
  lines.push("# Single-State Marginal Attribution Study");
  lines.push("");
  lines.push("Generated by `scripts/state-attribution-study.cjs` (regenerate with `node scripts/state-attribution-study.cjs`); test/state-attribution.test.cjs asserts this file matches the generator byte for byte, so the report carries no volatile timestamp.");
  lines.push(`Frozen spec: \`${PREREG_PATH}\` (pre-registered ${PREREG_DATE} Asia/Taipei, commit 134ccbd version, before implementation code or output existed). The rules were frozen before any output was viewed; no spec parameter was changed after seeing results.`);
  lines.push(`Data: versioned snapshots \`${snapshotId}\` (offline, frozen id asserted in tests), last market date ${latestDate}.`);
  lines.push("");
  lines.push("**Implementation deviation declaration: none.** Implementation notes that are not deviations: (a) F and the replaced-state semantics are reused from `scripts/tqqq-sleeve-study.cjs` via a pure-append `module.exports` addition there — the #9 study's own tests stay green and its report is byte-identical; (b) P's value metrics come directly from `runBacktest` `portfolios.signal`; P's per-state TQQQ share counts come from the production-semantics replica parity-asserted against the engine within 1e-9, because the engine does not record per-execution share deltas.");
  lines.push("");
  lines.push("## Frozen design summary");
  lines.push("");
  lines.push("- Variants: P (production), F (full #9 exact sleeve), S1–S7 (P with exactly one state replaced by its #9 target semantics: normalDca 10%, smallDipBuy 10%, bottomAttack 25%, rampTqqq 25% + 15% × k / 6 with k = 7 − `decision.rampMonths`, trimHeat max(10%, w × 11/12), pauseAtHigh freeze, crashDefense w × 50%). No 2pp band in this round.");
  lines.push("- Replaced states: contribution → retained QQQ/cash leg (production semantics) → TQQQ target from post-action NAV via the #9 funding waterfall (cash first, QQQ sales for the shortfall, excess sold to cash) → 40% cap AFTER the rebalance (#9 timing). All other states run full production rules with production cap timing (cap BEFORE the action). T+1, carry-in, 5 bps, fractional shares, booked as executed.");
  lines.push("- This is a descriptive single-state marginal attribution, NOT a causal decomposition: states interact through portfolio paths, so the per-state shares must not be summed and no single main cause is named.");
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push(`- ${STARTS.length} start dates × 5 bps × $${MONTHLY.toLocaleString("en-US")} monthly. Actual-only starts: ${ACTUAL_ONLY_STARTS.join(", ")}. Synthetic-TQQQ starts: ${SYNTHETIC_TQQQ_STARTS.join(", ")} (reported separately). All start windows overlap and are not independent samples.`);
  lines.push("- Share counts: per execution, TQQQ shares increased / decreased / unchanged (1e-9 share epsilon), grouped by the month-start action key; comparable across all variants. The #9 buy-up/sell-down wording is not used for P or unreplaced states.");
  lines.push(`- Attribution: fullGap = 1 − F/P; stateGap = 1 − Si/P; gapShare = stateGap / fullGap. gapShare is interpreted only when fullGap ≥ ${MATERIALITY_FULL_GAP * 100}% for that start (frozen threshold); otherwise reported as \`${NA_MATERIALITY}\`. gapShare is never truncated: negative means the single replacement offsets the full-sleeve gap; above 100% means it overshoots (state interactions).`);
  lines.push("- Metrics: finalValue, maxDrawdown (unit-NAV peak-to-trough), Sharpe (monthly excess over modeled cash rate, annualized by sqrt(12), engine `riskStats`), average TQQQ weight (unweighted mean over month-end points).");
  lines.push("");

  const metricTable = (subset) => {
    const out = [];
    out.push("| Start | Variant | Final value | Max drawdown | Sharpe | Avg TQQQ weight |");
    out.push("| --- | --- | ---: | ---: | ---: | ---: |");
    for (const row of subset) {
      out.push(`| ${row.start} | ${row.plan} | ${fmtUsd(row.finalValue)} | ${fmtPct(row.maxDrawdown)} | ${fmtSharpe(row.sharpe)} | ${fmtPct(row.avgTqqqWeight)} |`);
    }
    return out;
  };
  lines.push("## Results — value metrics, actual-only starts");
  lines.push("");
  lines.push(...metricTable(rows.filter((row) => ACTUAL_ONLY_STARTS.includes(row.start))));
  lines.push("");
  lines.push("## Results — value metrics, synthetic-TQQQ starts (reported separately)");
  lines.push("");
  lines.push(...metricTable(rows.filter((row) => SYNTHETIC_TQQQ_STARTS.includes(row.start))));
  lines.push("");

  // ---- Share-count table (all 11 starts, all variants). ----
  lines.push("## Per-state TQQQ share counts (increased / decreased / unchanged executions)");
  lines.push("");
  lines.push("| Start | Variant | normalDca | smallDipBuy | bottomAttack | rampTqqq | trimHeat | pauseAtHigh | crashDefense |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  const fmtTriple = (bucket) => `${bucket.inc}/${bucket.dec}/${bucket.unch}`;
  for (const row of shareRows) {
    lines.push(`| ${row.start} | ${row.plan} | ${ACTION_ORDER.map((key) => fmtTriple(row.counts[key])).join(" | ")} |`);
  }
  lines.push("");

  // ---- Attribution tables. ----
  const fmtShareCell = (state) => (state.gapShare == null ? NA_MATERIALITY : `${(state.gapShare * 100).toFixed(1)}%`);
  lines.push("## Attribution — gapShare by start (actual-only, detailed)");
  lines.push("");
  lines.push("Cells show `stateGap (gapShare)`. gapShare is interpreted only where fullGap ≥ 3%; negative gapShare means the single replacement offsets the full-sleeve gap, above 100% means it overshoots (state interactions). Shares must not be summed.");
  lines.push("");
  lines.push("| Start | fullGap | S1 | S2 | S3 | S4 | S5 | S6 | S7 |");
  lines.push("| --- | ---: | --- | --- | --- | --- | --- | --- | --- |");
  for (const attribution of attributions.filter((row) => ACTUAL_ONLY_STARTS.includes(row.start))) {
    const cells = attribution.states.map((state) => (state.gapShare == null
      ? NA_MATERIALITY
      : `${(state.stateGap * 100).toFixed(1)}% (${(state.gapShare * 100).toFixed(1)}%)`));
    lines.push(`| ${attribution.start} | ${(attribution.fullGap * 100).toFixed(1)}% | ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push("## Attribution — gapShare by start (synthetic TQQQ, brief; reported separately)");
  lines.push("");
  lines.push("| Start | fullGap | S1 | S2 | S3 | S4 | S5 | S6 | S7 |");
  lines.push("| --- | ---: | --- | --- | --- | --- | --- | --- | --- |");
  for (const attribution of attributions.filter((row) => SYNTHETIC_TQQQ_STARTS.includes(row.start))) {
    lines.push(`| ${attribution.start} | ${(attribution.fullGap * 100).toFixed(1)}% | ${attribution.states.map(fmtShareCell).join(" | ")} |`);
  }
  lines.push("");

  // ---- Per-start rankings (material starts only). ----
  lines.push("## Per-start gapShare ranking (material starts only)");
  lines.push("");
  const materialAttributions = attributions.filter((row) => row.material);
  for (const attribution of materialAttributions) {
    const ranked = [...attribution.states].sort((a, b) => b.gapShare - a.gapShare);
    lines.push(`- ${attribution.start}: ${ranked.map((state) => `${state.key} ${(state.gapShare * 100).toFixed(1)}%`).join(" > ")}`);
  }
  lines.push("");
  lines.push("No single main cause is named: this is a single-state marginal attribution, not a causal decomposition. The per-state shares are descriptive evidence for ranking only and must not be summed — states interact through portfolio paths, and shares can be negative or exceed 100% for that reason.");
  lines.push("");
  lines.push("## Where the evidence points next (facts only)");
  lines.push("");
  const topCounts = Object.fromEntries(VARIANTS.filter((variant) => variant.replaced).map((variant) => [variant.key, 0]));
  for (const attribution of materialAttributions) {
    const top = [...attribution.states].sort((a, b) => b.gapShare - a.gapShare)[0];
    topCounts[top.key] += 1;
  }
  const meanShares = VARIANTS.filter((variant) => variant.replaced).map((variant) => {
    const values = materialAttributions.map((attribution) => attribution.states.find((state) => state.key === variant.key).gapShare);
    return { key: variant.key, mean: values.reduce((sum, value) => sum + value, 0) / values.length };
  });
  const topSorted = Object.entries(topCounts).sort((a, b) => b[1] - a[1]);
  const meanSorted = [...meanShares].sort((a, b) => b.mean - a.mean);
  const actualMaterial = materialAttributions.filter((row) => ACTUAL_ONLY_STARTS.includes(row.start));
  const synthMaterial = materialAttributions.filter((row) => SYNTHETIC_TQQQ_STARTS.includes(row.start));
  const topCountFor = (subset) => {
    const counts = Object.fromEntries(Object.keys(topCounts).map((key) => [key, 0]));
    for (const attribution of subset) {
      const top = [...attribution.states].sort((a, b) => b.gapShare - a.gapShare)[0];
      counts[top.key] += 1;
    }
    return counts;
  };
  const actualTop = topCountFor(actualMaterial);
  const synthTop = topCountFor(synthMaterial);
  lines.push(`- ${materialAttributions.length} of ${STARTS.length} starts are material (fullGap ≥ 3%): ${actualMaterial.length} actual-only (${actualMaterial.map((row) => row.start).join(", ")}) and ${synthMaterial.length} synthetic (${synthMaterial.map((row) => row.start).join(", ")}); ${STARTS.length - materialAttributions.length} starts report ${NA_MATERIALITY}.`);
  lines.push(`- Rank-1 gapShare counts across all ${materialAttributions.length} material starts: ${topSorted.map(([key, count]) => `${key} ${count}`).join(", ")}. Actual-only rank-1 counts: ${Object.entries(actualTop).map(([key, count]) => `${key} ${count}`).join(", ")}; synthetic rank-1 counts: ${Object.entries(synthTop).map(([key, count]) => `${key} ${count}`).join(", ")}.`);
  lines.push(`- Mean gapShare across the ${materialAttributions.length} material starts (descriptive, not additive): ${meanSorted.map((entry) => `${entry.key} ${(entry.mean * 100).toFixed(1)}%`).join(", ")}.`);
  lines.push("- These facts inform — but do not pre-commit to — the two follow-ups registered in the spec: a ratchet / one-way floor sleeve (preserves exposure, admits path dependence), or a fixed-target sleeve with out-of-sample calibration (keeps true path independence). Neither is implemented here.");
  lines.push("");

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "")}\n`;
}

function main() {
  const study = runStudy();
  const report = renderReport(study);
  process.stdout.write(report);
  const docsDir = path.join(__dirname, "..", "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "state-attribution-study.md"), report);
  console.error("wrote docs/state-attribution-study.md");
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
  MAX_TQQQ,
  FROZEN_SNAPSHOT_ID,
  MATERIALITY_FULL_GAP,
  NA_MATERIALITY,
  VARIANTS,
};
