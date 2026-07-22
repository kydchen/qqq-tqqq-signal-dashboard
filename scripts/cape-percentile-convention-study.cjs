#!/usr/bin/env node
/**
 * scripts/cape-percentile-convention-study.cjs — CAPE percentile convention
 * sensitivity study (research).
 *
 * Implements the FROZEN pre-registration in
 * docs/cape-percentile-convention-prereg.md (pre-registered 2026-07-22
 * Asia/Taipei, merged via PR #15 before implementation code or output
 * existed). The frozen spec is not modified by this script; the
 * implementation deviation declaration is "none".
 *
 * Conventions (frozen, exactly two):
 *   P-current — production control: for CAPE observation t, rank x_t against
 *         {x_(t-359), ..., x_t} with the <= tie rule,
 *         100 * count(x <= x_t) / 360. This is api/_lib.js capePercentileAt,
 *         used here through the default buildStates call.
 *   E-prior   — experimental: rank x_t against the 360 observations
 *         immediately before it, {x_(t-360), ..., x_(t-1)}, same <= tie rule,
 *         100 * count(x <= x_t) / 360. Implemented by capePercentilePriorAt
 *         below and injected through the optional buildStates cape-percentile
 *         callback (the only _lib.js seam this study needs; the default
 *         production call is behaviorally and byte-for-byte unchanged, which
 *         the test suite asserts).
 *
 * Frozen semantics kept identical across both conventions: the one-month
 * CAPE availability delay (capeSeriesForBacktest), thresholds
 * cheapCape=35 / supportCape=50 / highCape=70 / bubbleCape=85, all non-CAPE
 * signals, the shared monthly state machine with intra-month upgrades, T+1
 * execution and carry-in, the risk policy, trading costs, and portfolio
 * accounting. The daily audit replays the shared signal machine
 * (createSignalMachine / signalMachineClose / signalMachineDue) exactly as
 * runBacktest drives it; it does not compare raw calculateDecision rows.
 *
 * Coverage (frozen): the 11 supported starts x 3 costs (0/5/10 bps). The six
 * actual-TQQQ starts and the five synthetic-containing starts are reported
 * separately. All start windows overlap and are not independent samples.
 *
 * Frozen data snapshot: all runs use snapshot-f5c36c72b6dcfa45 (data through
 * 2026-07-17); the test suite asserts the id.
 *
 * Interpretation is applied mechanically per the frozen spec: any
 * decision/action difference is sensitivity evidence only — no winner is
 * selected on return, and no valuation-accuracy claim is made
 * (capePointInTime: false; this study cannot fix or validate
 * vintage/revision bias).
 */

const fs = require("fs");
const path = require("path");
const {
  loadSnapshotData,
  buildPrices,
  buildStates,
  buildDataSnapshotId,
  capeSeriesForBacktest,
  capePercentileAt,
  createSignalMachine,
  signalMachineClose,
  signalMachineDue,
  signalGroups,
  runBacktest,
  valueOf,
  DEFAULT_THRESHOLDS,
} = require("../api/_lib");

const PREREG_PATH = "docs/cape-percentile-convention-prereg.md";
const PREREG_DATE = "2026-07-22";
const FROZEN_SNAPSHOT_ID = "snapshot-f5c36c72b6dcfa45";
const WINDOW = 360; // must equal CAPE_ROLLING_MONTHS in api/_lib.js
const MONTHLY = 1000;
const COSTS = [0, 5, 10];
const STARTS = [
  "1990-01-01", "1995-01-01", "2000-01-01", "2005-01-01", "2010-01-01",
  "2010-02-11", "2015-01-01", "2020-01-01", "2023-01-01", "2024-01-01",
  "2025-01-01",
];
const TQQQ_ACTUAL_START = "2010-02-11";
const ACTUAL_ONLY_STARTS = STARTS.filter((start) => start >= TQQQ_ACTUAL_START);
const SYNTHETIC_TQQQ_STARTS = STARTS.filter((start) => start < TQQQ_ACTUAL_START);
// Frozen threshold set, in the spec's order: cheapCape, supportCape,
// highCape, bubbleCape. Classifications use the production `<` / `>=` rules.
const CAPE_THRESHOLDS = [
  DEFAULT_THRESHOLDS.cheapCape,
  DEFAULT_THRESHOLDS.supportCape,
  DEFAULT_THRESHOLDS.highCape,
  DEFAULT_THRESHOLDS.bubbleCape,
];
const DELTA_BOUND = 100 / WINDOW; // frozen bound: windows differ by one observation
const FLOAT_TOL = 1e-9;
const ACTION_KEYS = ["bottomAttack", "rampTqqq", "smallDipBuy", "crashDefense", "trimHeat", "pauseAtHigh", "normalDca"];
const MATERIALITY_FINAL = 0.01; // frozen: absolute final-value change >= 1%
const MATERIALITY_DD_PP = 1; // frozen: max-drawdown change >= 1 percentage point

