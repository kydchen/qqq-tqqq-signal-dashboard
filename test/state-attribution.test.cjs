const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { runStudy: runSleeveStudy } = require("../scripts/tqqq-sleeve-study.cjs");
const {
  runStudy,
  renderReport,
  MAX_TQQQ,
  COST_BPS,
  FROZEN_SNAPSHOT_ID,
} = require("../scripts/state-attribution-study.cjs");
const { loadSnapshotData, buildDataSnapshotId } = require("../api/_lib");

// CI regression guards for the single-state marginal attribution study.
// runStudy executes once per test process and is shared by every assertion.
// No win/fail gate assertions exist here by design: the attribution table
// is descriptive data, not a verdict.
//
// Frozen-research snapshot gate: this study is frozen on FROZEN_SNAPSHOT_ID.
// When the bundled data moves on, every test in this file skips instead of
// failing, so the production gate (npm test) and the research suite
// (npm run test:research) stay independent of snapshot updates.
const currentSnapshotId = buildDataSnapshotId(loadSnapshotData());
const frozenDataPresent = currentSnapshotId === FROZEN_SNAPSHOT_ID;
if (!frozenDataPresent) {
  console.warn(`[research-gate] attribution study frozen on ${FROZEN_SNAPSHOT_ID}, data is now ${currentSnapshotId}; skipping the frozen-research tests in this file`);
}
const researchTest = frozenDataPresent ? test : (name, ...args) => test(name, { skip: true }, ...args);

const study = runStudy();
const dateIndex = new Map(study.dates.map((date, index) => [date, index]));

researchTest("data snapshot id matches the frozen pre-registered snapshot", () => {
  assert.equal(study.snapshotId, FROZEN_SNAPSHOT_ID);
});

researchTest("every variant execution is exactly one trading session after its signal", () => {
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

researchTest("P replica matches the engine signal portfolio final value (1e-9)", () => {
  for (const replica of study.replicaRuns) {
    const engineRow = study.rows.find((row) => row.start === replica.start && row.plan === "P");
    const relativeError = Math.abs(replica.finalValue - engineRow.finalValue) / engineRow.finalValue;
    assert(
      relativeError <= 1e-9,
      `${replica.start}: P replica final value ${replica.finalValue} vs engine signal ${engineRow.finalValue} (relative error ${relativeError})`,
    );
  }
});

researchTest("P replica monthly trajectory matches the engine signal portfolio point by point", () => {
  // The per-state TQQQ share counts come from the replica, so a final-value
  // check alone is not enough: every monthly point must align with the
  // engine's portfolios.signal — identical dates, and value within 1e-9
  // relative. (Independent recomputation by review found identical dates on
  // all 11 starts and a max relative error of ~5.6e-16; this pins it in CI.)
  let checked = 0;
  let maxRelativeError = 0;
  for (const replica of study.replicaRuns) {
    assert.equal(
      replica.points.length,
      replica.enginePoints.length,
      `${replica.start}: point count ${replica.points.length} vs engine ${replica.enginePoints.length}`,
    );
    for (let i = 0; i < replica.points.length; i += 1) {
      const replicaPoint = replica.points[i];
      const enginePoint = replica.enginePoints[i];
      assert.equal(
        replicaPoint.date,
        enginePoint.date,
        `${replica.start} point ${i}: replica date ${replicaPoint.date} vs engine date ${enginePoint.date}`,
      );
      const relativeError = Math.abs(replicaPoint.value - enginePoint.value) / Math.max(enginePoint.value, 1e-12);
      maxRelativeError = Math.max(maxRelativeError, relativeError);
      assert(
        relativeError <= 1e-9,
        `${replica.start} ${enginePoint.date}: replica value ${replicaPoint.value} vs engine ${enginePoint.value} (relative error ${relativeError})`,
      );
      checked += 1;
    }
  }
  assert(checked > 0, "no monthly points checked");
  console.log(`P replica vs engine monthly trajectory: ${checked} points across ${study.replicaRuns.length} starts, max relative error ${maxRelativeError.toExponential(2)}`);
});

researchTest("F matches the #9 sleeve study exact variant final value (1e-9)", () => {
  const sleeve = runSleeveStudy();
  for (const row of study.rows.filter((item) => item.plan === "F")) {
    const sleeveRow = sleeve.rows.find((item) => item.start === row.start && item.plan === "sleeve-exact");
    assert(sleeveRow, `${row.start}: missing sleeve-exact row in the #9 study`);
    const relativeError = Math.abs(row.finalValue - sleeveRow.finalValue) / sleeveRow.finalValue;
    assert(
      relativeError <= 1e-9,
      `${row.start}: F final value ${row.finalValue} vs #9 sleeve-exact ${sleeveRow.finalValue} (relative error ${relativeError})`,
    );
  }
});

researchTest("invariants: non-negative cash and post-execution TQQQ weight <= 40%", () => {
  // Cap timing is frozen per execution path: sleeve-timed executions (all of
  // F, plus the replaced state in each Si) enforce the cap AFTER the
  // rebalance and land at or below 40% exactly. Production-timed executions
  // (P and unreplaced states) enforce the cap BEFORE the action; a
  // subsequent QQQ buy in the same action shrinks NAV by at most the 5bp
  // fee, so the ledger-derived bound there is MAX_TQQQ / (1 - feeRate).
  const FEE_RATE = COST_BPS / 10000;
  const productionCapBound = MAX_TQQQ / (1 - FEE_RATE);
  for (const run of study.variantRuns) {
    assert(
      run.stats.minCash >= -1e-7,
      `${run.plan} ${run.start}: cash went negative (min ${run.stats.minCash})`,
    );
    for (const record of run.stats.execRecords) {
      const sleeveTimed = run.plan === "F" || record.key === run.replaced;
      const bound = (sleeveTimed ? MAX_TQQQ : productionCapBound) + 1e-9;
      assert(
        record.postTqqqWeight <= bound,
        `${run.plan} ${run.start} ${record.date} (${record.key}, ${sleeveTimed ? "sleeve" : "production"} cap timing): post-execution TQQQ weight ${record.postTqqqWeight} exceeds ${bound}`,
      );
    }
  }
});

researchTest("renderReport matches docs/state-attribution-study.md byte for byte", () => {
  const docPath = path.join(__dirname, "..", "docs", "state-attribution-study.md");
  const doc = fs.readFileSync(docPath, "utf8");
  assert.equal(
    renderReport(study),
    doc,
    "docs/state-attribution-study.md has drifted from the generator; rerun `node scripts/state-attribution-study.cjs`",
  );
});
