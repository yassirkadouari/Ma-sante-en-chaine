const mongoose = require("mongoose");

const WalletRoleSchema = new mongoose.Schema(
  {
    walletAddress: { type: String, required: true, index: true },
    role: { type: String, required: true, index: true },
    createdByWallet: { type: String },
    updatedByWallet: { type: String }
  },
  { timestamps: true }
);

WalletRoleSchema.index({ walletAddress: 1, role: 1 }, { unique: true });

module.exports = mongoose.model("WalletRole", WalletRoleSchema);
