const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const MedicalEvent = require("../models/MedicalEvent");
const InsuranceClaim = require("../models/InsuranceClaim");
const { requireAuth, requireRole } = require("../middleware/auth");
const { requireSignedRequest } = require("../middleware/requestSignature");
const { ROLES } = require("../config/roles");
const { normalizeWallet } = require("../utils/signature");
const { hashEventPayload } = require("../utils/hash");
const { logAudit } = require("../services/auditService");
const blockchainService = require("../services/blockchainService");

const router = express.Router();
router.use(requireAuth);
router.use(requireRole([ROLES.LABO]));

const UPLOAD_DIR = path.join(__dirname, "../../uploads/labo");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || ".pdf";
    cb(null, "lab-" + uniqueSuffix + ext);
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

const labResultSchema = z.object({
  patientWallet: z.string().min(10),
  testType: z.string().min(2),
  resultSummary: z.string().min(2),
  amountClaim: z.number().min(0).optional()
});

function buildHashPayload(eventDoc) {
  return {
    patientId: eventDoc.patientId,
    actorId: eventDoc.actorId,
    actorRole: eventDoc.actorRole,
    eventType: eventDoc.eventType,
    eventData: eventDoc.eventData,
    occurredAt: eventDoc.occurredAt.toISOString(),
    eventVersion: eventDoc.eventVersion,
    hashVersion: eventDoc.hashVersion
  };
}

async function createEvent({ patientWallet, actorWallet, actorRole, eventType, eventData, fileHash, filePath }) {
  const patient = normalizeWallet(patientWallet);
  const actor = normalizeWallet(actorWallet);
  const eventDoc = new MedicalEvent({
    patientId: patient,
    actorId: actor,
    actorRole,
    eventType,
    eventVersion: "v2",
    eventData: {
      ...eventData,
      fileHash,
      filePath
    },
    occurredAt: new Date(),
    hashVersion: "v2",
    audit: {
      createdByWallet: actor,
      createdByRole: actorRole
    }
  });

  // We use the file hash as the definitive blockchain hash for document integrity
  eventDoc.hash = fileHash;
  await eventDoc.save();

  const anchorRecordId = `event:${eventDoc._id.toString()}`;
  await blockchainService.storeHash({
    recordId: anchorRecordId,
    hash: eventDoc.hash,
    ownerWallet: patient,
    authorizedWallets: [actor]
  });

  eventDoc.chainProof = {
    txHash: `anchor-${anchorRecordId}`,
    blockNumber: Date.now(),
    status: "ANCHORED"
  };
  await eventDoc.save();

  return eventDoc;
}

router.post("/results", upload.single("pdf"), async (req, res, next) => {
  try {
    const parsed = labResultSchema.parse(JSON.parse(req.body.payload || "{}"));
    
    if (!req.file) {
      return res.status(400).json({ error: "Le fichier PDF de l'analyse est obligatoire." });
    }

    const fileHash = await calculateFileHash(req.file.path);

    const event = await createEvent({
      patientWallet: parsed.patientWallet,
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      eventType: "LAB_RESULT",
      eventData: {
        testType: parsed.testType,
        resultSummary: parsed.resultSummary,
        amountClaim: parsed.amountClaim || 0
      },
      fileHash,
      filePath: req.file.path
    });

    let claimId = null;
    if (parsed.amountClaim && parsed.amountClaim > 0) {
      const claim = await InsuranceClaim.create({
        claimId: crypto.randomBytes(16).toString("hex"),
        sourceType: "LAB_TEST",
        sourceId: event._id.toString(),
        patientWallet: normalizeWallet(parsed.patientWallet),
        requesterWallet: normalizeWallet(parsed.patientWallet),
        providerWallet: req.auth.walletAddress,
        providerRole: req.auth.role,
        amountRequested: parsed.amountClaim,
        verification: {
          method: "LAB_EVENT_HASH",
          anchorValid: true,
          anchorStatus: "ANCHORED",
          sourceHash: event.hash,
          checkedAt: new Date()
        }
      });
      claimId = claim.claimId;
    }

    await logAudit({
      action: "LAB_RESULT_RECORDED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      requestId: req.requestId,
      ip: req.ip,
      metadata: {
        eventId: event._id.toString(),
        patientWallet: normalizeWallet(parsed.patientWallet),
        claimId,
        fileHash
      }
    });

    res.status(201).json({ eventId: event._id, hash: event.hash, claimId });
  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    next(error);
  }
});

module.exports = router;

module.exports = router;
