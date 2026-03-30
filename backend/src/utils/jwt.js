const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

function signSessionToken(payload) {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtTtl,
    issuer: "ma-sante-en-chaine"
  });
}

function verifySessionToken(token) {
  return jwt.verify(token, env.jwtSecret, {
    issuer: "ma-sante-en-chaine"
  });
}

module.exports = {
  signSessionToken,
  verifySessionToken
};
