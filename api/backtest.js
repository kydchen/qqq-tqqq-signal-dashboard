const { backtest, sendJson } = require("./_lib");

module.exports = async function handler(req, res) {
  try {
    sendJson(res, 200, await backtest(req.query || {}));
  } catch (error) {
    const status = error.statusCode || 502;
    if (status >= 500) console.error(error);
    sendJson(res, status, { error: status >= 500 ? "Market data source is temporarily unavailable." : error.message });
  }
};
