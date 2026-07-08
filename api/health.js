const { fetchText, fetchYahooSeries, parseCapeTable, sendJson } = require("./_lib");

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
  const checks = await Promise.all([
    check("Yahoo ^NDX", async () => {
      const rows = await fetchYahooSeries("^NDX", "Nasdaq-100");
      return { rows: rows.length, latest: rows.at(-1) };
    }),
    check("Yahoo ^VIX", async () => {
      const rows = await fetchYahooSeries("^VIX", "VIX");
      return { rows: rows.length, latest: rows.at(-1) };
    }),
    check("Multpl CAPE", async () => {
      const rows = parseCapeTable(await fetchText("https://www.multpl.com/shiller-pe/table/by-month"));
      return { rows: rows.length, latest: rows[0] };
    }),
  ]);
  sendJson(res, checks.every((item) => item.ok) ? 200 : 207, {
    ok: checks.every((item) => item.ok),
    generatedAt: new Date().toISOString(),
    checks,
  });
};
