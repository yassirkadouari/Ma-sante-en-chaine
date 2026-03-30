const crypto = require("crypto");
const express = require("express");
const { z } = require("zod");
const InsuranceClaim = require("../models/InsuranceClaim");
const PrescriptionRecord = require("../models/PrescriptionRecord");
const MedicalEvent = require("../models/MedicalEvent");
const { requireAuth, requireRole } = require("../middleware/auth");
const { requireSignedRequest } = require("../middleware/requestSignature");
const { ROLES } = require("../config/roles");
const { normalizeWallet } = require("../utils/signature");
const { decryptJson } = require("../utils/encryption");
const blockchainService = require("../services/blockchainService");
const { logAudit } = require("../services/auditService");

const router = express.Router();
router.use(requireAuth);

const createPrescriptionClaimSchema = z.object({
  amountRequested: z.number().min(0).optional(),
  reason: z.string().min(2).max(300).optional()
});

const reviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  amountApproved: z.number().min(0).optional(),
  reason: z.string().min(2).max(300).optional()
});

function createId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
}

function computePrescriptionClaimAmount(record) {
  try {
    const data = decryptJson(record.encryptedData);
    const reimbursements = Array.isArray(data?.reimbursements) ? data.reimbursements : [];
    const total = reimbursements.reduce((sum, item) => sum + Number(item?.montantDemande || 0), 0);
    if (Number.isFinite(total) && total > 0) {
      return total;
    }
  } catch (error) {
    return 0;
  }
  return 0;
}

router.get("/", async (req, res, next) => {
  try {
    const wallet = normalizeWallet(req.auth.walletAddress);
    const role = req.auth.role;

    if (role === ROLES.PATIENT) {
      const items = await InsuranceClaim.find({ patientWallet: wallet }).sort({ createdAt: -1 }).lean();
      return res.json({ items });
    }

    if (role === ROLES.ASSURANCE) {
      const statusFilter = req.query.status ? String(req.query.status).toUpperCase() : "PENDING";
      const query = statusFilter === "ALL" ? {} : { status: statusFilter };
      const items = await InsuranceClaim.find(query).sort({ createdAt: -1 }).lean();
      return res.json({ items });
    }

    return res.status(403).json({ error: "Forbidden" });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/prescriptions/:recordId",
  requireRole([ROLES.PATIENT]),
  requireSignedRequest,
  async (req, res, next) => {
    try {
      const parsed = createPrescriptionClaimSchema.parse(req.body || {});
      const record = await PrescriptionRecord.findOne({ recordId: req.params.recordId }).lean();
      if (!record) {
        return res.status(404).json({ error: "Prescription not found" });
      }

      const patientWallet = normalizeWallet(req.auth.walletAddress);
      if (normalizeWallet(record.patientWallet) !== patientWallet) {
        return res.status(403).json({ error: "Only patient owner can claim this ordonnance" });
      }

      const verification = await blockchainService.verifyHash(record.recordId, record.dataHash);
      if (!verification.exists || !verification.valid) {
        return res.status(409).json({ error: "Ordonnance smart-contract verification failed" });
      }

      if (verification.status !== "DELIVERED") {
        return res.status(409).json({ error: "Ordonnance must be DELIVERED before claim" });
      }

      const amountRequested =
        typeof parsed.amountRequested === "number"
          ? parsed.amountRequested
          : computePrescriptionClaimAmount(record);

      if (!Number.isFinite(amountRequested) || amountRequested <= 0) {
        return res.status(400).json({ error: "Unable to determine claim amount" });
      }

      const claim = await InsuranceClaim.create({
        claimId: createId(),
        sourceType: "PRESCRIPTION",
        sourceId: record.recordId,
        patientWallet,
        requesterWallet: patientWallet,
        providerWallet: normalizeWallet(record.pharmacyWallet || record.doctorWallet),
        providerRole: record.pharmacyWallet ? ROLES.PHARMACIE : ROLES.MEDECIN,
        amountRequested,
        reason: parsed.reason,
        verification: {
          method: "SMART_CONTRACT_ANCHOR",
          anchorValid: true,
          anchorStatus: verification.status,
          sourceHash: verification.storedHash,
          checkedAt: new Date()
        }
      });

      await logAudit({
        action: "CLAIM_CREATED_PRESCRIPTION",
        actorWallet: req.auth.walletAddress,
        actorRole: req.auth.role,
        requestId: req.requestId,
        ip: req.ip,
        metadata: {
          claimId: claim.claimId,
          recordId: record.recordId,
          amountRequested
        }
      });

      res.status(201).json(claim);
    } catch (error) {
      if (error && error.code === 11000) {
        return res.status(409).json({ error: "Claim already exists for this source" });
      }
      next(error);
    }
  }
);

router.patch(
  "/:claimId/review",
  requireRole([ROLES.ASSURANCE]),
  requireSignedRequest,
  async (req, res, next) => {
    try {
      const parsed = reviewSchema.parse(req.body || {});
      const claim = await InsuranceClaim.findOne({ claimId: req.params.claimId });
      if (!claim) {
        return res.status(404).json({ error: "Claim not found" });
      }

      if (claim.status !== "PENDING") {
        return res.status(409).json({ error: "Claim already reviewed" });
      }

      if (claim.sourceType === "PRESCRIPTION") {
        const record = await PrescriptionRecord.findOne({ recordId: claim.sourceId }).lean();
        if (!record) {
          return res.status(404).json({ error: "Source ordonnance not found" });
        }

        const verification = await blockchainService.verifyHash(record.recordId, record.dataHash);
        if (!verification.exists || !verification.valid || verification.status !== "DELIVERED") {
          return res.status(409).json({ error: "Ordonnance blockchain verification failed during review" });
        }

        if (claim.verification?.sourceHash && claim.verification.sourceHash !== verification.storedHash) {
          return res.status(409).json({ error: "Source hash mismatch for claim" });
        }
      }

      if (claim.sourceType === "VISIT" || claim.sourceType === "OPERATION") {
        const eventDoc = await MedicalEvent.findById(claim.sourceId).lean();
        if (!eventDoc) {
          return res.status(404).json({ error: "Source medical event not found" });
        }

        const verification = await blockchainService.verifyHash(`event:${claim.sourceId}`, eventDoc.hash);
        if (!verification.exists || !verification.valid) {
          return res.status(409).json({ error: "Medical event blockchain verification failed during review" });
        }

        if (claim.verification?.sourceHash && claim.verification.sourceHash !== eventDoc.hash) {
          return res.status(409).json({ error: "Source hash mismatch for claim" });
        }
      }

      claim.status = parsed.decision;
      claim.amountApproved = parsed.decision === "APPROVED" ? Number(parsed.amountApproved || claim.amountRequested) : 0;
      claim.reason = parsed.reason || claim.reason;
      claim.reviewedByWallet = normalizeWallet(req.auth.walletAddress);
      claim.reviewedAt = new Date();
      await claim.save();

      await logAudit({
        action: parsed.decision === "APPROVED" ? "CLAIM_APPROVED" : "CLAIM_REJECTED",
        actorWallet: req.auth.walletAddress,
        actorRole: req.auth.role,
        requestId: req.requestId,
        ip: req.ip,
        metadata: {
          claimId: claim.claimId,
          amountApproved: claim.amountApproved,
          sourceType: claim.sourceType,
          sourceId: claim.sourceId
        }
      });

      res.json(claim);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