// E-prior (frozen experimental convention): x_t ranked against the WINDOW
// observations immediately before it, same <= tie rule as the production
// percentile() in api/_lib.js. For every app-supported state the prior window
// is full (coverage audit below), so the denominator is exactly WINDOW.
function capePercentilePriorAt(capeChrono, index) {
  const current = capeChrono[Math.max(0, index)];
  const prior = capeChrono.slice(Math.max(0, index - WINDOW), index);
  return 100 * prior.filter((point) => point.value <= current.value).length / prior.length;
}

// Walk the evaluated market days (state index >= 30, date >= the earliest
// supported start) with the same forward CAPE cursor buildStates and
// runBacktest use, recording which CAPE series index feeds each evaluated
// day and the first market date that uses it.
function evaluatedCapeUsage(prices, capeChrono) {
  let capeIndex = 0;
  const firstUsed = new Map(); // capeIndex -> first evaluated market date using it
  let minIndex = Infinity;
  for (let i = 30; i < prices.length; i += 1) {
    const date = prices[i].date;
    while (capeIndex + 1 < capeChrono.length && capeChrono[capeIndex + 1].date <= date) capeIndex += 1;
    if (date < STARTS[0]) continue;
    if (!firstUsed.has(capeIndex)) firstUsed.set(capeIndex, date);
    if (capeIndex < minIndex) minIndex = capeIndex;
  }
  return { firstUsed, minIndex };
}

// Replay the shared monthly signal machine day by day exactly as runBacktest
// drives it (due order from the previous close executes first — including
// carry-in from last month — then the close locks or upgrades the month's
// action). Records, per day, the executed action key and the month's frozen
// decision key after the close.
function replayTrajectory(prices, states, startDate) {
  const machine = createSignalMachine(DEFAULT_THRESHOLDS);
  const days = [];
  for (let i = 30; i < prices.length; i += 1) {
    const price = prices[i];
    if (price.date < startDate) continue;
    const month = price.date.slice(0, 7);
    const due = signalMachineDue(machine, price.date);
    signalMachineClose(machine, states[i], price.date);
    days.push({
      index: i,
      date: price.date,
      executedKey: due ? due.decision.key : null,
      executedCarryIn: due ? due.month !== month : false,
      monthAction: machine.monthAction,
      capePercentile: states[i].capePercentile,
    });
  }
  return days;
}

