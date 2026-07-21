#!/usr/bin/env node
/**
 * scripts/oneway-floor-study.cjs — one-way floor (S1/S2) vs two-way target
 * study (research).
 *
 * Implements the FROZEN pre-registration in docs/oneway-floor-prereg.md
 * (pre-registered 2026-07-21 Asia/Taipei, b6840d8 revision, before
 * implementation code or output existed). The frozen spec is not modified by
 * this script; the implementation deviation declaration is "none".
 *
 * Variants (frozen):
 *   P        — production strategy, value metrics directly from runBacktest
 *              portfolios.signal; per-state share counts from the
 *              production-semantics replica (parity-asserted), as in #10/#11.
 *   S1-exact / S2-exact — the two-way exact-10% single-state variants from
 *              #11, REUSED via makeAttributionAction imported from
 *              scripts/state-attribution-study.cjs (not reimplemented).
 *   S1-floor / S2-floor — P with exactly one state replaced by the one-way
 *              floor: in replaced-state months, run the retained QQQ/cash
 *              leg first (production semantics), then buy TQQQ up to 10% of
 *              post-leg NAV only when the current weight is below 10% (cash
 *              first, then QQQ sales for the shortfall — the floor logic has
 *              NO sell leg by construction); when at or above 10%, no sleeve
 *              trade. All other states run the full production rules (both
 *              legs). The 40% cap is still enforced after the rebalance for
 *              uniformity with #9, but cap-driven sales are recorded
 *              separately from the floor logic (the test suite asserts the
 *              floor adjustment logic itself never sells TQQQ).
 *
 * Execution conventions (frozen, unchanged from #9/#10/#11): month-start
 * contribution, T+1 execution, carry-in via the shared signal machine, 5 bps
 * friction per buy and sell taken from cash, fractional shares fixed on,
 * post-trade weights booked as executed. Cap timing: production timing
 * (before the action) for P and unreplaced states; after the rebalance for
 * the floor variants' replaced months.
 *
 * Declared asymmetries (from the spec, not hidden): in production, normalDca
 * tops TQQQ up to the floor FIRST and buys QQQ after; in S1-floor the
 * retained QQQ action runs first and the TQQQ top-up is funded after, from
 * remaining cash then QQQ sales — the leg order and the funding source both
 * differ. In smallDip months production never buys TQQQ, so S2-floor
 * introduces a buy leg where production has none.
 *
 * Frozen data snapshot: snapshot-f5c36c72b6dcfa45 (asserted in tests).
 *
 * Decision rule (frozen, applied mechanically in the report): on the three
 * actual-only starts where #11's fullGap >= 3% (2010-02-11, 2015-01-01,
 * 2020-01-01), for S1-floor and S2-floor separately —
 *   floor/exact >= 1.03 and floor/P >= 0.97  => band A (sell leg main
 *     source, loss basically recovered);
 *   floor/exact >= 1.03 and floor/P < 0.97   => band B (sell leg
 *     contributes, cannot fully explain);
 *   floor/exact <= 0.97                      => band C (does not support the
 *     sell-leg explanation);
 *   0.97 < floor/exact < 1.03 (strict)       => band D (insufficient
 *     evidence).
 * Each start is banded independently; a state is assigned a band only if it
 * covers at least 2 of the 3 starts, otherwise the state is "mixed"; a
 * joint conclusion requires both states in the same non-mixed band, else
 * the outcome is "split". floor/P < 0.97 is NOT read as evidence about a
 * 10% ceiling (the floor variants have no exposure ceiling above 10%).
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
  applyProductionActionLocal,
  applyRetainedQqqLeg,
  enforceTqqqCapLocal,
  metricsOf,
  STARTS,
  ACTUAL_ONLY_STARTS,
  SYNTHETIC_TQQQ_STARTS,
  MONTHLY,
  COST_BPS,
  MAX_TQQQ,
} = require("./tqqq-sleeve-study.cjs");
const {
  makeAttributionAction,
  runCountedVariant,
  shareCounts,
  ACTION_ORDER,
  FROZEN_SNAPSHOT_ID,
} = require("./state-attribution-study.cjs");

const PREREG_PATH = "docs/oneway-floor-prereg.md";
const PREREG_DATE = "2026-07-21";
const FLOOR_PCT = 0.10;
const SHARE_EPS = 1e-9;
const INTERPRETABLE_STARTS = ["2010-02-11", "2015-01-01", "2020-01-01"]; // #11 fullGap >= 3% actual-only starts (frozen)
const BAND_HIGH = 1.03;
const BAND_LOW = 0.97;

const BAND_WORDING = {
  A: "the downward-sell leg is the main source of the two-way loss, and removing it basically recovers the loss",
  B: "the sell leg contributes, but cannot fully explain the gap; the residual may come from the buy leg, action ordering, QQQ funding, or path interactions",
  C: "does not support the sell-leg explanation",
  D: "insufficient evidence",
};

const VARIANTS = [
  { key: "P", label: "P production strategy" },
  { key: "S1-exact", label: "S1-exact normalDca → two-way 10%", replaced: "normalDca" },
  { key: "S2-exact", label: "S2-exact smallDipBuy → two-way 10%", replaced: "smallDipBuy" },
  { key: "S1-floor", label: "S1-floor normalDca → one-way 10% floor", replaced: "normalDca" },
  { key: "S2-floor", label: "S2-floor smallDipBuy → one-way 10% floor", replaced: "smallDipBuy" },
];

// One monthly execution of a floor variant's replaced state: retained QQQ
// leg first (production semantics), then the one-way floor buy leg (cash
// first, then QQQ sales for the shortfall; NO TQQQ sell exists in this leg
// by construction), then the 40% cap enforced after the rebalance with its
// sales recorded separately. Returns the share deltas of each sub-step.
function executeFloorMonth(portfolio, decision, prices, monthlyAmount, ledger) {
  applyRetainedQqqLeg(portfolio, decision.key, prices, monthlyAmount, ledger);
  const nav = valueOf(portfolio, prices);
  const weight = nav > 0 ? (portfolio.tqqq * prices.tqqq) / nav : 0;
  const beforeFloor = portfolio.tqqq;
  if (weight < FLOOR_PCT) {
    const tqqqValue = portfolio.tqqq * prices.tqqq;
    const need = FLOOR_PCT * nav - tqqqValue;
    const cashSpend = Math.min(portfolio.cash, need);
    ledger.buyTQQQ(cashSpend, prices.tqqq);
    const remaining = need - cashSpend;
    if (remaining > 1e-12) {
      const qqqValue = portfolio.qqq * prices.qqq;
      const sale = Math.min(qqqValue, remaining);
      if (sale > 0) {
        const feeRate = (portfolio.costBps || 0) / 10000;
        const proceeds = sale * (1 - feeRate);
        ledger.sellQQQ(sale, prices.qqq);
        ledger.buyTQQQ(proceeds, prices.tqqq);
      }
    }
  }
  // The floor leg above contains no TQQQ sell call; floorDelta can only be
  // >= 0. The cap enforcement below is the only possible source of a TQQQ
  // decrease in a replaced month, and it is recorded separately.
  const floorDelta = portfolio.tqqq - beforeFloor;
  const beforeCap = portfolio.tqqq;
  enforceTqqqCapLocal(portfolio, prices, MAX_TQQQ, ledger);
  const capSellDelta = beforeCap - portfolio.tqqq;
  return { floorDelta, capSellDelta, floorSellDelta: 0 };
}

// Runs a floor variant with per-execution cause-tagged share records.
function runFloorVariant(prices, states, start, replacedKey) {
  const records = [];
  const run = runActionLoop(prices, states, start, (portfolio, decision, price, ledger) => {
    const before = portfolio.tqqq;
    if (decision.key === replacedKey) {
      const info = executeFloorMonth(portfolio, decision, price, MONTHLY, ledger);
      records.push({
        date: price.date,
        key: decision.key,
        path: "floor",
        delta: portfolio.tqqq - before,
        floorDelta: info.floorDelta,
        capSellDelta: info.capSellDelta,
        floorSellDelta: info.floorSellDelta,
      });
      return null;
    }
    applyProductionActionLocal(portfolio, decision, price, MONTHLY, ledger);
    records.push({
      date: price.date,
      key: decision.key,
      path: "production",
      delta: portfolio.tqqq - before,
      floorDelta: 0,
      capSellDelta: 0,
      floorSellDelta: 0,
    });
    return null;
  });
  return { ...run, records };
}

// Cause-tagged share counts for floor variants: per state — executions,
// shares increased, shares decreased split into floor logic (frozen: must be
// zero), cap enforcement, and production path (unreplaced months).
function floorCauseCounts(records) {
  const byState = Object.fromEntries(ACTION_ORDER.map((key) => [key, {
    executions: 0, inc: 0, decFloorLogic: 0, decCap: 0, decProduction: 0, unch: 0,
  }]));
  for (const record of records) {
    const bucket = byState[record.key];
    bucket.executions += 1;
    if (record.delta > SHARE_EPS) bucket.inc += 1;
    else if (record.delta < -SHARE_EPS) {
      if (record.path === "floor") {
        if (record.floorDelta < -SHARE_EPS) bucket.decFloorLogic += 1;
        else bucket.decCap += 1;
      } else {
        bucket.decProduction += 1;
      }
    } else {
      bucket.unch += 1;
    }
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

  const rows = [];
  const shareRows = [];
  const floorAuditRows = [];
  const floorRecordsByVariant = []; // for the zero-sell-leg assertions
  const variantRuns = [];
  const replicaRuns = [];

  for (const start of STARTS) {
    const engine = runBacktest(data, start, MONTHLY, DEFAULT_THRESHOLDS, states, null, COST_BPS);
    const pMetrics = metricsOf(engine.portfolios.signal, engine.finalPrices, null);

    const pReplica = runCountedVariant(prices, states, start, (portfolio, decision, price, ledger) => {
      applyProductionActionLocal(portfolio, decision, price, MONTHLY, ledger);
      return null;
    });
    replicaRuns.push({ start, finalValue: valueOf(pReplica.portfolio, pReplica.finalPrices), stats: pReplica.stats });

    const s1e = runCountedVariant(prices, states, start, makeAttributionAction("normalDca"));
    const s2e = runCountedVariant(prices, states, start, makeAttributionAction("smallDipBuy"));
    const s1f = runFloorVariant(prices, states, start, "normalDca");
    const s2f = runFloorVariant(prices, states, start, "smallDipBuy");

    const variantData = [
      { variant: VARIANTS[0], metrics: pMetrics, counts: shareCounts(pReplica.shareLog), stats: pReplica.stats, replaced: null },
      { variant: VARIANTS[1], metrics: metricsOf(s1e.portfolio, s1e.finalPrices, null), counts: shareCounts(s1e.shareLog), stats: s1e.stats, replaced: "normalDca" },
      { variant: VARIANTS[2], metrics: metricsOf(s2e.portfolio, s2e.finalPrices, null), counts: shareCounts(s2e.shareLog), stats: s2e.stats, replaced: "smallDipBuy" },
      { variant: VARIANTS[3], metrics: metricsOf(s1f.portfolio, s1f.finalPrices, null), counts: shareCounts(s1f.records), stats: s1f.stats, replaced: "normalDca" },
      { variant: VARIANTS[4], metrics: metricsOf(s2f.portfolio, s2f.finalPrices, null), counts: shareCounts(s2f.records), stats: s2f.stats, replaced: "smallDipBuy" },
    ];

    const synthetic = tqqqActualStart && start < tqqqActualStart ? "sTQQQ" : "—";
    for (const { variant, metrics, counts, stats, replaced } of variantData) {
      rows.push({ start, plan: variant.key, ...metrics, synthetic });
      shareRows.push({ start, plan: variant.key, counts, synthetic });
      variantRuns.push({ start, plan: variant.key, replaced, stats });
    }

    for (const [variantKey, floorRun] of [["S1-floor", s1f], ["S2-floor", s2f]]) {
      const floorMonths = floorRun.records.filter((record) => record.path === "floor");
      floorAuditRows.push({
        start,
        plan: variantKey,
        synthetic,
        floorMonths: floorMonths.length,
        topUpMonths: floorMonths.filter((record) => record.floorDelta > SHARE_EPS).length,
        floorLogicSells: floorMonths.filter((record) => record.floorDelta < -SHARE_EPS).length,
        capSaleMonths: floorMonths.filter((record) => record.capSellDelta > SHARE_EPS).length,
        capSharesSold: floorMonths.reduce((sum, record) => sum + record.capSellDelta, 0),
        causeCounts: floorCauseCounts(floorRun.records),
      });
      floorRecordsByVariant.push({ start, plan: variantKey, records: floorRun.records });
    }
  }

  return {
    snapshotId,
    tqqqActualStart,
    latestDate: prices.at(-1).date,
    dates: prices.map((point) => point.date),
    rows,
    shareRows,
    floorAuditRows,
    floorRecordsByVariant,
    variantRuns,
    replicaRuns,
    // Frozen decision bands, exposed for the conclusion-pinning test.
    decision: computeDecision(rows),
  };
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
const fmtUsd = (value) => (value == null ? "—" : `$${Math.round(value).toLocaleString("en-US")}`);
const fmtPct = (value, digits = 1) => (value == null ? "—" : `${(value * 100).toFixed(digits)}%`);
const fmtSharpe = (value) => (value == null ? "—" : value.toFixed(2));
const fmtRatio = (value) => (value == null ? "—" : value.toFixed(3));

function bandFor(floorExact, floorP) {
  if (floorExact >= BAND_HIGH && floorP >= BAND_LOW) return "A";
  if (floorExact >= BAND_HIGH && floorP < BAND_LOW) return "B";
  if (floorExact <= BAND_LOW) return "C";
  return "D"; // 0.97 < floor/exact < 1.03 (strict)
}

// Frozen decision computation, shared by runStudy (exposed for the
// conclusion-pinning test) and renderReport. Pure function of the rows;
// moving it here changes no numbers and no report bytes.
function computeDecision(rows) {
  const byStartPlan = Object.fromEntries(rows.map((row) => [`${row.start}|${row.plan}`, row]));
  const ratioRows = INTERPRETABLE_STARTS.map((start) => {
    const p = byStartPlan[`${start}|P`].finalValue;
    const entry = { start };
    for (const [state, exactKey, floorKey] of [["S1", "S1-exact", "S1-floor"], ["S2", "S2-exact", "S2-floor"]]) {
      const floorExact = byStartPlan[`${start}|${floorKey}`].finalValue / byStartPlan[`${start}|${exactKey}`].finalValue;
      const floorP = byStartPlan[`${start}|${floorKey}`].finalValue / p;
      entry[state] = { floorExact, floorP, band: bandFor(floorExact, floorP) };
    }
    return entry;
  });
  const aggregateBand = (state) => {
    const counts = {};
    for (const row of ratioRows) counts[row[state].band] = (counts[row[state].band] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= 2 ? top[0] : "mixed";
  };
  const s1Band = aggregateBand("S1");
  const s2Band = aggregateBand("S2");
  const jointBand = s1Band === s2Band && s1Band !== "mixed" ? s1Band : null;
  const joint = jointBand
    ? `Joint conclusion (both S1-floor and S2-floor land in band ${s1Band} in ≥ 2 of 3 starts): ${BAND_WORDING[s1Band]}.`
    : `Outcome: split — S1-floor band ${s1Band}, S2-floor band ${s2Band}; no joint conclusion per the frozen rule.`;
  return { ratioRows, s1Band, s2Band, jointBand, joint };
}

function renderReport(study) {
  const { snapshotId, tqqqActualStart, latestDate, rows, shareRows, floorAuditRows } = study;

  const lines = [];
  lines.push("# One-Way Floor (S1/S2) vs Two-Way Target Study");
  lines.push("");
  lines.push("Generated by `scripts/oneway-floor-study.cjs` (regenerate with `node scripts/oneway-floor-study.cjs`); test/oneway-floor.test.cjs asserts this file matches the generator byte for byte, so the report carries no volatile timestamp.");
  lines.push(`Frozen spec: \`${PREREG_PATH}\` (pre-registered ${PREREG_DATE} Asia/Taipei, b6840d8 revision, before implementation code or output existed). The rules were frozen before any output was viewed; no spec parameter was changed after seeing results.`);
  lines.push(`Data: versioned snapshots \`${snapshotId}\` (offline, frozen id asserted in tests), last market date ${latestDate}.`);
  lines.push("");
  lines.push("**Implementation deviation declaration: none.** Implementation notes that are not deviations: (a) S1-exact/S2-exact are reused from `scripts/state-attribution-study.cjs` (`makeAttributionAction`), and the sleeve machinery from `scripts/tqqq-sleeve-study.cjs`, both via pure-append exports — both studies' own tests stay green and their reports byte-identical; (b) P's value metrics come directly from `runBacktest` `portfolios.signal`; P's share counts come from the production-semantics replica (parity-asserted against the engine within 1e-9 here, and trajectory-pinned in the #11 test suite).");
  lines.push("");
  lines.push("**Declared asymmetries (from the frozen spec, not hidden):** in production, normalDca tops TQQQ up to the floor FIRST and buys QQQ after; in S1-floor the retained QQQ action runs first and the TQQQ top-up is funded after, from remaining cash then QQQ sales — leg order and funding source both differ. In smallDip months production never buys TQQQ, so S2-floor introduces a buy leg where production has none.");
  lines.push("");
  lines.push("## Frozen design summary");
  lines.push("");
  lines.push("- Research question: does the frozen two-way sleeve's shortfall come from the downward-sell leg? Variants: P, S1-exact/S2-exact (two-way exact-10% from #11), S1-floor/S2-floor (one-way floor: buy TQQQ up to 10% only when the current weight is below 10%, otherwise no sleeve trade; no sell leg by construction). All other states run full production rules.");
  lines.push("- Execution: month-start contribution → retained QQQ/cash leg (production semantics) → sleeve adjustment (buy leg only: cash first, then QQQ sales for the shortfall) → 40% cap enforced after the rebalance, with cap-driven sales recorded separately from the floor logic. T+1, 5 bps, fractional shares, booked as executed. Cap timing for P and unreplaced states: production timing (before the action).");
  lines.push("- Decision rule (frozen): banded on the three actual-only starts where #11's fullGap ≥ 3% (2010-02-11, 2015-01-01, 2020-01-01); per state, a band must cover ≥ 2 of 3 starts else the state is `mixed`; a joint conclusion requires both states in the same non-mixed band, else the outcome is `split`. floor/P < 0.97 is NOT read as evidence about a 10% ceiling (the floor variants have no exposure ceiling above 10%).");
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push(`- ${STARTS.length} start dates × 5 bps × $${MONTHLY.toLocaleString("en-US")} monthly. Actual-only starts: ${ACTUAL_ONLY_STARTS.join(", ")}. Synthetic-TQQQ starts: ${SYNTHETIC_TQQQ_STARTS.join(", ")} (reported separately). All start windows overlap and are not independent samples.`);
  lines.push("- Share counts: per execution, TQQQ shares increased / decreased / unchanged (1e-9 share epsilon) by month-start action key. For the floor variants, decreases are split by cause — floor logic (frozen: must be zero), cap enforcement (post-rebalance), production path (unreplaced months) — in the floor sell-leg audit table.");
  lines.push("- Metrics: finalValue, maxDrawdown (unit-NAV peak-to-trough), Sharpe (monthly excess over modeled cash rate, annualized by sqrt(12), engine `riskStats`), average TQQQ weight (unweighted mean over month-end points). Ratios: floor/exact and floor/P on final value.");
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

  lines.push("## Per-state TQQQ share counts (increased / decreased / unchanged executions)");
  lines.push("");
  lines.push("| Start | Variant | normalDca | smallDipBuy | bottomAttack | rampTqqq | trimHeat | pauseAtHigh | crashDefense |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  const fmtTriple = (bucket) => `${bucket.inc}/${bucket.dec}/${bucket.unch}`;
  for (const row of shareRows) {
    lines.push(`| ${row.start} | ${row.plan} | ${ACTION_ORDER.map((key) => fmtTriple(row.counts[key])).join(" | ")} |`);
  }
  lines.push("");

  lines.push("## Floor sell-leg audit (cause split for the floor variants)");
  lines.push("");
  lines.push("The floor adjustment logic itself contains no TQQQ sell call; any decrease in a replaced month is cap enforcement after the rebalance and is recorded separately. The test suite asserts the floor logic's share delta is never negative.");
  lines.push("");
  lines.push("| Start | Variant | Replaced-state months | Floor top-up months | Floor-logic TQQQ sells | Cap-enforcement sale months | TQQQ shares sold by cap |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: |");
  for (const row of floorAuditRows) {
    lines.push(`| ${row.start} | ${row.plan} | ${row.floorMonths} | ${row.topUpMonths} | ${row.floorLogicSells} | ${row.capSaleMonths} | ${row.capSharesSold.toFixed(4)} |`);
  }
  lines.push("");

  // ---- Ratios and frozen decision bands. ----
  const { ratioRows, s1Band, s2Band, joint } = computeDecision(rows);

  lines.push("## Ratios and frozen decision bands (three interpretable actual-only starts)");
  lines.push("");
  lines.push("| Start | S1 floor/exact | S1 floor/P | S1 band | S2 floor/exact | S2 floor/P | S2 band |");
  lines.push("| --- | ---: | ---: | --- | ---: | ---: | --- |");
  for (const row of ratioRows) {
    lines.push(`| ${row.start} | ${fmtRatio(row.S1.floorExact)} | ${fmtRatio(row.S1.floorP)} | ${row.S1.band} | ${fmtRatio(row.S2.floorExact)} | ${fmtRatio(row.S2.floorP)} | ${row.S2.band} |`);
  }
  lines.push("");
  lines.push("Band wording (frozen): **A** — the downward-sell leg is the main source of the two-way loss, and removing it basically recovers the loss; **B** — the sell leg contributes, but cannot fully explain the gap; **C** — does not support the sell-leg explanation; **D** — insufficient evidence (0.97 < floor/exact < 1.03 strict).");
  lines.push("");
  lines.push(`- State aggregation (frozen, ≥ 2 of 3 starts required): S1-floor → **${s1Band}** (per-start bands: ${ratioRows.map((row) => `${row.start} ${row.S1.band}`).join(", ")}); S2-floor → **${s2Band}** (per-start bands: ${ratioRows.map((row) => `${row.start} ${row.S2.band}`).join(", ")}).`);
  lines.push(`- ${joint}`);
  lines.push("- Note (frozen): the floor variants have no exposure ceiling above 10%, so `floor / P < 0.97` is not read as evidence about a 10% ceiling — it is read per band B above.");
  lines.push("");
  lines.push("## Preliminary readings (facts only, no recommendation)");
  lines.push("");
  for (const row of ratioRows) {
    const audit1 = floorAuditRows.find((item) => item.start === row.start && item.plan === "S1-floor");
    const audit2 = floorAuditRows.find((item) => item.start === row.start && item.plan === "S2-floor");
    lines.push(`- ${row.start}: S1 floor/exact ${fmtRatio(row.S1.floorExact)}, floor/P ${fmtRatio(row.S1.floorP)} (band ${row.S1.band}); S2 floor/exact ${fmtRatio(row.S2.floorExact)}, floor/P ${fmtRatio(row.S2.floorP)} (band ${row.S2.band}). Floor variants' replaced months: S1 ${audit1.floorMonths} (${audit1.topUpMonths} top-ups), S2 ${audit2.floorMonths} (${audit2.topUpMonths} top-ups); floor-logic TQQQ sells 0 in both; cap-enforcement sale months S1 ${audit1.capSaleMonths}, S2 ${audit2.capSaleMonths}.`);
  }
  const allActual = rows.filter((row) => ACTUAL_ONLY_STARTS.includes(row.start));
  const byStartPlan = Object.fromEntries(rows.map((row) => [`${row.start}|${row.plan}`, row]));
  for (const variant of VARIANTS) {
    const subset = allActual.filter((row) => row.plan === variant.key);
    const ratios = subset.map((row) => `${row.start} ${fmtRatio(row.finalValue / byStartPlan[`${row.start}|P`].finalValue)}`);
    if (variant.key !== "P") lines.push(`- ${variant.key} final-value ratios vs P (actual-only): ${ratios.join(", ")}.`);
  }
  lines.push("");

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "")}\n`;
}

function main() {
  const study = runStudy();
  const report = renderReport(study);
  process.stdout.write(report);
  const docsDir = path.join(__dirname, "..", "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "oneway-floor-study.md"), report);
  console.error("wrote docs/oneway-floor-study.md");
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
  FLOOR_PCT,
  INTERPRETABLE_STARTS,
  FROZEN_SNAPSHOT_ID,
  BAND_WORDING,
  bandFor,
  computeDecision,
  VARIANTS,
};
