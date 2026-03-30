const mongoose = require("mongoose");

const AuditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true },
    actorWallet: { type: String, required: true, index: true },
    actorRole: { type: String, required: true },
    targetRecordId: { type: String, index: true },
    requestId: { type: String },
    ip: { type: String },
    metadata: { type: Object, default: () => ({}) }
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuditLog", AuditLogSchema);
