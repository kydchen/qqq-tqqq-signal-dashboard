const { fetchText, parseCapeTable, parseFredCsv, sendJson } = require("./_lib");

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
    check("FRED NASDAQ100", async () => {
      const rows = parseFredCsv(await fetchText("https://fred.stlouisfed.org/graph/fredgraph.csv?id=NASDAQ100"), "NASDAQ100");
      return { rows: rows.length, latest: rows.at(-1) };
    }),
    check("FRED VIXCLS", async () => {
      const rows = parseFredCsv(await fetchText("https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS"), "VIXCLS");
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
