const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  backtest,
  capeSeriesForBacktest,
  calculateDecision,
  decisionConfidence,
  CORE_QQQ_HIGH_REGIME_FRACTION,
  MAIN_SIGNAL_POLICY_KEY,
  marketSnapshot,
  parseCapeTable,
  DEFAULT_COST_BPS,
  DEFAULT_THRESHOLDS,
  RULESET_ID,
  sourceIsStale,
  yahooBarIsOpen,
} = require("../api/_lib");

const visibleStrategyKeys = ["qqq", "signalQqq", "tqqq", "signalTqqq", "signal"];
const allStrategyKeys = ["qqq", "tqqq", "blend8020", "signal", "signalQqq", "signalTqqq"];
const auditedStarts = ["1990-01", "1995-01", "2000-01", "2005-01", "2010-01", "2015-01", "2020-01", "2023-01", "2024-01", "2025-01"];

function assertFinite(value, label) {
  assert(Number.isFinite(value), label);
}

function assertBacktestResult(result, start) {
  assert.equal(result.rulesetId, RULESET_ID);
  assert.match(result.dataSnapshotId, /^snapshot-[a-f0-9]{16}$/);
  assert.equal(result.costBps, DEFAULT_COST_BPS);
  assert.equal(result.executionLag, "nextTradingSession");
  assert.equal(result.coreQqqHighRegimeFraction, CORE_QQQ_HIGH_REGIME_FRACTION);
  assert.equal(result.mainSignalPolicy, MAIN_SIGNAL_POLICY_KEY);
  assert.deepEqual(result.strategies.map((strategy) => strategy.key), allStrategyKeys);
  assert(result.dataQuality.qqqActualStart);
  assert(result.dataQuality.tqqqActualStart);
  assert(result.dataQuality.qqq.count > 1000);
  assert(result.dataQuality.tqqq.count > 1000);
  assert.equal(result.sensitivity.points.length, 9);
  assert(result.sensitivity.minFinalValue <= result.sensitivity.maxFinalValue);
  assert(result.sensitivity.points.every((point) => (
    Number.isFinite(point.finalValue)
    && point.finalValue > 0
    && Number.isFinite(point.drawdownThreshold)
    && Number.isFinite(point.panicVixThreshold)
    && Number.isFinite(point.bottomAttackCount)
  )));
  assert(result.headline);
  assert(result.headline.signalVsQqq);
  assert(result.headline.scopeStart >= result.dataQuality.tqqqActualStart);
  assert(result.headline.allocationMatched?.diagnostic);
  assertFinite(result.headline.signalVsQqq.finalRelativeMultiple, `${start} headline relative multiple`);
  assertFinite(result.headline.signalVsQqq.maxRelativeDrawdown, `${start} headline relative drawdown`);
  assertFinite(result.headline.signalVsQqq.longestRelativeUnderwaterMonths, `${start} headline underwater months`);
  assertFinite(result.headline.allocationMatched.signalVsStatic.finalRelativeMultiple, `${start} allocation-matched relative multiple`);

  const strategies = Object.fromEntries(result.strategies.map((strategy) => [strategy.key, strategy]));
  for (const key of visibleStrategyKeys) {
    const strategy = strategies[key];
    assert(strategy.finalValue > 0, `${start} ${key} finalValue`);
    assert(strategy.points.length > 0, `${start} ${key} points`);
    assert.equal(strategy.points.length, strategies.qqq.points.length, `${start} ${key} point count`);
    assert(strategy.points.every((point) => (
      Number.isFinite(point.value)
      && point.value > 0
      && Number.isFinite(point.nav)
      && point.nav > 0
      && Math.abs((point.cashWeight + point.qqqWeight + point.tqqqWeight) - 1) < 1e-8
      && Number.isFinite(point.fees)
      && "qqqPrice" in point
    )), `${start} ${key} point validity`);
    assert(strategy.maxDrawdown <= 0 && strategy.maxDrawdown >= -1, `${start} ${key} drawdown`);
    if (strategy.points.at(-1).year >= 3) assertFinite(strategy.regression.annualized, `${start} ${key} regression`);
    if (key !== "qqq") {
      assert(strategy.vsQqq, `${start} ${key} vsQqq`);
      assertFinite(strategy.vsQqq.finalRelativeMultiple, `${start} ${key} vsQqq multiple`);
    }
    assert.equal(strategy.risk.sharpeType, "monthlyExcessReturnOverCash");
  }

  assert(strategies.signalQqq.points.every((point) => point.tqqqValue === 0), `${start} signalQqq tqqqValue`);
  assert(strategies.signalTqqq.points.every((point) => point.qqqValue === 0), `${start} signalTqqq qqqValue`);
  for (const key of ["signal", "signalQqq", "signalTqqq"]) {
    const strategy = strategies[key];
    const actionCount = Object.values(strategy.actionCounts).reduce((sum, count) => sum + count, 0);
    assert(actionCount <= strategy.points.length, `${start} ${key} monthly action count`);
    assert(strategy.points.filter((point) => point.actionKey).every((point) => (
      point.actionDecisionDate && point.actionExecutionDate && point.actionExecutionDate > point.actionDecisionDate
    )), `${start} ${key} next-session execution`);
  }

  assert(result.events.length >= (start === "2025-01" ? 1 : 2), `${start} events`);
  for (const event of result.events) {
    assert(event.strategies.length >= 2, `${start} ${event.key} event strategies`);
    for (const strategy of event.strategies) {
      assertFinite(strategy.startNav, `${start} ${event.key} ${strategy.key} startNav`);
      assertFinite(strategy.endNav, `${start} ${event.key} ${strategy.key} endNav`);
      assertFinite(strategy.returnPct, `${start} ${event.key} ${strategy.key} returnPct`);
      assert(strategy.maxDrawdown <= 0 && strategy.maxDrawdown >= -1, `${start} ${event.key} ${strategy.key} maxDrawdown`);
      if (strategy.actionCounts) {
        const count = Object.values(strategy.actionCounts).reduce((sum, value) => sum + value, 0);
        assert(count <= strategies[strategy.key].points.length, `${start} ${event.key} ${strategy.key} actionCounts`);
      }
    }
  }

  const expectedWalkForward = ["2010-01-01", "2015-01-01", "2020-01-01", "2025-01-01"]
    .filter((split) => split > result.start && split < result.end).length;
  assert.equal(result.walkForward.length, expectedWalkForward);
  for (const row of result.walkForward) {
    assert(row.split > result.start, `${start} ${row.split} split`);
    assert(row.validationEnd >= row.validationStart, `${start} ${row.split} validation window`);
    assertFinite(row.trainFinalValue, `${start} ${row.split} trainFinalValue`);
    assertFinite(row.validationFinalValue, `${start} ${row.split} validationFinalValue`);
    assertFinite(row.defaultValidationFinalValue, `${start} ${row.split} defaultValidationFinalValue`);
    assert(row.trainFinalValue > 0 && row.validationFinalValue > 0 && row.defaultValidationFinalValue > 0, `${start} ${row.split} validation values`);
    assertFinite(row.defaultValidationVsQqq, `${start} ${row.split} defaultValidationVsQqq`);
  }

  assert(result.modelNotes.tqqqHoldingCosts.includes("does not create daily broker margin calls"));
  assert(result.modelNotes.cadence.includes("next trading session"));
  assert(result.modelNotes.sharpe.includes("excess returns"));
  assert(result.modelNotes.limits.includes("design choice"));
  assert(result.modelNotes.limits.includes("standard TQQQ limits"));
  assert.equal(result.dataQuality.sourceMode, "versionedSnapshots");
  assert.equal(result.dataQuality.capePointInTime, false);
  assert(result.modelNotes.notAdvice);
  assert(result.modelNotes.cadence);
  return strategies;
}

