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

// CI regression guards for the single-state marginal attribution study.
// runStudy executes once per test process and is shared by every assertion.
// No win/fail gate assertions exist here by design: the attribution table
// is descriptive data, not a verdict.

const study = runStudy();
const dateIndex = new Map(study.dates.map((date, index) => [date, index]));

test("data snapshot id matches the frozen pre-registered snapshot", () => {
  assert.equal(study.snapshotId, FROZEN_SNAPSHOT_ID);
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

test("P replica matches the engine signal portfolio final value (1e-9)", () => {
  for (const replica of study.replicaRuns) {
    const engineRow = study.rows.find((row) => row.start === replica.start && row.plan === "P");
    const relativeError = Math.abs(replica.finalValue - engineRow.finalValue) / engineRow.finalValue;
    assert(
      relativeError <= 1e-9,
      `${replica.start}: P replica final value ${replica.finalValue} vs engine signal ${engineRow.finalValue} (relative error ${relativeError})`,
    );
  }
});

test("F matches the #9 sleeve study exact variant final value (1e-9)", () => {
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

test("invariants: non-negative cash and post-execution TQQQ weight <= 40%", () => {
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

test("renderReport matches docs/state-attribution-study.md byte for byte", () => {
  const docPath = path.join(__dirname, "..", "docs", "state-attribution-study.md");
  const doc = fs.readFileSync(docPath, "utf8");
  assert.equal(
    renderReport(study),
    doc,
    "docs/state-attribution-study.md has drifted from the generator; rerun `node scripts/state-attribution-study.cjs`",
  );
});
