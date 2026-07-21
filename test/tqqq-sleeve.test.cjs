const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { CORE_QQQ_HIGH_REGIME_FRACTION } = require("../api/_lib");
const {
  runStudy,
  renderReport,
  STARTS,
  MAX_TQQQ,
  BAND_PP,
  BUILD_UP_KEYS,
} = require("../scripts/tqqq-sleeve-study.cjs");

// CI regression guards for the target-weight TQQQ sleeve study. runStudy
// executes once per test process and is shared by every assertion below.

const study = runStudy();
const dateIndex = new Map(study.dates.map((date, index) => [date, index]));

// ---------------------------------------------------------------------------
// Independent ledger-theory implementation (value space), written directly
// from the frozen funding waterfall and the engine's 5 bps ledger rules: a
// buy converts cash spend S into S/(1+f) of asset value; a sell converts
// gross value V into V*(1-f) of cash. Fractional shares are fixed on, so the
// value-space representation is exact. This deliberately shares no code with
// the study script's rebalance implementation.
// ---------------------------------------------------------------------------
function theoryTargetWeight(decision, currentWeight) {
  const key = decision.key;
  if (key === "normalDca" || key === "smallDipBuy") return 0.10;
  if (key === "bottomAttack") return 0.25;
  if (key === "rampTqqq") return 0.25 + (0.15 * (7 - decision.rampMonths)) / 6;
  if (key === "trimHeat") return Math.max(0.10, (currentWeight * 11) / 12);
  if (key === "pauseAtHigh") return currentWeight;
  if (key === "crashDefense") return currentWeight * 0.5;
  throw new Error(`unexpected decision key ${key}`);
}

function theoryPostWeight(spec, decision, monthly, feeRate, band) {
  let cash = spec.cashValue + monthly; // month-start contribution
  let qqq = spec.qqqValue;
  let tqqq = spec.tqqqValue;
  // Retained QQQ/cash incremental leg (production formulas).
  let spend = 0;
  if (decision.key === "smallDipBuy") spend = Math.min(cash, monthly * 2);
  else if (decision.key === "trimHeat" || decision.key === "pauseAtHigh") spend = Math.min(cash, monthly * CORE_QQQ_HIGH_REGIME_FRACTION);
  else if (decision.key === "normalDca") spend = Math.min(cash, monthly + Math.max(0, cash - monthly) / 6);
  qqq += spend / (1 + feeRate);
  cash -= spend;
  // Sleeve target on post-retained NAV.
  const nav = cash + qqq + tqqq;
  const currentWeight = tqqq / nav;
  let target = theoryTargetWeight(decision, currentWeight);
  if (band && BUILD_UP_KEYS.has(decision.key) && Math.abs(currentWeight - target) <= BAND_PP) {
    target = currentWeight; // inside the band: no trade
  }
  // Funding waterfall: cash first, then sell QQQ for the shortfall and buy
  // TQQQ with the proceeds (sell before buy); excess TQQQ sold into cash.
  const targetValue = target * nav;
  if (tqqq < targetValue) {
    const need = targetValue - tqqq;
    const cashSpend = Math.min(cash, need);
    tqqq += cashSpend / (1 + feeRate);
    cash -= cashSpend;
    const remaining = need - cashSpend;
    if (remaining > 1e-12 && qqq > 0) {
      const sale = Math.min(qqq, remaining);
      qqq -= sale;
      const proceeds = sale * (1 - feeRate);
      cash += proceeds;
      tqqq += proceeds / (1 + feeRate);
      cash -= proceeds;
    }
  } else if (tqqq > targetValue) {
    const sale = tqqq - targetValue;
    tqqq -= sale;
    cash += sale * (1 - feeRate);
  }
  // 40% cap enforced after the rebalance (production formula).
  let total = cash + qqq + tqqq;
  const excess = tqqq - total * MAX_TQQQ;
  if (excess > 0 && tqqq > 0) {
    const grossSale = excess / Math.max(1e-9, 1 - MAX_TQQQ * feeRate);
    tqqq -= grossSale;
    cash += grossSale * (1 - feeRate);
    total = cash + qqq + tqqq;
  }
  return tqqq / total;
}

