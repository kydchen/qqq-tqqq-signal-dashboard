const fs = require("fs");
const path = require("path");
const { fetchText, fetchYahooSeries, parseCapeTable } = require("../api/_lib");

async function main() {
  const dir = path.join(__dirname, "..", "data");
  fs.mkdirSync(dir, { recursive: true });

  const [ndx, qqq, vix, capeText] = await Promise.all([
    fetchYahooSeries("^NDX", "Nasdaq-100"),
    fetchYahooSeries("QQQ", "QQQ"),
    fetchYahooSeries("^VIX", "VIX"),
    fetchText("https://www.multpl.com/shiller-pe/table/by-month"),
  ]);

  fs.writeFileSync(path.join(dir, "ndx-snapshot.json"), JSON.stringify(ndx));
  fs.writeFileSync(path.join(dir, "qqq-snapshot.json"), JSON.stringify(qqq));
  fs.writeFileSync(path.join(dir, "vix-snapshot.json"), JSON.stringify(vix));
  fs.writeFileSync(path.join(dir, "cape-snapshot.json"), JSON.stringify(parseCapeTable(capeText)));
  console.log(`updated snapshots: ndx=${ndx.length}, qqq=${qqq.length}, vix=${vix.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
