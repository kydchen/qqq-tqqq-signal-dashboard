const fs = require("fs");
const path = require("path");
const { fetchFredSeries, fetchText, fetchYahooSeries, parseCapeTable } = require("../api/_lib");

async function main() {
  const dir = path.join(__dirname, "..", "data");
  fs.mkdirSync(dir, { recursive: true });

  const [ndx, qqq, tqqq, vix, rates, capeText] = await Promise.all([
    fetchYahooSeries("^NDX", "Nasdaq-100"),
    fetchYahooSeries("QQQ", "QQQ", { adjusted: true }),
    fetchYahooSeries("TQQQ", "TQQQ", { adjusted: true }),
    fetchYahooSeries("^VIX", "VIX"),
    fetchFredSeries("FEDFUNDS"),
    fetchText("https://www.multpl.com/shiller-pe/table/by-month"),
  ]);

  fs.writeFileSync(path.join(dir, "ndx-snapshot.json"), JSON.stringify(ndx));
  fs.writeFileSync(path.join(dir, "qqq-snapshot.json"), JSON.stringify(qqq));
  fs.writeFileSync(path.join(dir, "tqqq-snapshot.json"), JSON.stringify(tqqq));
  fs.writeFileSync(path.join(dir, "vix-snapshot.json"), JSON.stringify(vix));
  fs.writeFileSync(path.join(dir, "rates-snapshot.json"), JSON.stringify(rates));
  fs.writeFileSync(path.join(dir, "cape-snapshot.json"), JSON.stringify(parseCapeTable(capeText)));
  console.log(`updated snapshots: ndx=${ndx.length}, qqq=${qqq.length}, tqqq=${tqqq.length}, vix=${vix.length}, rates=${rates.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
