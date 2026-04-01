const mongoose = require("mongoose");

const EncryptedPayloadSchema = new mongoose.Schema(
  {
    alg: { type: String, required: true },
    iv: { type: String, required: true },
    ciphertext: { type: String, required: true },
    tag: { type: String, required: true },
    keyVersion: { type: String, required: true }
  },
  { _id: false }
);

const SignatureSchema = new mongoose.Schema(
  {
    message: { type: String, required: true },
    signature: { type: String, required: true },
    signedByWallet: { type: String, required: true }
  },
  { _id: false }
);

const PrescriptionRecordSchema = new mongoose.Schema(
  {
    recordId: { type: String, required: true, unique: true, index: true },
    patientWallet: { type: String, required: true, index: true },
    doctorWallet: { type: String, required: true, index: true },
    pharmacyWallet: { type: String, index: true },
    authorWallet: { type: String, required: true },
    authorRole: { type: String, required: true },
    version: { type: Number, required: true },
    previousRecordId: { type: String, index: true },
    dataHash: { type: String, required: true, index: true },
    hashVersion: { type: String, required: true, default: "v2" },
    encryptedData: { type: EncryptedPayloadSchema, required: true },
    signedRequest: { type: SignatureSchema, required: true },
    issuedAt: { type: Date, required: true, default: () => new Date() },
    pdfPath: { type: String }, // Path to the uploaded PDF prescription
    blockchainHash: { type: String, index: true }, // The hash stored on the blockchain
    status: {
      type: String,
      enum: ["ACTIVE", "USED", "EXPIRED"],
      default: "ACTIVE"
    },
    isPurchased: { type: Boolean, default: false },
    isDelivered: { type: Boolean, default: false },
    totalAmount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model("PrescriptionRecord", PrescriptionRecordSchema);
