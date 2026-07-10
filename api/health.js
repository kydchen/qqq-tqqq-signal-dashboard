const { loadData, sendJson } = require("./_lib");

async function check(name, run) {
  const started = Date.now();
  try {
    const result = await run();
    return { name, ok: true, ms: Date.now() - started, ...result };
  } catch (error) {
    return { name, ok: false, ms: Date.now() - started, error: error.message };
  }
}

module.exports = async function handler(req, res) {
  const checks = [await check("Shared market data", async () => {
    const data = await loadData();
    return {
      ok: data.staleSources.length === 0,
      staleSources: data.staleSources,
      fallbackSources: data.fallbackSources,
      sourceLagDays: data.sourceLagDays,
      nasdaqLatest: data.nasdaq.at(-1),
      qqqLatest: data.qqq.at(-1),
      tqqqLatest: data.tqqq.at(-1),
      vixLatest: data.vix.at(-1),
      ratesLatest: data.rates.at(-1),
      capeLatest: data.capeLatestFirst[0],
    };
  })];
  const ok = checks.every((item) => item.ok);
  sendJson(res, ok ? 200 : 503, {
    ok,
    generatedAt: new Date().toISOString(),
    checks,
  }, { cache: false });
};
