const { cryptoWaitReady, signatureVerify } = require("@polkadot/util-crypto");
const { canonicalize, sha256Hex } = require("./hash");

let cryptoReadyPromise;

async function ensureCryptoReady() {
  if (!cryptoReadyPromise) {
    cryptoReadyPromise = cryptoWaitReady();
  }
  await cryptoReadyPromise;
}

function normalizeWallet(address) {
  return String(address || "").trim();
}

async function verifyWalletMessage({ address, message, signature }) {
  await ensureCryptoReady();
  const result = signatureVerify(message, signature, address);
  return Boolean(result.isValid);
}

function buildRequestMessage({ method, path, timestamp, nonce, bodyHash }) {
  return [
    "MaSanteEnChaine Signed Request",
    `method:${method.toUpperCase()}`,
    `path:${path}`,
    `timestamp:${timestamp}`,
    `nonce:${nonce}`,
    `bodyHash:${bodyHash}`
  ].join("\n");
}

function hashBody(body) {
  return sha256Hex(canonicalize(body || {}));
}

module.exports = {
  normalizeWallet,
  verifyWalletMessage,
  buildRequestMessage,
  hashBody
};
