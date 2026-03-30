const mongoose = require("mongoose");

const BlockchainAnchorSchema = new mongoose.Schema(
  {
    recordId: { type: String, required: true, unique: true, index: true },
    hash: { type: String, required: true },
    ownerWallet: { type: String, required: true },
    authorizedWallets: { type: [String], default: [] },
    status: {
      type: String,
      required: true,
      enum: ["PRESCRIBED", "DELIVERED", "CANCELLED"],
      default: "PRESCRIBED"
    },
    txHash: { type: String, default: "mock-chain" },
    blockNumber: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model("BlockchainAnchor", BlockchainAnchorSchema);
