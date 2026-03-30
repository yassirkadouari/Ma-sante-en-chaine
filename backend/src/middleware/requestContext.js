const crypto = require("crypto");

function attachRequestContext(req, res, next) {
  req.requestId = crypto.randomUUID();
  return next();
}

module.exports = { attachRequestContext };
