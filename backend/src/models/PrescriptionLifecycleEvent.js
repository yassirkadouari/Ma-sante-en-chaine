const mongoose = require("mongoose");

const PrescriptionLifecycleEventSchema = new mongoose.Schema(
  {
    recordId: { type: String, required: true, index: true },
    status: { type: String, required: true, enum: ["PRESCRIBED", "DELIVERED", "CANCELLED"] },
    actorWallet: { type: String, required: true },
    actorRole: { type: String, required: true },
    reason: { type: String }
  },
  { timestamps: true }
);

module.exports = mongoose.model("PrescriptionLifecycleEvent", PrescriptionLifecycleEventSchema);
