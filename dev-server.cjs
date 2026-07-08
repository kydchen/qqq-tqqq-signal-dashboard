const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const root = __dirname;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, body) => {
    if (err) {
      res.statusCode = err.code === "ENOENT" ? 404 : 500;
      res.end(err.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", mime[path.extname(filePath)] || "application/octet-stream");
    res.end(body);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  req.query = parsed.query;
  if (parsed.pathname === "/api/market") return require("./api/market")(req, res);
  if (parsed.pathname === "/api/backtest") return require("./api/backtest")(req, res);
  if (parsed.pathname === "/api/health") return require("./api/health")(req, res);
  const requested = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  let pathname;
  try {
    pathname = decodeURIComponent(requested);
  } catch {
    res.statusCode = 400;
    res.end("Bad request");
    return;
  }
  if (pathname.startsWith("/.git/")) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  const filePath = path.normalize(path.join(root, pathname));
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  serveFile(res, filePath);
});

const port = Number(process.env.PORT || 8765);
server.listen(port, "127.0.0.1", () => {
  console.log(`Serving http://127.0.0.1:${port}`);
});
