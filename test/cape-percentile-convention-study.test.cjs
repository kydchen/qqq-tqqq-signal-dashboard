const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  loadSnapshotData,
  buildPrices,
  buildStates,
  capeSeriesForBacktest,
  capePercentileAt,
  runBacktest,
  valueOf,
  DEFAULT_THRESHOLDS,
} = require("../api/_lib");
const {
  runStudy,
  renderReport,
  capePercentilePriorAt,
  STARTS,
  COSTS,
  MONTHLY,
  WINDOW,
  DELTA_BOUND,
  FLOAT_TOL,
  FROZEN_SNAPSHOT_ID,
} = require("../scripts/cape-percentile-convention-study.cjs");

// CI regression guards for the CAPE percentile convention sensitivity study.
// runStudy executes once per test process and is shared by every assertion.
// No win/fail gate assertions exist here by design: the study is descriptive
// sensitivity evidence under a frozen pre-registration, not a verdict.

const study = runStudy();

test("data snapshot id matches the frozen pre-registered snapshot", () => {
  assert.equal(study.snapshotId, FROZEN_SNAPSHOT_ID);
});

test("every evaluated app state has a full 360-observation prior window", () => {
  assert.equal(study.coverage.fullHistory, true);
  assert(
    study.coverage.minEvaluatedCapeIndex >= WINDOW,
    `minimum CAPE index feeding an evaluated state is ${study.coverage.minEvaluatedCapeIndex}, below the ${WINDOW}-observation prior window`,
  );
});

test("|E-prior - P-current| stays within 100/360 + floating tolerance for every evaluated CAPE month", () => {
  assert(
    study.percentileAudit.boundHolds,
    `max |E - P| ${study.percentileAudit.maxAbsDelta} exceeds ${DELTA_BOUND} + ${FLOAT_TOL}`,
  );
  assert(study.percentileAudit.maxAbsDelta <= DELTA_BOUND + FLOAT_TOL);
});

test("E-prior helper re-derivation: 360 prior observations, <= tie rule, /360", () => {
  const data = loadSnapshotData();
  const capeChrono = capeSeriesForBacktest(data.capeLatestFirst).reverse();
  // Sample the earliest evaluated window, a mid window, and the newest window.
  const indices = [
    study.coverage.minEvaluatedCapeIndex,
    Math.floor((study.coverage.minEvaluatedCapeIndex + capeChrono.length - 1) / 2),
    capeChrono.length - 1,
  ];
  for (const index of indices) {
    const prior = capeChrono.slice(index - WINDOW, index);
    assert.equal(prior.length, WINDOW, `index ${index}: prior window must hold exactly ${WINDOW} observations`);
    const current = capeChrono[index].value;
    const expected = 100 * prior.filter((point) => point.value <= current).length / WINDOW;
    assert.equal(capePercentilePriorAt(capeChrono, index), expected, `index ${index}: E-prior tie rule mismatch`);
  }
});

test("buildStates seam: explicit production callback is byte-identical to the default call", () => {
  const data = loadSnapshotData();
  const prices = buildPrices(data.nasdaq, data.qqq, data.tqqq, data.rates);
  const capeChrono = capeSeriesForBacktest(data.capeLatestFirst).reverse();
  const byDefault = buildStates(prices, data.nasdaq, data.vix, capeChrono);
  const byExplicit = buildStates(prices, data.nasdaq, data.vix, capeChrono, capePercentileAt);
  assert.deepStrictEqual(byExplicit, byDefault);
});

test("P-current portfolio outputs match the production/default path exactly (33 comparisons)", () => {
  const data = loadSnapshotData();
  const prices = buildPrices(data.nasdaq, data.qqq, data.tqqq, data.rates);
  data.prices = prices;
  const capeChrono = capeSeriesForBacktest(data.capeLatestFirst).reverse();
  const states = buildStates(prices, data.nasdaq, data.vix, capeChrono);
  let checked = 0;
  for (const start of STARTS) {
    for (const cost of COSTS) {
      const row = study.backtestRows.find((item) => item.start === start && item.cost === cost);
      assert(row, `missing study row for ${start} @ ${cost} bps`);
      const engine = runBacktest(data, start, MONTHLY, DEFAULT_THRESHOLDS, states, null, cost);
      const productionFinal = valueOf(engine.portfolios.signal, engine.finalPrices);
      assert.equal(
        row.pFinal,
        productionFinal,
        `${start} @ ${cost} bps: study P final ${row.pFinal} vs production path ${productionFinal}`,
      );
      checked += 1;
    }
  }
  assert.equal(checked, 33);
});

test("renderReport matches docs/cape-percentile-convention-study.md byte for byte", () => {
  const docPath = path.join(__dirname, "..", "docs", "cape-percentile-convention-study.md");
  const doc = fs.readFileSync(docPath, "utf8");
  assert.equal(
    renderReport(study),
    doc,
    "docs/cape-percentile-convention-study.md has drifted from the generator; rerun `node scripts/cape-percentile-convention-study.cjs`",
  );
});
