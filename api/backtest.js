const { backtest, sendJson } = require("./_lib");

module.exports = async function handler(req, res) {
  try {
    sendJson(res, 200, await backtest(req.query || {}));
  } catch (error) {
    sendJson(res, 502, { error: error.message });
  }
};
