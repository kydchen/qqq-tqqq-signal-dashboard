const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { backtest, calculateDecision, marketSnapshot, parseCapeTable } = require("../api/_lib");

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
    const result = await backtest({ start: "2020-01" });
    assert.deepEqual(result.strategies.map((strategy) => strategy.key), ["qqq", "tqqq", "blend8020", "signal", "signalQqq", "signalTqqq"]);
    assert(result.sensitivity.points.length === 9);
    assert(result.events.length >= 2);
    assert(result.walkForward.length >= 1);
    assert(result.dataQuality.qqqActualStart);
    assert(result.dataQuality.tqqqActualStart);
    for (const strategy of result.strategies) {
      assert(strategy.finalValue > 0);
      assert(strategy.points.length > 12);
      assert("cashWeight" in strategy.points.at(-1));
      assert("qqqPrice" in strategy.points.at(-1));
    }
    const signal = result.strategies.find((strategy) => strategy.key === "signal");
    assert(signal.actionStats.normalDca.count >= 0);
    const signalQqq = result.strategies.find((strategy) => strategy.key === "signalQqq");
    const signalTqqq = result.strategies.find((strategy) => strategy.key === "signalTqqq");
    assert(signalQqq.points.every((point) => point.tqqqValue === 0));
    assert(signalTqqq.points.every((point) => point.qqqValue === 0));
    const sellActions = new Set(["crashDefense", "trimHeat"]);
    assert(signalQqq.points.some((point, index, points) => (
      index > 0 && sellActions.has(point.actionKey) && point.cash > points[index - 1].cash + result.monthly && point.qqqValue < points[index - 1].qqqValue
    )));
    assert(signalTqqq.points.some((point, index, points) => (
      index > 0 && sellActions.has(point.actionKey) && point.cash > points[index - 1].cash + result.monthly && point.tqqqValue < points[index - 1].tqqqValue
    )));
  }

  console.log("check ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
