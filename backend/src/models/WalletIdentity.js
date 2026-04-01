const mongoose = require("mongoose");

const WalletIdentitySchema = new mongoose.Schema(
  {
    walletAddress: { type: String, required: true, unique: true, index: true },
    role: { type: String, required: true, index: true },
    fullName: { type: String, required: true, trim: true },
    nickname: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date, required: true },
    region: { type: String, index: true }, // From REGIONS config
    isGlobalAdmin: { type: Boolean, default: false },
    cabinetName: { type: String, trim: true },
    institutionName: { type: String, trim: true },
    departmentName: { type: String, trim: true },
    primaryDoctorWallet: { type: String, index: true },
    approvalStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING"
    },
    approvedByWallet: { type: String },
    approvedAt: { type: Date },
    createdByWallet: { type: String },
    updatedByWallet: { type: String }
  },
  { timestamps: true }
);

module.exports = mongoose.model("WalletIdentity", WalletIdentitySchema);
