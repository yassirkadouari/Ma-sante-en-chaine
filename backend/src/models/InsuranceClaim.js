const mongoose = require("mongoose");

const ClaimVerificationSchema = new mongoose.Schema(
  {
    method: { type: String },
    anchorValid: { type: Boolean, default: false },
    anchorStatus: { type: String },
    sourceHash: { type: String },
    checkedAt: { type: Date }
  },
  { _id: false }
);

const InsuranceClaimSchema = new mongoose.Schema(
  {
    claimId: { type: String, required: true, unique: true, index: true },
    sourceType: { type: String, enum: ["PRESCRIPTION", "VISIT", "OPERATION"], required: true, index: true },
    sourceId: { type: String, required: true, index: true },
    patientWallet: { type: String, required: true, index: true },
    requesterWallet: { type: String, required: true },
    providerWallet: { type: String },
    providerRole: { type: String },
    amountRequested: { type: Number, required: true, min: 0 },
    amountApproved: { type: Number, min: 0 },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING", index: true },
    reason: { type: String },
    verification: { type: ClaimVerificationSchema, default: () => ({}) },
    reviewedByWallet: { type: String },
    reviewedAt: { type: Date }
  },
  { timestamps: true }
);

InsuranceClaimSchema.index({ sourceType: 1, sourceId: 1, patientWallet: 1 }, { unique: true });

module.exports = mongoose.model("InsuranceClaim", InsuranceClaimSchema);
