const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { runStudy: runAttributionStudy } = require("../scripts/state-attribution-study.cjs");
const {
  runStudy,
  renderReport,
  MAX_TQQQ,
  COST_BPS,
  FROZEN_SNAPSHOT_ID,
  bandFor,
} = require("../scripts/oneway-floor-study.cjs");

// CI regression guards for the one-way floor study. runStudy executes once
// per test process and is shared by every assertion below.

const study = runStudy();
const dateIndex = new Map(study.dates.map((date, index) => [date, index]));

test("data snapshot id matches the frozen pre-registered snapshot", () => {
  assert.equal(study.snapshotId, FROZEN_SNAPSHOT_ID);
});

test("floor adjustment logic never sells TQQQ; cap sales are recorded separately", () => {
  let floorMonthsChecked = 0;
  for (const run of study.floorRecordsByVariant) {
    for (const record of run.records) {
      if (record.path !== "floor") continue;
      floorMonthsChecked += 1;
      // The floor leg contains no TQQQ sell call: its share delta can never
      // be negative, and its recorded sell count is structurally zero.
      assert(
        record.floorDelta >= -1e-12,
        `${run.plan} ${run.start} ${record.date}: floor leg share delta ${record.floorDelta} is negative — a sell occurred inside the floor logic`,
      );
      assert.equal(
        record.floorSellDelta,
        0,
        `${run.plan} ${run.start} ${record.date}: floorSellDelta ${record.floorSellDelta} must be exactly 0`,
      );
      // Any net decrease in a replaced month must be fully explained by
      // post-rebalance cap enforcement: delta == floorDelta - capSellDelta.
      assert(
        Math.abs(record.delta - (record.floorDelta - record.capSellDelta)) <= 1e-9,
        `${run.plan} ${run.start} ${record.date}: net delta ${record.delta} not explained by floorDelta ${record.floorDelta} and capSellDelta ${record.capSellDelta}`,
      );
      if (record.delta < -1e-9) {
        assert(
          record.capSellDelta > 0,
          `${run.plan} ${run.start} ${record.date}: decrease without cap enforcement sale`,
        );
      }
    }
  }
  assert(floorMonthsChecked > 0, "no floor-path months checked");
});

test("every variant execution is exactly one trading session after its signal", () => {
  let checked = 0;
  for (const run of study.variantRuns) {
    assert(run.stats.executions.length > 0, `${run.plan} ${run.start} should record executions`);
    for (const execution of run.stats.executions) {
      const signalIndex = dateIndex.get(execution.signalDate);
      const executionIndex = dateIndex.get(execution.executionDate);
      assert(signalIndex != null && executionIndex != null, `${run.plan} ${run.start}: dates must be in the trading calendar`);
      // Orders still pending at the end of the data are not executed, hence
      // not in the executions list by construction.
      assert.equal(
        executionIndex,
        signalIndex + 1,
        `${run.plan} ${run.start}: execution ${execution.executionDate} is not the first trading day after signal ${execution.signalDate}`,
      );
      checked += 1;
    }
  }
  assert(checked > 0, "no executions checked");
});

test("P, S1-exact and S2-exact match the #11 attribution results (1e-9)", () => {
  const attribution = runAttributionStudy();
  const attributionFinal = (start, plan) => attribution.rows.find((row) => row.start === start && row.plan === plan).finalValue;
  const parityPairs = [];
  for (const row of study.rows) {
    if (row.plan === "P") parityPairs.push([row, attributionFinal(row.start, "P")]);
    if (row.plan === "S1-exact") parityPairs.push([row, attributionFinal(row.start, "S1")]);
    if (row.plan === "S2-exact") parityPairs.push([row, attributionFinal(row.start, "S2")]);
  }
  assert(parityPairs.length > 0);
  for (const [row, reference] of parityPairs) {
    const relativeError = Math.abs(row.finalValue - reference) / reference;
    assert(
      relativeError <= 1e-9,
      `${row.start} ${row.plan}: final value ${row.finalValue} vs #11 ${reference} (relative error ${relativeError})`,
    );
  }
});

