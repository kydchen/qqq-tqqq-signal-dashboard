const fs = require("fs");
const path = require("path");
const { fetchFredSeries, fetchText, fetchYahooSeries, parseCapeTable } = require("../api/_lib");

function validateSeries(name, points, current, descending = false) {
  if (!Array.isArray(points) || points.length < 60) throw new Error(`${name} returned too few observations`);
  for (let i = 1; i < points.length; i += 1) {
    const ordered = descending ? points[i - 1].date > points[i].date : points[i - 1].date < points[i].date;
    if (!ordered) throw new Error(`${name} dates are not strictly ${descending ? "descending" : "ascending"}`);
  }
  if (Array.isArray(current) && current.length >= 60 && points.length < current.length * 0.95) {
    throw new Error(`${name} history shrank from ${current.length} to ${points.length}`);
  }
}

function readSnapshot(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; }
}

async function main() {
  const dir = path.join(__dirname, "..", "data");
  fs.mkdirSync(dir, { recursive: true });

  const [ndx, qqq, tqqq, vix, rates, capeText] = await Promise.all([
    fetchYahooSeries("^NDX", "Nasdaq-100"),
    fetchYahooSeries("QQQ", "QQQ", { adjusted: true }),
    fetchYahooSeries("TQQQ", "TQQQ", { adjusted: true }),
    fetchYahooSeries("^VIX", "VIX"),
    fetchFredSeries("FEDFUNDS"),
    fetchText("https://www.multpl.com/shiller-pe/table/by-month", 6000, { "User-Agent": "Mozilla/5.0" }),
  ]);
  const cape = parseCapeTable(capeText);
  const snapshots = [
    ["ndx-snapshot.json", "NDX", ndx, false],
    ["qqq-snapshot.json", "QQQ", qqq, false],
    ["tqqq-snapshot.json", "TQQQ", tqqq, false],
    ["vix-snapshot.json", "VIX", vix, false],
    ["rates-snapshot.json", "FEDFUNDS", rates, false],
    ["cape-snapshot.json", "CAPE", cape, true],
  ];
  for (const [file, name, points, descending] of snapshots) {
    validateSeries(name, points, readSnapshot(path.join(dir, file)), descending);
  }
  for (const [file, , points] of snapshots) fs.writeFileSync(path.join(dir, `${file}.tmp`), JSON.stringify(points));
  for (const [file] of snapshots) fs.renameSync(path.join(dir, `${file}.tmp`), path.join(dir, file));
  console.log(`updated snapshots: ndx=${ndx.length}, qqq=${qqq.length}, tqqq=${tqqq.length}, vix=${vix.length}, rates=${rates.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
