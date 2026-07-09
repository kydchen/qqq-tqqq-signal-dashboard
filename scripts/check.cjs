const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { backtest, calculateDecision, marketSnapshot, parseCapeTable } = require("../api/_lib");

const visibleStrategyKeys = ["qqq", "signalQqq", "tqqq", "signalTqqq", "signal"];
const allStrategyKeys = ["qqq", "tqqq", "blend8020", "signal", "signalQqq", "signalTqqq"];
const auditedStarts = ["1990-01", "1995-01", "2000-01", "2005-01", "2010-01", "2015-01", "2020-01", "2025-01"];

function assertFinite(value, label) {
  assert(Number.isFinite(value), label);
}

function assertBacktestResult(result, start) {
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
      && "qqqPrice" in point
    )), `${start} ${key} point validity`);
    assert(strategy.maxDrawdown <= 0 && strategy.maxDrawdown >= -1, `${start} ${key} drawdown`);
    if (strategy.points.at(-1).year >= 3) assertFinite(strategy.regression.annualized, `${start} ${key} regression`);
  }

  assert(strategies.signalQqq.points.every((point) => point.tqqqValue === 0), `${start} signalQqq tqqqValue`);
  assert(strategies.signalTqqq.points.every((point) => point.qqqValue === 0), `${start} signalTqqq qqqValue`);
  for (const key of ["signal", "signalQqq", "signalTqqq"]) {
    const strategy = strategies[key];
    const actionCount = Object.values(strategy.actionCounts).reduce((sum, count) => sum + count, 0);
    assert(actionCount <= strategy.points.length, `${start} ${key} monthly action count`);
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

  assert.equal(result.walkForward.length, ["2025-01"].includes(start) ? 0 : ["2020-01"].includes(start) ? 1 : ["2015-01"].includes(start) ? 2 : ["2010-01"].includes(start) ? 3 : 4);
  for (const row of result.walkForward) {
    assert(row.split > result.start, `${start} ${row.split} split`);
    assert(row.validationEnd >= row.validationStart, `${start} ${row.split} validation window`);
    assertFinite(row.trainFinalValue, `${start} ${row.split} trainFinalValue`);
    assertFinite(row.validationFinalValue, `${start} ${row.split} validationFinalValue`);
    assertFinite(row.defaultValidationFinalValue, `${start} ${row.split} defaultValidationFinalValue`);
    assert(row.trainFinalValue > 0 && row.validationFinalValue > 0 && row.defaultValidationFinalValue > 0, `${start} ${row.split} validation values`);
  }

  assert(result.modelNotes.tqqqHoldingCosts.includes("does not create daily broker margin calls"));
  return strategies;
}

async function main() {
  assert.equal(calculateDecision({ capePercentile: 10, drawdownPct: -35, crash25dPct: -3, vix: 45 }).key, "bottomAttack");
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -25, crash25dPct: -13, vix: 18 }).key, "crashDefense");
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -25, crash25dPct: -3, vix: 18 }).key, "smallDipBuy");
  assert.equal(calculateDecision({ capePercentile: 80, drawdownPct: -3, crash25dPct: -3, vix: 18 }, { heatMonths: 0 }).key, "pauseAtHigh");
  assert.equal(calculateDecision({ capePercentile: 90, drawdownPct: -3, crash25dPct: -3, vix: 18 }, { heatMonths: 6 }).key, "trimHeat");
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -8, crash25dPct: -3, vix: 18 }, { rampMonths: 2 }).key, "rampTqqq");
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -8, crash25dPct: -3, vix: 18 }).key, "normalDca");

  const cape = parseCapeTable('<tr><td class="left">Jan 1, 2024</td><td class="right">33.3&nbsp;</td></tr>');
  assert.equal(cape.length, 1);
  assert.equal(cape[0].value, 33.3);

  const appJs = fs.readFileSync(path.join(__dirname, "../assets/app.js"), "utf8");
  const exportCsvBody = appJs.slice(appJs.indexOf("function exportCsv()"), appJs.indexOf("async function copyShareLink"));
  assert(appJs.includes('const visibleStrategyKeys = ["qqq", "signalQqq", "tqqq", "signalTqqq", "signal"];'));
  assert(exportCsvBody.includes("visibleStrategies()"));
  assert(!exportCsvBody.includes("backtestData.strategies"));

  if (process.env.LIVE === "1") {
    const market = await marketSnapshot();
    assert(market.indicators.cape.percentile > 0);
    assert(market.indicators.nasdaq100.level5dAvg > 0);
    assert(market.dataQuality.qqq.count > 1000);
    assert(market.dataQuality.tqqq.count > 1000);
    for (const start of auditedStarts) {
      const result = await backtest({ start });
      const strategies = assertBacktestResult(result, start);
      if (start === "2020-01") {
        assert(strategies.signal.actionStats.normalDca.count >= 0);
        const sellActions = new Set(["crashDefense", "trimHeat"]);
        assert(strategies.signalQqq.points.some((point, index, points) => (
          index > 0 && sellActions.has(point.actionKey) && point.cash > points[index - 1].cash + result.monthly && point.qqqValue < points[index - 1].qqqValue
        )));
        assert(strategies.signalTqqq.points.some((point, index, points) => (
          index > 0 && sellActions.has(point.actionKey) && point.cash > points[index - 1].cash + result.monthly && point.tqqqValue < points[index - 1].tqqqValue
        )));
      }
    }
  }

  console.log("check ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