function diffTrajectories(start, daysP, daysE, statesP, statesE) {
  const divergences = [];
  for (let k = 0; k < daysP.length; k += 1) {
    const dp = daysP[k];
    const de = daysE[k];
    const actionDiff = dp.executedKey !== de.executedKey;
    const keyDiff = dp.monthAction !== de.monthAction;
    if (!actionDiff && !keyDiff) continue;
    const groupsP = signalGroups(statesP[dp.index], DEFAULT_THRESHOLDS);
    const groupsE = signalGroups(statesE[de.index], DEFAULT_THRESHOLDS);
    const bitDiffs = [];
    for (const groupName of ["lowSignals", "softSignals", "defensiveFlags"]) {
      for (const bit of Object.keys(groupsP[groupName])) {
        if (groupsP[groupName][bit] !== groupsE[groupName][bit]) {
          bitDiffs.push(`${bit} ${groupsP[groupName][bit]}→${groupsE[groupName][bit]}`);
        }
      }
    }
    divergences.push({
      start,
      date: dp.date,
      kind: actionDiff && keyDiff ? "action+key" : actionDiff ? "action" : "key",
      pExecuted: dp.executedKey,
      eExecuted: de.executedKey,
      pKey: dp.monthAction,
      eKey: de.monthAction,
      capeP: dp.capePercentile,
      capeE: de.capePercentile,
      thresholdBits: CAPE_THRESHOLDS.filter((t) => (dp.capePercentile < t) !== (de.capePercentile < t)),
      bitDiffs,
    });
  }
  return divergences;
}

function actionCountChanges(pCounts, eCounts) {
  return ACTION_KEYS
    .filter((key) => (pCounts[key] || 0) !== (eCounts[key] || 0))
    .map((key) => ({ key, p: pCounts[key] || 0, e: eCounts[key] || 0 }));
}