// ---------------------------------------------------------------------------
// 1. Convergence protocol (primary evidence).
// ---------------------------------------------------------------------------
test("convergence: exact variant equals the ledger-derived theoretical weight (1e-9)", () => {
  const conv = study.convergence;
  let checked = 0;
  for (const state of conv.statesUnderTest) {
    for (const [pfKey, spec] of Object.entries(conv.portfolioSpecs)) {
      const theory = theoryPostWeight(spec, state.decision, conv.monthly, conv.feeRate, false);
      const sim = conv.results.exact[state.label][pfKey].postTqqqWeight;
      const relativeError = Math.abs(sim - theory) / Math.max(theory, 1e-12);
      assert(
        relativeError <= 1e-9,
        `exact ${state.label} from ${pfKey}: simulated weight ${sim} vs ledger-theoretical ${theory} (relative error ${relativeError})`,
      );
      checked += 1;
    }
  }
  assert.equal(checked, 9 * 3); // 9 build-up states x 3 starting portfolios
});

test("convergence: band variant within 2pp+friction of target, pairwise within 4pp+friction", () => {
  const conv = study.convergence;
  for (const state of conv.statesUnderTest) {
    const theoryExact = {};
    for (const [pfKey, spec] of Object.entries(conv.portfolioSpecs)) {
      theoryExact[pfKey] = theoryPostWeight(spec, state.decision, conv.monthly, conv.feeRate, false);
      const theoryBand = theoryPostWeight(spec, state.decision, conv.monthly, conv.feeRate, true);
      const sim = conv.results.band[state.label][pfKey].postTqqqWeight;
      // Internal consistency: the simulation must match the band-rule theory.
      assert(
        Math.abs(sim - theoryBand) / Math.max(theoryBand, 1e-12) <= 1e-9,
        `band ${state.label} from ${pfKey}: simulated ${sim} vs band-theoretical ${theoryBand}`,
      );
      // Distance to the exact-theoretical weight: <= 2pp plus ledger friction
      // (friction = |nominal target - exact-theoretical weight|, derived from
      // the ledger, not an adjustable epsilon).
      const friction = Math.abs(state.target - theoryExact[pfKey]);
      assert(
        Math.abs(sim - theoryExact[pfKey]) <= BAND_PP + friction + 1e-12,
        `band ${state.label} from ${pfKey}: weight ${sim} is ${(Math.abs(sim - theoryExact[pfKey]) * 100).toFixed(3)}pp from the theoretical weight, beyond 2pp + friction ${(friction * 100).toFixed(3)}pp`,
      );
    }
    // Pairwise bound: 4pp plus the two portfolios' ledger friction.
    const pfKeys = Object.keys(conv.portfolioSpecs);
    for (const a of pfKeys) {
      for (const b of pfKeys) {
        const friction = Math.abs(state.target - theoryExact[a]) + Math.abs(state.target - theoryExact[b]);
        const diff = Math.abs(conv.results.band[state.label][a].postTqqqWeight - conv.results.band[state.label][b].postTqqqWeight);
        assert(
          diff <= 2 * BAND_PP + friction + 1e-12,
          `band ${state.label}: pairwise difference ${(diff * 100).toFixed(3)}pp between ${a} and ${b} exceeds 4pp + friction`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Invariants across all starts and both sleeve variants.
// ---------------------------------------------------------------------------
test("invariants: non-negative cash and post-execution TQQQ weight <= 40%", () => {
  for (const run of study.sleeveRuns) {
    assert(
      run.stats.minCash >= -1e-7,
      `${run.variant} ${run.start}: cash went negative (min ${run.stats.minCash})`,
    );
    for (const record of run.stats.execRecords) {
      assert(
        record.postTqqqWeight <= MAX_TQQQ + 1e-9,
        `${run.variant} ${run.start} ${record.date}: post-execution TQQQ weight ${record.postTqqqWeight} exceeds 40%`,
      );
    }
  }
});

test("invariants: defensive states in the band variant always execute the gradual rule directly", () => {
  // The band applies only to the four build-up states. In the band variant,
  // every defensive month's executed target must equal the direct gradual
  // formula of that month's pre-execution weight (i.e., the band never
  // suppresses or modifies a defensive trade), month by month, all starts.
  // (Note the two variants' holdings diverge after build-up months, so the
  // enforceable invariant is rule-level, not identical trade sizes.)
  for (const run of study.sleeveRuns) {
    if (run.variant !== "band") continue;
    for (const record of run.stats.execRecords) {
      if (BUILD_UP_KEYS.has(record.key)) continue;
      const expected = theoryTargetWeight({ key: record.key }, record.preTqqqWeight);
      assert(
        Math.abs(record.targetWeight - expected) <= 1e-12,
        `band ${run.start} ${record.date} (${record.key}): executed target ${record.targetWeight} was band-modified; direct gradual target is ${expected}`,
      );
    }
  }
});

test("invariants: band variant skips build-up rebalances only inside the 2pp band", () => {
  for (const run of study.sleeveRuns) {
    if (run.variant !== "band") continue;
    for (const record of run.stats.execRecords) {
      if (!BUILD_UP_KEYS.has(record.key)) continue;
      const nominal = theoryTargetWeight({ key: record.key, rampMonths: record.rampMonths }, record.preTqqqWeight);
      if (Math.abs(record.preTqqqWeight - nominal) <= BAND_PP) {
        assert(
          Math.abs(record.targetWeight - record.preTqqqWeight) <= 1e-12,
          `band ${run.start} ${record.date} (${record.key}): inside-band month still traded to ${record.targetWeight}`,
        );
      } else {
        assert(
          Math.abs(record.targetWeight - nominal) <= 1e-12,
          `band ${run.start} ${record.date} (${record.key}): outside-band month did not rebalance to the exact target`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 3. T+1: every execution is exactly the first trading session after its
// signal (orders pending at the end of the data are not executed, hence not
// in the executions list by construction).
// ---------------------------------------------------------------------------
test("every variant execution is exactly one trading session after its signal", () => {
  const runs = [...study.sleeveRuns, ...study.replicaRuns.map((run) => ({ ...run, variant: "current-replica" }))];
  let checked = 0;
  for (const run of runs) {
    assert(run.stats.executions.length > 0, `${run.variant} ${run.start} should record executions`);
    for (const execution of run.stats.executions) {
      const signalIndex = dateIndex.get(execution.signalDate);
      const executionIndex = dateIndex.get(execution.executionDate);
      assert(signalIndex != null && executionIndex != null, `${run.variant} ${run.start}: dates must be in the trading calendar`);
      assert.equal(
        executionIndex,
        signalIndex + 1,
        `${run.variant} ${run.start}: execution ${execution.executionDate} is not the first trading day after signal ${execution.signalDate}`,
      );
      checked += 1;
    }
  }
  assert(checked > 0, "no executions checked");
});

// ---------------------------------------------------------------------------
// 4. Current-strategy replica parity (turnover source must not drift).
// ---------------------------------------------------------------------------
test("current-strategy replica matches the engine signal portfolio final value", () => {
  for (const replica of study.replicaRuns) {
    const engineRow = study.rows.find((row) => row.start === replica.start && row.plan === "current");
    const relativeError = Math.abs(replica.finalValue - engineRow.finalValue) / engineRow.finalValue;
    assert(
      relativeError <= 1e-9,
      `${replica.start}: replica final value ${replica.finalValue} vs engine signal ${engineRow.finalValue} (relative error ${relativeError})`,
    );
  }
});

// ---------------------------------------------------------------------------
// 5. Report/generator byte synchronization.
// ---------------------------------------------------------------------------
test("renderReport matches docs/tqqq-sleeve-study.md byte for byte", () => {
  const docPath = path.join(__dirname, "..", "docs", "tqqq-sleeve-study.md");
  const doc = fs.readFileSync(docPath, "utf8");
  assert.equal(
    renderReport(study),
    doc,
    "docs/tqqq-sleeve-study.md has drifted from the generator; rerun `node scripts/tqqq-sleeve-study.cjs`",
  );
});
