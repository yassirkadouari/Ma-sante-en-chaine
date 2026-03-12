const mongoose = require("mongoose");

const ChainProofSchema = new mongoose.Schema(
  {
    txHash: { type: String },
    blockNumber: { type: Number },
    status: { type: String, enum: ["PENDING", "ANCHORED", "FAILED"], default: "PENDING" }
  },
  { _id: false }
);

const ConsentSchema = new mongoose.Schema(
  {
    required: { type: Boolean, default: false },
    grantedBy: { type: String },
    grantedAt: { type: Date },
    method: { type: String, enum: ["WALLET_SIGNATURE", "QR_CODE", "MANUAL"], default: "WALLET_SIGNATURE" }
  },
  { _id: false }
);

const AuditSchema = new mongoose.Schema(
  {
    createdByWallet: { type: String },
    createdByRole: { type: String },
    sourceIp: { type: String }
  },
  { _id: false }
);

const MedicalEventSchema = new mongoose.Schema(
  {
    patientId: { type: String, required: true, index: true },
    actorId: { type: String, required: true },
    actorRole: { type: String, required: true },
    eventType: { type: String, required: true },
    eventVersion: { type: String, required: true },
    eventData: { type: Object, required: true },
    occurredAt: { type: Date, required: true },
    hash: { type: String, required: true, index: true },
    hashVersion: { type: String, required: true },
    consent: { type: ConsentSchema, default: () => ({}) },
    audit: { type: AuditSchema, default: () => ({}) },
    chainProof: { type: ChainProofSchema, default: () => ({}) }
  },
  { timestamps: true }
);

module.exports = mongoose.model("MedicalEvent", MedicalEventSchema);
