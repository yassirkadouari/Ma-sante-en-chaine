const mongoose = require("mongoose");

const AuthNonceSchema = new mongoose.Schema(
  {
    walletAddress: { type: String, required: true, index: true },
    role: { type: String, required: true },
    nonce: { type: String, required: true, index: true },
    message: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date }
  },
  { timestamps: true }
);

AuthNonceSchema.index({ walletAddress: 1, nonce: 1 }, { unique: true });

module.exports = mongoose.model("AuthNonce", AuthNonceSchema);
