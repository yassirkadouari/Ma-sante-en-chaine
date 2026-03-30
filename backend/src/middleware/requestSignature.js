const RequestNonce = require("../models/RequestNonce");
const { env } = require("../config/env");
const { buildRequestMessage, hashBody, normalizeWallet, verifyWalletMessage } = require("../utils/signature");

async function requireSignedRequest(req, res, next) {
  try {
    if (!req.auth) {
      return res.status(500).json({ error: "Auth middleware required before signed request middleware" });
    }

    const walletAddress = req.header("x-msce-wallet");
    const signature = req.header("x-msce-signature");
    const nonce = req.header("x-msce-nonce");
    const timestamp = req.header("x-msce-timestamp");

    if (!walletAddress || !signature || !nonce || !timestamp) {
      return res.status(401).json({ error: "Missing signed request headers" });
    }

    if (normalizeWallet(walletAddress) !== normalizeWallet(req.auth.walletAddress)) {
      return res.status(401).json({ error: "Wallet header does not match JWT identity" });
    }

    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs)) {
      return res.status(400).json({ error: "Invalid request timestamp" });
    }

    const now = Date.now();
    if (Math.abs(now - timestampMs) > env.requestSkewSeconds * 1000) {
      return res.status(401).json({ error: "Signed request timestamp outside allowed window" });
    }

    const bodyHash = hashBody(req.body || {});
    const normalizedPath = (req.originalUrl || req.path || "").split("?")[0];
    const message = buildRequestMessage({
      method: req.method,
      path: normalizedPath,
      timestamp: String(timestampMs),
      nonce,
      bodyHash
    });

    const valid = await verifyWalletMessage({
      address: walletAddress,
      message,
      signature
    });

    if (!valid) {
      return res.status(401).json({ error: "Invalid request signature" });
    }

    await RequestNonce.create({
      walletAddress: normalizeWallet(walletAddress),
      nonce,
      requestPath: req.path
    });

    req.signedRequest = {
      message,
      signature,
      signedByWallet: normalizeWallet(walletAddress)
    };

    return next();
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ error: "Replay attack detected: request nonce already used" });
    }
    return next(error);
  }
}

module.exports = {
  requireSignedRequest
};