async function main() {
  assert.equal(RULESET_ID, "2026-07-v6");
  assert.equal(MAIN_SIGNAL_POLICY_KEY, "standard");
  assert.equal(DEFAULT_COST_BPS, 5);
  assert.equal(CORE_QQQ_HIGH_REGIME_FRACTION, 0.5);
  assert.equal(DEFAULT_THRESHOLDS.cheapCape, 35);
  assert.equal(DEFAULT_THRESHOLDS.panicVix, 32);

  assert.equal(calculateDecision({ capePercentile: 10, drawdownPct: -35, crash25dPct: -3, vix: 45 }).key, "bottomAttack");
  // Deep drawdown alone is a buy lean, not an automatic crash sell.
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -25, crash25dPct: -13, vix: 18 }).key, "smallDipBuy");
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -25, crash25dPct: -3, vix: 18 }).key, "smallDipBuy");
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -10, crash25dPct: -13, vix: 18 }).key, "crashDefense");
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -14, crash25dPct: -13, vix: 18 }).key, "crashDefense");
  assert.equal(calculateDecision({ capePercentile: 80, drawdownPct: -3, crash25dPct: -3, vix: 18 }, { heatMonths: 0 }).key, "pauseAtHigh");
  assert.equal(calculateDecision({ capePercentile: 90, drawdownPct: -3, crash25dPct: -3, vix: 18 }, { heatMonths: 6 }).key, "trimHeat");
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -8, crash25dPct: -3, vix: 18 }, { rampMonths: 2 }).key, "rampTqqq");
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -8, crash25dPct: -3, vix: 18 }).key, "normalDca");
  // Quiet VIX alone must not force pause.
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -8, crash25dPct: -3, vix: 11 }).key, "normalDca");
  // Mild drawdown is a soft small-dip cue.
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -14, crash25dPct: -3, vix: 18 }).key, "smallDipBuy");
  // Valuation support + deep drawdown can form a bottom without classic cheap CAPE.
  assert.equal(calculateDecision({ capePercentile: 45, drawdownPct: -28, crash25dPct: -3, vix: 18 }).key, "bottomAttack");

  const confidence = decisionConfidence(
    calculateDecision({ capePercentile: 10, drawdownPct: -35, crash25dPct: -3, vix: 45 }),
    { capePercentile: 10, drawdownPct: -35, crash25dPct: -3, vix: 45 },
  );
  assert.equal(confidence.level, "high");
  assert.equal(confidence.calibrated, false);
  assert.equal("score" in confidence, false);

  const cape = parseCapeTable('<tr><td class="left">Jan 1, 2024</td><td class="right">33.3&nbsp;</td></tr>');
  assert.equal(cape.length, 1);
  assert.equal(cape[0].value, 33.3);
  assert.equal(capeSeriesForBacktest([{ date: "2024-01-01", value: 33.3 }])[0].date, "2024-02-01");
  const now = Date.parse("2026-07-10T00:00:00Z");
  assert.equal(sourceIsStale("qqq", [{ date: "2026-07-09" }], now), false);
  assert.equal(sourceIsStale("qqq", [{ date: "2026-07-01" }], now), true);
  assert.equal(yahooBarIsOpen(150, { start: 100, end: 200 }, 160), true);
  assert.equal(yahooBarIsOpen(150, { start: 100, end: 200 }, 210), false);

  const appJs = fs.readFileSync(path.join(__dirname, "../assets/app.js"), "utf8");
  const exportCsvBody = appJs.slice(appJs.indexOf("function exportCsv()"), appJs.indexOf("async function copyShareLink"));
  assert(appJs.includes('const visibleStrategyKeys = ["qqq", "signalQqq", "tqqq", "signalTqqq", "signal"];'));
  assert(appJs.includes("rampTqqq: ["));
  assert(appJs.includes("ExecutionPlanner.planOrders"));
  assert(exportCsvBody.includes("visibleStrategies()"));
  assert(!exportCsvBody.includes("backtestData.strategies"));

  const deterministic = await backtest({ start: "2010-01", cost: 5 });
  assertBacktestResult(deterministic, "2010-01");
  assert(deterministic.headline.syntheticExcluded);
  const averageAllocation = deterministic.headline.allocationMatched.averageAllocation;
  assert(averageAllocation.cashWeight >= 0 && averageAllocation.qqqWeight >= 0 && averageAllocation.tqqqWeight >= 0);
  assert(Math.abs(averageAllocation.cashWeight + averageAllocation.qqqWeight + averageAllocation.tqqqWeight - 1) < 1e-6);

  if (process.env.LIVE === "1") {
    const market = await marketSnapshot();
    assert(market.indicators.cape.percentile > 0);
    assert(market.indicators.nasdaq100.level5dAvg > 0);
    assert(market.dataQuality.qqq.count > 1000);
    assert(market.dataQuality.tqqq.count > 1000);
    assert(market.decision.key);
    assert(market.decision.confidence);
    assert.equal(market.decision.confidence.calibrated, false);
    assert.equal(market.rulesetId, RULESET_ID);
    assert.equal(market.mainSignalPolicy, MAIN_SIGNAL_POLICY_KEY);
    assert.match(market.dataSnapshotId, /^snapshot-[a-f0-9]{16}$/);
    assert(market.quotes.qqq.price > 0 && market.quotes.tqqq.price > 0);
    assert.equal(market.riskPolicies.standard.maxTqqq, 0.4);
    assert(market.lockedDecision.key);
    assert(market.liveDecision.key);
    assert(Array.isArray(market.decisionHistory));
    assert(market.decisionHistory.length > 0);
  }

  for (const start of auditedStarts) {
    const result = start === "2010-01" ? deterministic : await backtest({ start });
    const strategies = start === "2010-01" ? Object.fromEntries(result.strategies.map((strategy) => [strategy.key, strategy])) : assertBacktestResult(result, start);
    if (start === "1990-01") {
      assert(strategies.signal.actionCounts.crashDefense >= 1, "full history should exercise crashDefense");
      const crossMonth = strategies.signal.points.find((point) => point.actionDecisionDate === "1997-10-31");
      assert.equal(crossMonth?.actionExecutionDate, "1997-11-03", "month-end decisions must execute next session");
    }
    if (start === "2020-01") {
      assert(strategies.signal.actionCounts.bottomAttack >= 1, "2020 sample should capture at least one bottom/upgrade");
    }
    if (start === "2010-01") {
      assert(strategies.signal.actionCounts.bottomAttack >= 1, "2010+ should retain bottomAttack coverage");
      assert(strategies.signal.vsQqq.finalRelativeMultiple > 0.8, "signal should remain in the same ballpark or better vs QQQ over long samples");
    }
  }

  console.log("check ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
