const crypto = require("crypto");

function requireEnv(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadEncryptionKey() {
  const key = requireEnv("ENCRYPTION_KEY");

  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, "hex");
  }

  const asBase64 = Buffer.from(key, "base64");
  if (asBase64.length === 32) {
    return asBase64;
  }

  throw new Error("ENCRYPTION_KEY must be a 32-byte key in hex(64 chars) or base64 format");
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  mongoUri: requireEnv("MONGODB_URI"),
  jwtSecret:
    process.env.NODE_ENV === "development"
      ? requireEnv("JWT_SECRET", crypto.randomBytes(32).toString("hex"))
      : requireEnv("JWT_SECRET"),
  jwtTtl: process.env.JWT_TTL || "15m",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  encryptionKey: loadEncryptionKey(),
  loginNonceTtlSeconds: Number(process.env.LOGIN_NONCE_TTL_SECONDS || 300),
  requestSkewSeconds: Number(process.env.REQUEST_SKEW_SECONDS || 300),
  adminWallets: String(process.env.ADMIN_WALLETS || "")
    .split(",")
    .map((wallet) => wallet.trim())
    .filter(Boolean)
};

module.exports = { env };
