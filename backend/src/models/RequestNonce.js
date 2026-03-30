const mongoose = require("mongoose");

const RequestNonceSchema = new mongoose.Schema(
  {
    walletAddress: { type: String, required: true },
    nonce: { type: String, required: true },
    requestPath: { type: String, required: true },
    consumedAt: { type: Date, required: true, default: () => new Date() }
  },
  { timestamps: true }
);

RequestNonceSchema.index({ walletAddress: 1, nonce: 1 }, { unique: true });

module.exports = mongoose.model("RequestNonce", RequestNonceSchema);
