const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const MedicalDocument = require("../models/MedicalDocument");
const blockchainService = require("../services/blockchainService");
const { logAudit } = require("../services/auditService");
const { requireAuth, requireRole } = require("../middleware/auth");
const { ROLES } = require("../config/roles");

const router = express.Router();

router.use(requireAuth);

const UPLOAD_DIR = path.join(__dirname, "../../uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || ".pdf";
    cb(null, "doc-" + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB limit
});

function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => reject(err));
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// Upload a new PDF (Medical Document)
router.post(
  "/",
  requireRole([ROLES.MEDECIN]),
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { patientWallet } = req.body;
      if (!patientWallet) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "patientWallet is required" });
      }

      const documentId = crypto.randomUUID();
      const fileHash = await calculateFileHash(req.file.path);

      const doc = new MedicalDocument({
        documentId,
        patientWallet,
        doctorWallet: req.auth.walletAddress,
        filename: req.file.originalname,
        path: req.file.path,
        mimetype: req.file.mimetype,
        size: req.file.size,
        fileHash
      });

      await doc.save();

      await blockchainService.storeHash({
        recordId: documentId,
        hash: fileHash,
        ownerWallet: patientWallet,
        authorizedWallets: [req.auth.walletAddress]
      });

      await logAudit({
        action: "MEDICAL_DOCUMENT_UPLOADED",
        actorWallet: req.auth.walletAddress,
        actorRole: req.auth.role,
        targetRecordId: documentId,
        requestId: req.requestId,
        ip: req.ip,
        metadata: {
          patientWallet,
          fileHash
        }
      });

      res.status(201).json({
        documentId,
        fileHash,
        message: "File uploaded and anchored to blockchain."
      });
    } catch (error) {
      if (req.file) fs.unlinkSync(req.file.path);
      next(error);
    }
  }
);

// Get a list of documents
router.get("/", async (req, res, next) => {
  try {
    const role = req.auth.role;
    let query = {};

    if (role === ROLES.PATIENT) {
      query.patientWallet = req.auth.walletAddress;
    } else if (role === ROLES.MEDECIN) {
      if (req.query.patientWallet) {
        query.patientWallet = req.query.patientWallet;
      }
      query.doctorWallet = req.auth.walletAddress;
    }

    const docs = await MedicalDocument.find(query)
      .sort({ uploadedAt: -1 })
      .select("-path")
      .lean();

    const validatedDocs = await Promise.all(
      docs.map(async (doc) => {
        let chainValid = false;
        try {
          const chain = await blockchainService.verifyHash(doc.documentId, doc.fileHash);
          chainValid = chain.valid;
        } catch (e) {
             chainValid = false;
        }
        return { ...doc, chainValid };
      })
    );

    res.json({ items: validatedDocs });
  } catch (error) {
    next(error);
  }
});

// Download a specific file
router.get("/:id/download", async (req, res, next) => {
  try {
    const doc = await MedicalDocument.findOne({ documentId: req.params.id });
    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (
      req.auth.role !== ROLES.ADMIN &&
      doc.patientWallet !== req.auth.walletAddress &&
      doc.doctorWallet !== req.auth.walletAddress
    ) {
      return res.status(403).json({ error: "Access denied to this document" });
    }

    await logAudit({
      action: "MEDICAL_DOCUMENT_DOWNLOADED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      targetRecordId: doc.documentId,
      requestId: req.requestId,
      ip: req.ip
    });

    res.download(doc.path, doc.filename);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
