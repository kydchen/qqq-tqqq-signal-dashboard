const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  runStudy,
  renderReport,
  B2C_RESERVE_CAP,
  B3C_RESERVE_CAP,
} = require("../scripts/baseline-study.cjs");

// CI regression guards for the baseline study. runStudy executes once per
// test process and is shared by every assertion below.

const study = runStudy();
const dateIndex = new Map(study.dates.map((date, index) => [date, index]));

test("every baseline variant executes on the first trading session after its signal (T+1)", () => {
  let checked = 0;
  for (const run of study.variantRuns) {
    assert(run.stats.executions.length > 0, `${run.plan} ${run.start} should record executions`);
    for (const execution of run.stats.executions) {
      const signalIndex = dateIndex.get(execution.signalDate);
      const executionIndex = dateIndex.get(execution.executionDate);
      assert(signalIndex != null, `${run.plan} ${run.start}: signal date ${execution.signalDate} not in the trading calendar`);
      assert(executionIndex != null, `${run.plan} ${run.start}: execution date ${execution.executionDate} not in the trading calendar`);
      // The execution session must be exactly the next trading day after the
      // signal session: no trading day may lie strictly between them.
      // (Orders still pending at the end of the data are simply not in the
      // executions list, so they are excluded by construction.)
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

test("capped reserves never exceed their caps right after execution", () => {
  const caps = { B2c: B2C_RESERVE_CAP, B3c: B3C_RESERVE_CAP };
  let checked = 0;
  for (const run of study.variantRuns) {
    const cap = caps[run.plan];
    if (cap == null) continue;
    assert(run.stats.reserveAfter.length > 0, `${run.plan} ${run.start} should record reserve levels`);
    for (const point of run.stats.reserveAfter) {
      checked += 1;
      assert(
        point.reserve <= cap + 1e-6,
        `${run.plan} ${run.start}: reserve ${point.reserve} exceeds cap ${cap} on ${point.date}`,
      );
    }
  }
  assert(checked > 0, "no reserve observations checked");
});

test("renderReport matches docs/baseline-study.md byte for byte", () => {
  const docPath = path.join(__dirname, "..", "docs", "baseline-study.md");
  const doc = fs.readFileSync(docPath, "utf8");
  assert.equal(
    renderReport(study),
    doc,
    "docs/baseline-study.md has drifted from the generator; rerun `node scripts/baseline-study.cjs`",
  );
});

test("B4nbl parity with B4 in windows without bottom purchases", () => {
  // In these start windows no bottomAttack/rampTqqq purchase fires, so the
  // no-bottom-leverage variant must reproduce the production signal sleeve
  // to the dollar. Note: the production strategy DOES still buy TQQQ here
  // via the normalDca floor (verified against runBacktest: 2023-07-31 and
  // 2025-04-30 entries), which the ablation deliberately keeps unchanged —
  // so the drift invariant is that TQQQ is only ever added by normalDca,
  // never through the ablated bottom legs.
  for (const start of ["2023-01-01", "2024-01-01", "2025-01-01"]) {
    const b4 = study.rowsAblation.find((row) => row.start === start && row.plan === "B4");
    const nbl = study.rowsAblation.find((row) => row.start === start && row.plan === "B4nbl");
    assert(b4 && nbl, `${start}: missing ablation rows`);
    const relativeError = Math.abs(nbl.finalValue - b4.finalValue) / b4.finalValue;
    assert(
      relativeError <= 1e-6,
      `${start}: B4nbl final value ${nbl.finalValue} diverged from B4 ${b4.finalValue} (relative error ${relativeError})`,
    );
    const run = study.variantRuns.find((item) => item.start === start && item.plan === "B4nbl");
    assert(run, `${start}: missing B4nbl run stats`);
    const tqqqBuyActions = Object.keys(run.stats.tqqqBuyActions);
    assert(
      tqqqBuyActions.every((key) => key === "normalDca"),
      `${start}: B4nbl added TQQQ through actions other than the normalDca floor: ${tqqqBuyActions.join(", ")}`,
    );
  }
});

test("B4nbl never adds TQQQ through the ablated bottom legs in any start", () => {
  for (const run of study.variantRuns) {
    if (run.plan !== "B4nbl") continue;
    assert(
      run.stats.tqqqBuyActions.bottomAttack == null && run.stats.tqqqBuyActions.rampTqqq == null,
      `${run.start}: B4nbl bought TQQQ via an ablated action: ${JSON.stringify(run.stats.tqqqBuyActions)}`,
    );
  }
});
