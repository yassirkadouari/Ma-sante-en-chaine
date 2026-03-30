const crypto = require("crypto");
const { env } = require("../config/env");

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function encryptJson(value) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, env.encryptionKey, iv);

  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    alg: ALGO,
    iv: iv.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    tag: tag.toString("base64"),
    keyVersion: "v1"
  };
}

function decryptJson(payload) {
  const decipher = crypto.createDecipheriv(
    payload.alg || ALGO,
    env.encryptionKey,
    Buffer.from(payload.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}

module.exports = {
  encryptJson,
  decryptJson
};
