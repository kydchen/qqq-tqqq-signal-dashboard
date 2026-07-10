const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { backtest, calculateDecision, decisionConfidence, marketSnapshot, parseCapeTable, DEFAULT_THRESHOLDS } = require("../api/_lib");

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
  assert(result.headline);
  assert(result.headline.signalVsQqq);
  assertFinite(result.headline.signalVsQqq.finalRelativeMultiple, `${start} headline relative multiple`);

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
    if (key !== "qqq") {
      assert(strategy.vsQqq, `${start} ${key} vsQqq`);
      assertFinite(strategy.vsQqq.finalRelativeMultiple, `${start} ${key} vsQqq multiple`);
    }
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
    assertFinite(row.defaultValidationVsQqq, `${start} ${row.split} defaultValidationVsQqq`);
  }

  assert(result.modelNotes.tqqqHoldingCosts.includes("does not create daily broker margin calls"));
  assert(result.modelNotes.notAdvice);
  assert(result.modelNotes.cadence);
  return strategies;
}

async function main() {
  assert.equal(DEFAULT_THRESHOLDS.cheapCape, 35);
  assert.equal(DEFAULT_THRESHOLDS.panicVix, 32);

  assert.equal(calculateDecision({ capePercentile: 10, drawdownPct: -35, crash25dPct: -3, vix: 45 }).key, "bottomAttack");
  // Deep drawdown alone is a buy lean, not an automatic crash sell.
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -25, crash25dPct: -13, vix: 18 }).key, "smallDipBuy");
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -25, crash25dPct: -3, vix: 18 }).key, "smallDipBuy");
  assert.equal(calculateDecision({ capePercentile: 50, drawdownPct: -10, crash25dPct: -13, vix: 18 }).key, "crashDefense");
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

  const cape = parseCapeTable('<tr><td class="left">Jan 1, 2024</td><td class="right">33.3&nbsp;</td></tr>');
  assert.equal(cape.length, 1);
  assert.equal(cape[0].value, 33.3);

  const appJs = fs.readFileSync(path.join(__dirname, "../assets/app.js"), "utf8");
  const exportCsvBody = appJs.slice(appJs.indexOf("function exportCsv()"), appJs.indexOf("async function copyShareLink"));
  assert(appJs.includes('const visibleStrategyKeys = ["qqq", "signalQqq", "tqqq", "signalTqqq", "signal"];'));
  assert(appJs.includes("rampTqqq: ["));
  assert(exportCsvBody.includes("visibleStrategies()"));
  assert(!exportCsvBody.includes("backtestData.strategies"));

  if (process.env.LIVE === "1") {
    const market = await marketSnapshot();
    assert(market.indicators.cape.percentile > 0);
    assert(market.indicators.nasdaq100.level5dAvg > 0);
    assert(market.dataQuality.qqq.count > 1000);
    assert(market.dataQuality.tqqq.count > 1000);
    assert(market.decision.key);
    assert(market.decision.confidence);
    assert(market.lockedDecision.key);
    assert(market.liveDecision.key);
    assert(Array.isArray(market.decisionHistory));
    assert(market.decisionHistory.length > 0);
    for (const start of auditedStarts) {
      const result = await backtest({ start });
      const strategies = assertBacktestResult(result, start);
      if (start === "2020-01") {
        assert(strategies.signal.actionStats.normalDca.count >= 0);
        assert(strategies.signal.actionCounts.bottomAttack >= 1, "2020 sample should capture at least one bottom/upgrade");
        // Risk sells can be rare under buy-leaning priority. If present, cash should rise.
        const sellActions = new Set(["crashDefense", "trimHeat"]);
        const hasSell = strategies.signal.points.some((point) => sellActions.has(point.actionKey));
        if (hasSell) {
          assert(strategies.signal.points.some((point, index, points) => (
            index > 0 && sellActions.has(point.actionKey) && point.cash >= points[index - 1].cash
          )));
        }
      }
      if (start === "2010-01") {
        assert(strategies.signal.actionCounts.bottomAttack >= 1, "2010+ should no longer have a dead bottomAttack rule");
        assert(strategies.signal.vsQqq.finalRelativeMultiple > 0.8, "signal should remain in the same ballpark or better vs QQQ over long samples");
      }
    }
  }

  console.log("check ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
