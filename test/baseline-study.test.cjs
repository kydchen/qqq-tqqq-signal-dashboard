const test = require("node:test");
const assert = require("node:assert/strict");
const {
  runStudy,
  B2C_RESERVE_CAP,
  B3C_RESERVE_CAP,
} = require("../scripts/baseline-study.cjs");

// CI regression guard for the baseline study: (a) every baseline variant
// executes its month-start signal on a later trading session (T+1, same
// convention as the engine's signal sleeve); (b) the capped-reserve plans
// B2c/B3c never hold more extra reserve than their caps right after each
// monthly execution.

const study = runStudy();

test("every baseline variant executes month-start signals on a later session (T+1)", () => {
  let checked = 0;
  for (const run of study.variantRuns) {
    assert(run.stats.executions.length > 0, `${run.plan} ${run.start} should record executions`);
    for (const execution of run.stats.executions) {
      checked += 1;
      assert(
        execution.signalDate < execution.executionDate,
        `${run.plan} ${run.start}: signal ${execution.signalDate} must precede execution ${execution.executionDate}`,
      );
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
