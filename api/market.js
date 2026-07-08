const { marketSnapshot, sendJson } = require("./_lib");

module.exports = async function handler(req, res) {
  try {
    sendJson(res, 200, await marketSnapshot());
  } catch (error) {
    console.error(error);
    sendJson(res, 502, { error: "Market data source is temporarily unavailable." });
  }
};