function runStudy() {
  const data = loadSnapshotData();
  const snapshotId = buildDataSnapshotId(data);
  const prices = buildPrices(data.nasdaq, data.qqq, data.tqqq, data.rates);
  data.prices = prices;
  const capeChrono = capeSeriesForBacktest(data.capeLatestFirst).reverse();
  const statesP = buildStates(prices, data.nasdaq, data.vix, capeChrono);
  const statesE = buildStates(prices, data.nasdaq, data.vix, capeChrono, capePercentilePriorAt);

  // ---- 1. Coverage audit. ----
  const capeRaw = [...data.capeLatestFirst].reverse(); // chronological, undelayed
  const usage = evaluatedCapeUsage(prices, capeChrono);
  const coverage = {
    capeCount: capeRaw.length,
    capeOldest: capeRaw[0]?.date || null,
    capeNewest: capeRaw.at(-1)?.date || null,
    earliestFullPriorWindow: capeChrono[WINDOW]?.date || null, // first delayed month with 360 priors
    earliestPriceDate: prices[0]?.date || null,
    latestDate: prices.at(-1)?.date || null,
    earliestStart: STARTS[0],
    minEvaluatedCapeIndex: usage.minIndex,
    fullHistory: usage.minIndex >= WINDOW,
  };

  // ---- 2. Percentile audit over every CAPE observation used by evaluated
  // market dates. ----
  const entries = [...usage.firstUsed.entries()]
    .map(([index, firstUsedDate]) => {
      const p = capePercentileAt(capeChrono, index);
      const e = capePercentilePriorAt(capeChrono, index);
      return {
        index,
        date: capeChrono[index].date,
        firstUsedDate,
        value: capeChrono[index].value,
        p,
        e,
        absDelta: Math.abs(e - p),
      };
    })
    .sort((a, b) => a.index - b.index);
  const sortedAbs = entries.map((entry) => entry.absDelta).sort((a, b) => a - b);
  const n = sortedAbs.length;
  const median = n % 2 === 1 ? sortedAbs[(n - 1) / 2] : (sortedAbs[n / 2 - 1] + sortedAbs[n / 2]) / 2;
  const percentileAudit = {
    monthsEvaluated: n,
    maxAbsDelta: sortedAbs[n - 1],
    medianAbsDelta: median,
    p95AbsDelta: sortedAbs[Math.ceil(0.95 * n) - 1],
    boundHolds: sortedAbs[n - 1] <= DELTA_BOUND + FLOAT_TOL,
    crossings: Object.fromEntries(CAPE_THRESHOLDS.map((threshold) => [
      threshold,
      entries.filter((entry) => (entry.p < threshold) !== (entry.e < threshold)),
    ])),
  };

  // ---- 3. Daily state/action audit: full state-machine trajectory per
  // start, P vs E. ----
  const divergences = [];
  for (const start of STARTS) {
    const daysP = replayTrajectory(prices, statesP, start);
    const daysE = replayTrajectory(prices, statesE, start);
    divergences.push(...diffTrajectories(start, daysP, daysE, statesP, statesE));
  }

  // ---- 4. Backtest audit: 11 starts x 3 costs, shared engine both sides. ----
  const backtestRows = [];
  for (const start of STARTS) {
    const startDivergences = divergences.filter((item) => item.start === start);
    for (const cost of COSTS) {
      const btP = runBacktest(data, start, MONTHLY, DEFAULT_THRESHOLDS, statesP, null, cost);
      const btE = runBacktest(data, start, MONTHLY, DEFAULT_THRESHOLDS, statesE, null, cost);
      const pFinal = valueOf(btP.portfolios.signal, btP.finalPrices);
      const eFinal = valueOf(btE.portfolios.signal, btE.finalPrices);
      const pMaxDD = btP.portfolios.signal.maxDrawdown;
      const eMaxDD = btE.portfolios.signal.maxDrawdown;
      const changes = actionCountChanges(btP.actionCounts, btE.actionCounts);
      backtestRows.push({
        start,
        cost,
        pFinal,
        eFinal,
        ratio: eFinal / pFinal,
        finalChange: eFinal / pFinal - 1,
        pMaxDD,
        eMaxDD,
        ddDeltaPp: (eMaxDD - pMaxDD) * 100,
        actionChanges: changes,
        divergenceDates: cost === COSTS[0] ? startDivergences : undefined, // cost-independent; attach once
        flagFinal: Math.abs(eFinal / pFinal - 1) >= MATERIALITY_FINAL,
        flagDD: Math.abs((eMaxDD - pMaxDD) * 100) >= MATERIALITY_DD_PP,
        flagAction: changes.length > 0,
      });
    }
  }

  return {
    snapshotId,
    coverage,
    percentileAudit,
    divergences,
    backtestRows,
  };
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
const fmtUsd = (value) => `$${Math.round(value).toLocaleString("en-US")}`;
const fmtPctile = (value) => value.toFixed(4);
const fmtPp = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
const fmtSignedPct = (value) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
const fmtDD = (value) => `${(value * 100).toFixed(2)}%`;

function renderReport(study) {
  const { snapshotId, coverage, percentileAudit, divergences, backtestRows } = study;
  const totalCrossings = CAPE_THRESHOLDS.reduce((sum, t) => sum + percentileAudit.crossings[t].length, 0);
  const actionDivergences = divergences.filter((item) => item.kind !== "key");
  const flaggedRows = backtestRows.filter((row) => row.flagFinal || row.flagDD || row.flagAction);

  const lines = [];
  lines.push("# CAPE Percentile Convention Sensitivity Study");
  lines.push("");
  lines.push("Generated by `scripts/cape-percentile-convention-study.cjs` (regenerate with `node scripts/cape-percentile-convention-study.cjs`); test/cape-percentile-convention-study.test.cjs asserts this file matches the generator byte for byte, so the report carries no volatile timestamp.");
  lines.push(`Frozen spec: \`${PREREG_PATH}\` (pre-registered ${PREREG_DATE} Asia/Taipei, merged via PR #15 before implementation code or output existed). The rules were frozen before any output was viewed; no spec parameter was changed after seeing results.`);
  lines.push(`Data: versioned snapshots \`${snapshotId}\` (offline, frozen id asserted in tests), last market date ${coverage.latestDate}.`);
  lines.push("");
  lines.push("**Implementation deviation declaration: none.** Implementation notes that are not deviations: (a) the only `api/_lib.js` change is an optional CAPE-percentile callback parameter on `buildStates` defaulting to the production `capePercentileAt`, plus a purely additive export of `capePercentileAt`; the default production call is behaviorally and byte-for-byte unchanged, which the test suite asserts; (b) the E-prior helper lives in this research script, not in production code; (c) the daily audit replays the shared monthly signal machine with intra-month upgrades and T+1/carry-in semantics exactly as `runBacktest` drives it — it does not compare raw `calculateDecision` rows.");
  lines.push("");
  lines.push("## Frozen design summary");
  lines.push("");
  lines.push("- P-current (production control): CAPE observation `x_t` ranked against `{x_(t-359), ..., x_t}`, `100 * count(x <= x_t) / 360` — exactly `capePercentileAt` in `api/_lib.js`.");
  lines.push("- E-prior (experimental): `x_t` ranked against the 360 immediately preceding observations `{x_(t-360), ..., x_(t-1)}`, same `<=` tie rule, `100 * count(x <= x_t) / 360`. The windows differ by exactly one observation, so `|E − P| <= 100/360 ≈ 0.2778` percentage points wherever both windows are full.");
  lines.push(`- Everything else unchanged: one-month CAPE availability delay, thresholds ${CAPE_THRESHOLDS.join("/")} (cheapCape/supportCape/highCape/bubbleCape), all non-CAPE signals, the shared monthly state machine with intra-month upgrades, T+1 execution and carry-in, risk policy, costs, and portfolio accounting.`);
  lines.push(`- ${STARTS.length} supported starts × ${COSTS.length} costs (${COSTS.join("/")} bps) × $${MONTHLY.toLocaleString("en-US")} monthly. Actual-TQQQ starts: ${ACTUAL_ONLY_STARTS.join(", ")}. Synthetic-containing starts: ${SYNTHETIC_TQQQ_STARTS.join(", ")} (reported separately). All start windows overlap and are not independent samples.`);
  lines.push("");

  // ---- 1. Coverage audit. ----
  lines.push("## 1. Coverage audit");
  lines.push("");
  lines.push(`- CAPE snapshot: ${coverage.capeCount.toLocaleString("en-US")} monthly observations, oldest ${coverage.capeOldest}, newest ${coverage.capeNewest}.`);
  lines.push(`- Earliest delayed CAPE month with a full prior ${WINDOW}-observation window: ${coverage.earliestFullPriorWindow} (the one-month availability delay is preserved for both conventions).`);
  lines.push(`- Earliest price/backtest date: ${coverage.earliestPriceDate}; earliest evaluated start: ${coverage.earliestStart}; last market date: ${coverage.latestDate}.`);
  lines.push(`- Minimum CAPE series index feeding any evaluated app state: ${coverage.minEvaluatedCapeIndex} (>= ${WINDOW} required for a full prior window on both conventions). **Assertion: every evaluated app state has a full ${WINDOW}-observation prior window — ${coverage.fullHistory ? "PASSED" : "FAILED"}.** The previously suspected pre-2015 insufficient 30-year-window issue is not present in this data; the audit is closed as specified.`);
  lines.push("");

  // ---- 2. Percentile audit. ----
  lines.push("## 2. Percentile audit");
  lines.push("");
  lines.push(`Scope: ${percentileAudit.monthsEvaluated.toLocaleString("en-US")} CAPE months used by evaluated app-supported market dates (${coverage.earliestStart} through ${coverage.latestDate}).`);
  lines.push("");
  lines.push(`- Maximum |E − P|: ${fmtPctile(percentileAudit.maxAbsDelta)} pp`);
  lines.push(`- Median |E − P|: ${fmtPctile(percentileAudit.medianAbsDelta)} pp`);
  lines.push(`- 95th-percentile |E − P|: ${fmtPctile(percentileAudit.p95AbsDelta)} pp`);
  lines.push(`- Frozen bound 100/360 = ${DELTA_BOUND.toFixed(4)} pp (+ ${FLOAT_TOL} floating tolerance): ${percentileAudit.boundHolds ? "holds for every evaluated month" : "VIOLATED"}.`);
  lines.push("");
  lines.push("Classification crossings use the production comparison rules (cheap/support: `percentile < threshold`; high/bubble: `percentile >= threshold` — both reduce to the `< threshold` bit flipping).");
  lines.push("");
  lines.push("| Threshold | Crossings |");
  lines.push("| --- | ---: |");
  for (const threshold of CAPE_THRESHOLDS) {
    lines.push(`| ${threshold} | ${percentileAudit.crossings[threshold].length} |`);
  }
  lines.push("");
  if (totalCrossings === 0) {
    lines.push(`Zero classification crossings at all four thresholds (${CAPE_THRESHOLDS.join("/")}). The crossing table is empty by result, not by omission.`);
  } else {
    lines.push("| CAPE month | CAPE value | P-current | E-prior | Threshold crossed | P side | E side |");
    lines.push("| --- | ---: | ---: | ---: | ---: | --- | --- |");
    for (const threshold of CAPE_THRESHOLDS) {
      for (const entry of percentileAudit.crossings[threshold]) {
        lines.push(`| ${entry.date} | ${entry.value} | ${fmtPctile(entry.p)} | ${fmtPctile(entry.e)} | ${threshold} | ${entry.p < threshold ? "below" : "at/above"} | ${entry.e < threshold ? "below" : "at/above"} |`);
      }
    }
  }
  lines.push("");

  // ---- 3. Daily state/action audit. ----
  lines.push("## 3. Daily state/action audit");
  lines.push("");
  lines.push(`Method: for each of the ${STARTS.length} starts, the shared monthly signal machine is replayed day by day for both conventions exactly as \`runBacktest\` drives it — the previous close's order executes first (including carry-in from the prior month), then the close locks or upgrades the month's action. A day diverges when the executed action key differs (action) or the month's frozen decision key differs (key). CAPE is monthly, but upgrades can fire intra-month, so the complete daily trajectory is compared, not only first-of-month rows.`);
  lines.push("");
  lines.push(`Total divergent days across all ${STARTS.length} starts: **${divergences.length}** (key-only: ${divergences.length - actionDivergences.length}; involving an executed action: ${actionDivergences.length}). Start windows overlap, so one underlying CAPE-month event can appear under several starts.`);
  lines.push("");
  if (divergences.length === 0) {
    lines.push("Zero decision/action divergences between E-prior and P-current on the frozen snapshot. The divergence table is empty by result, not by omission.");
  } else {
    lines.push("| Start | Date | Kind | P executed | E executed | P month key | E month key | CAPE P | CAPE E | Threshold bit | Signal-bit changes |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- |");
    for (const item of divergences) {
      lines.push(`| ${item.start} | ${item.date} | ${item.kind} | ${item.pExecuted || "—"} | ${item.eExecuted || "—"} | ${item.pKey} | ${item.eKey} | ${fmtPctile(item.capeP)} | ${fmtPctile(item.capeE)} | ${item.thresholdBits.join(", ") || "—"} | ${item.bitDiffs.join("; ") || "—"} |`);
    }
  }
  lines.push("");

  // ---- 4. Backtest audit. ----
  lines.push("## 4. Backtest audit (11 starts × 3 costs = 33 comparisons)");
  lines.push("");
  lines.push("Signal-sleeve portfolio only; both conventions run through the same shared engine (`runBacktest`) with identical prices, costs, and accounting. ΔDD is E − P in percentage points of unit-NAV max drawdown (negative = deeper drawdown under E).");
  lines.push("");
  const btTable = (subset) => {
    const out = [];
    out.push("| Start | Cost (bps) | P final | E final | E/P | P maxDD | E maxDD | ΔDD (pp) | Action-count changes |");
    out.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
    for (const row of subset) {
      const changes = row.actionChanges.length
        ? row.actionChanges.map((change) => `${change.key} ${change.p}→${change.e}`).join("; ")
        : "none";
      out.push(`| ${row.start} | ${row.cost} | ${fmtUsd(row.pFinal)} | ${fmtUsd(row.eFinal)} | ${row.ratio.toFixed(6)} | ${fmtDD(row.pMaxDD)} | ${fmtDD(row.eMaxDD)} | ${fmtPp(row.ddDeltaPp)} | ${changes} |`);
    }
    return out;
  };
  lines.push("### Actual-TQQQ starts (TQQQ history fully actual)");
  lines.push("");
  lines.push(...btTable(backtestRows.filter((row) => ACTUAL_ONLY_STARTS.includes(row.start))));
  lines.push("");
  lines.push("### Synthetic-containing starts (pre-2010-02-11 TQQQ is modeled; reported separately)");
  lines.push("");
  lines.push(...btTable(backtestRows.filter((row) => SYNTHETIC_TQQQ_STARTS.includes(row.start))));
  lines.push("");
  lines.push("### Dates and actions responsible for any divergence");
  lines.push("");
  lines.push("Trajectory divergences are cost-independent (they are decided before any trade), so they are listed once per start.");
  lines.push("");
  for (const start of STARTS) {
    const items = divergences.filter((item) => item.start === start);
    if (items.length === 0) {
      lines.push(`- ${start}: no divergence.`);
    } else {
      lines.push(`- ${start}: ${items.map((item) => `${item.date} (${item.kind}: ${item.pKey}→${item.eKey}${item.pExecuted || item.eExecuted ? `, executed ${item.pExecuted || "—"}→${item.eExecuted || "—"}` : ""})`).join("; ")}.`);
    }
  }
  lines.push("");

  // ---- 5. Frozen interpretation, applied mechanically. ----
  lines.push("## 5. Frozen interpretation (applied mechanically)");
  lines.push("");
  if (divergences.length === 0) {
    lines.push(`There are **zero** decision/action differences between E-prior and P-current on the frozen snapshot across all ${STARTS.length} supported starts × ${COSTS.length} costs. Under the frozen interpretation, the convention is **operationally immaterial on current history** and production is kept unchanged to avoid needless churn.`);
  } else {
    lines.push(`There ${divergences.length === 1 ? "is" : "are"} **${divergences.length}** decision/action difference${divergences.length === 1 ? "" : "s"} between E-prior and P-current on the frozen snapshot (counted per start; windows overlap). Under the frozen interpretation this is **sensitivity evidence only**: the convention with the higher return is NOT selected. Thresholds were historically developed under P-current, so any production switch would require a separate semantic decision or a separately pre-registered recalibration study.`);
  }
  lines.push("");
  lines.push(`Descriptive materiality flags (frozen thresholds: absolute final-value change ≥ 1%, max-drawdown change ≥ 1 pp, or any action-key change — not a pass/fail optimization gate): **${flaggedRows.length} of ${backtestRows.length}** start×cost comparisons flagged.`);
  if (flaggedRows.length > 0) {
    lines.push("");
    lines.push("| Start | Cost (bps) | Final change | ΔDD (pp) | Action-key change |");
    lines.push("| --- | ---: | ---: | ---: | --- |");
    for (const row of flaggedRows) {
      lines.push(`| ${row.start} | ${row.cost} | ${fmtSignedPct(row.finalChange)} | ${fmtPp(row.ddDeltaPp)} | ${row.flagAction ? row.actionChanges.map((change) => `${change.key} ${change.p}→${change.e}`).join("; ") : "none"} |`);
    }
  }
  lines.push("");
  lines.push("No claim of causality, forecast improvement, out-of-sample validation, or valuation accuracy is made. Point-in-time CAPE revision history is unavailable from the current source (`capePointInTime: false`); this study does not fix or validate vintage/revision bias and must not be read as making valuation \"more accurate\".");
  lines.push("");

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "")}\n`;
}

function main() {
  const study = runStudy();
  const report = renderReport(study);
  process.stdout.write(report);
  const docsDir = path.join(__dirname, "..", "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "cape-percentile-convention-study.md"), report);
  console.error("wrote docs/cape-percentile-convention-study.md");
}

if (require.main === module) main();

module.exports = {
  runStudy,
  renderReport,
  main,
  capePercentilePriorAt,
  replayTrajectory,
  STARTS,
  ACTUAL_ONLY_STARTS,
  SYNTHETIC_TQQQ_STARTS,
  COSTS,
  MONTHLY,
  WINDOW,
  CAPE_THRESHOLDS,
  DELTA_BOUND,
  FLOAT_TOL,
  FROZEN_SNAPSHOT_ID,
};
