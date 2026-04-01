const mongoose = require("mongoose");

const MedicalDocumentSchema = new mongoose.Schema(
  {
    documentId: { type: String, required: true, unique: true, index: true },
    patientWallet: { type: String, required: true, index: true },
    doctorWallet: { type: String, required: true, index: true },
    filename: { type: String, required: true },
    path: { type: String, required: true },
    mimetype: { type: String, required: true },
    size: { type: Number, required: true },
    fileHash: { type: String, required: true, index: true },
    uploadedAt: { type: Date, required: true, default: () => new Date() },
    status: { type: String, enum: ["ACTIVE", "REVOKED"], default: "ACTIVE" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("MedicalDocument", MedicalDocumentSchema);
