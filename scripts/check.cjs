const assert = require("assert");
const { backtest, calculateDecision, marketSnapshot } = require("../api/_lib");

async function main() {
  assert.equal(calculateDecision({ capePercentile: 10, drawdownPct: -35, crash25dPct: -3, vix: 45 }).key, "bottomAttack");
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -25, crash25dPct: -3, vix: 18 }).key, "smallDipBuy");
  assert.equal(calculateDecision({ capePercentile: 80, drawdownPct: -3, crash25dPct: -3, vix: 18 }).key, "pauseAtHigh");
  assert.equal(calculateDecision({ capePercentile: 90, drawdownPct: -3, crash25dPct: -3, vix: 18 }).key, "trimHeat");
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -8, crash25dPct: -13, vix: 18 }).key, "crashDefense");
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -8, crash25dPct: -3, vix: 18 }).key, "normalDca");

  const market = await marketSnapshot();
  assert(market.indicators.cape.percentile > 0);
  assert(market.indicators.nasdaq100.level5dAvg > 0);

  const result = await backtest({ start: "2020-01", monthly: "1000" });
  assert.equal(result.strategies.length, 4);
  for (const strategy of result.strategies) {
    assert(strategy.finalValue > 0);
    assert(strategy.points.length > 12);
    assert(Number.isFinite(strategy.regression.annualized));
  }
  assert(result.strategies.find((strategy) => strategy.key === "signal").points.every((point) => point.actionKey));
  console.log("check ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
