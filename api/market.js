const { marketSnapshot, sendJson } = require("./_lib");

module.exports = async function handler(req, res) {
  try {
    sendJson(res, 200, await marketSnapshot());
  } catch (error) {
    sendJson(res, 502, { error: error.message });
  }
};