test("invariants: non-negative cash and post-execution TQQQ weight within cap bounds", () => {
  // Cap timing is frozen per execution path: replaced months of the
  // S-exact and floor variants enforce the cap AFTER the rebalance and land
  // at or below 40% exactly; production-timed executions (P and unreplaced
  // states) enforce the cap BEFORE the action, so a subsequent QQQ buy in
  // the same action can shrink NAV by at most the 5bp fee (ledger-derived
  // bound MAX_TQQQ / (1 - feeRate), as in the #11 test).
  const FEE_RATE = COST_BPS / 10000;
  const productionCapBound = MAX_TQQQ / (1 - FEE_RATE);
  for (const run of study.variantRuns) {
    assert(
      run.stats.minCash >= -1e-7,
      `${run.plan} ${run.start}: cash went negative (min ${run.stats.minCash})`,
    );
    for (const record of run.stats.execRecords) {
      const afterRebalance = run.replaced != null && record.key === run.replaced;
      const bound = (afterRebalance ? MAX_TQQQ : productionCapBound) + 1e-9;
      assert(
        record.postTqqqWeight <= bound,
        `${run.plan} ${run.start} ${record.date} (${record.key}): post-execution TQQQ weight ${record.postTqqqWeight} exceeds ${bound}`,
      );
    }
  }
});

test("frozen conclusion regression: all six cells land in band A with a joint conclusion", () => {
  // Pins the conclusion itself, not just the report text: if someone later
  // changes the generator and regenerates the report, a wrong conclusion
  // must fail here even though the byte-sync test would still pass.
  const { decision } = study;
  assert.equal(decision.ratioRows.length, 3);
  for (const row of decision.ratioRows) {
    for (const state of ["S1", "S2"]) {
      assert(
        row[state].floorExact >= 1.03 && row[state].floorP >= 0.97,
        `${row.start} ${state}: floor/exact ${row[state].floorExact}, floor/P ${row[state].floorP} must satisfy band A thresholds`,
      );
      assert.equal(row[state].band, "A", `${row.start} ${state} must be band A`);
    }
  }
  // State aggregation: both states cover 3 of 3 interpretable starts.
  for (const state of ["S1", "S2"]) {
    const coverage = decision.ratioRows.filter((row) => row[state].band === "A").length;
    assert.equal(coverage, 3, `${state} band-A coverage must be 3/3`);
  }
  assert.equal(decision.s1Band, "A");
  assert.equal(decision.s2Band, "A");
  assert.equal(decision.jointBand, "A", "joint conclusion must be band A (sell leg is the main source, loss basically recovered)");
  assert(decision.joint.startsWith("Joint conclusion"), `unexpected joint wording: ${decision.joint}`);
});

test("bandFor boundary semantics: exact 0.97 is band C, exact 1.03 is band A/B, strict middle is band D", () => {
  // floor/exact exactly 0.97 => does not support the sell-leg explanation.
  assert.equal(bandFor(0.97, 1), "C");
  assert.equal(bandFor(0.97, 0.5), "C");
  // floor/exact exactly 1.03 => satisfies the >= 1.03 clause; band then
  // depends on floor/P (>= 0.97 => A, < 0.97 => B).
  assert.equal(bandFor(1.03, 0.97), "A");
  assert.equal(bandFor(1.03, 1.5), "A");
  assert.equal(bandFor(1.03, 0.969999), "B");
  // Strict middle 0.97 < x < 1.03 => insufficient evidence.
  assert.equal(bandFor(0.9700000001, 1), "D");
  assert.equal(bandFor(1.0299999999, 1), "D");
  assert.equal(bandFor(1.0, 1), "D");
});

test("renderReport matches docs/oneway-floor-study.md byte for byte", () => {
  const docPath = path.join(__dirname, "..", "docs", "oneway-floor-study.md");
  const doc = fs.readFileSync(docPath, "utf8");
  assert.equal(
    renderReport(study),
    doc,
    "docs/oneway-floor-study.md has drifted from the generator; rerun `node scripts/oneway-floor-study.cjs`",
  );
});
