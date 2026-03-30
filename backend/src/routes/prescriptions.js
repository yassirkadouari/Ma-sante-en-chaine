const crypto = require("crypto");
const express = require("express");
const { z } = require("zod");
const PrescriptionRecord = require("../models/PrescriptionRecord");
const PrescriptionLifecycleEvent = require("../models/PrescriptionLifecycleEvent");
const { encryptJson, decryptJson } = require("../utils/encryption");
const { canonicalize, sha256Hex } = require("../utils/hash");
const { normalizeWallet } = require("../utils/signature");
const { ROLES } = require("../config/roles");
const { requireAuth, requireRole } = require("../middleware/auth");
const { requireSignedRequest } = require("../middleware/requestSignature");
const blockchainService = require("../services/blockchainService");
const { logAudit } = require("../services/auditService");

const router = express.Router();

router.use(requireAuth);

const createSchema = z.object({
  patientWallet: z.string().min(10),
  pharmacyWallet: z.string().min(10).optional(),
  data: z.record(z.any())
});

const reviseSchema = z.object({
  pharmacyWallet: z.string().min(10).optional(),
  data: z.record(z.any()),
  reason: z.string().min(3).max(200).optional()
});

const accessSchema = z.object({
  wallet: z.string().min(10)
});

function buildRecordHashPayload(record) {
  return {
    recordId: record.recordId,
    patientWallet: record.patientWallet,
    doctorWallet: record.doctorWallet,
    pharmacyWallet: record.pharmacyWallet || null,
    previousRecordId: record.previousRecordId || null,
    version: record.version,
    encryptedData: record.encryptedData,
    issuedAt: new Date(record.issuedAt).toISOString(),
    hashVersion: record.hashVersion
  };
}

async function assertReadable(recordId, wallet) {
  const authorized = await blockchainService.isAuthorized(recordId, wallet);
  if (!authorized) {
    throw Object.assign(new Error("Forbidden"), { status: 403, publicMessage: "Wallet is not authorized for this prescription" });
  }
}

async function verifyRecordIntegrity(record) {
  const computed = sha256Hex(canonicalize(buildRecordHashPayload(record)));
  if (computed !== record.dataHash) {
    throw Object.assign(new Error("Hash mismatch"), { status: 409, publicMessage: "Off-chain record hash mismatch" });
  }

  const chain = await blockchainService.verifyHash(record.recordId, computed);
  if (!chain.exists) {
    throw Object.assign(new Error("Missing chain proof"), { status: 409, publicMessage: "Missing on-chain anchor" });
  }

  if (!chain.valid) {
    throw Object.assign(new Error("Chain hash mismatch"), { status: 409, publicMessage: "On-chain hash mismatch" });
  }

  return chain;
}

router.post("/", requireRole([ROLES.MEDECIN]), requireSignedRequest, async (req, res, next) => {
  try {
    const parsed = createSchema.parse(req.body || {});

    const recordId = crypto.randomUUID();
    const issuedAt = new Date();
    const encryptedData = encryptJson(parsed.data);

    const record = {
      recordId,
      patientWallet: normalizeWallet(parsed.patientWallet),
      doctorWallet: normalizeWallet(req.auth.walletAddress),
      pharmacyWallet: parsed.pharmacyWallet ? normalizeWallet(parsed.pharmacyWallet) : undefined,
      authorWallet: normalizeWallet(req.auth.walletAddress),
      authorRole: req.auth.role,
      previousRecordId: null,
      version: 1,
      hashVersion: "v2",
      encryptedData,
      signedRequest: req.signedRequest,
      issuedAt
    };

    record.dataHash = sha256Hex(canonicalize(buildRecordHashPayload(record)));

    await PrescriptionRecord.create(record);
    await PrescriptionLifecycleEvent.create({
      recordId,
      status: "PRESCRIBED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role
    });

    await blockchainService.storeHash({
      recordId,
      hash: record.dataHash,
      ownerWallet: record.patientWallet,
      authorizedWallets: [record.doctorWallet, record.pharmacyWallet].filter(Boolean)
    });

    await logAudit({
      action: "PRESCRIPTION_CREATED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      targetRecordId: recordId,
      requestId: req.requestId,
      ip: req.ip,
      metadata: {
        patientWallet: record.patientWallet,
        pharmacyWallet: record.pharmacyWallet || null
      }
    });

    res.status(201).json({
      recordId,
      status: "PRESCRIBED",
      dataHash: record.dataHash
    });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const wallet = normalizeWallet(req.auth.walletAddress);
    const role = req.auth.role;

    let filter = {};
    if (role === ROLES.PATIENT) {
      filter.patientWallet = wallet;
    }

    if (role === ROLES.MEDECIN) {
      filter.doctorWallet = wallet;
    }

    if (role === ROLES.PHARMACIE) {
      filter.pharmacyWallet = wallet;
    }

    const records = await PrescriptionRecord.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const items = await Promise.all(
      records.map(async (record) => {
        const chain = await blockchainService.verifyHash(record.recordId, record.dataHash);
        return {
          recordId: record.recordId,
          patientWallet: record.patientWallet,
          doctorWallet: record.doctorWallet,
          pharmacyWallet: record.pharmacyWallet || null,
          version: record.version,
          previousRecordId: record.previousRecordId || null,
          status: chain.status || "PRESCRIBED",
          createdAt: record.createdAt
        };
      })
    );

    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.get("/:recordId", requireSignedRequest, async (req, res, next) => {
  try {
    const record = await PrescriptionRecord.findOne({ recordId: req.params.recordId }).lean();
    if (!record) {
      return res.status(404).json({ error: "Prescription not found" });
    }

    await assertReadable(record.recordId, req.auth.walletAddress);
    const chain = await verifyRecordIntegrity(record);

    const decrypted = decryptJson(record.encryptedData);

    await logAudit({
      action: "PRESCRIPTION_READ",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      targetRecordId: record.recordId,
      requestId: req.requestId,
      ip: req.ip
    });

    res.json({
      recordId: record.recordId,
      version: record.version,
      previousRecordId: record.previousRecordId || null,
      status: chain.status,
      patientWallet: record.patientWallet,
      doctorWallet: record.doctorWallet,
      pharmacyWallet: record.pharmacyWallet || null,
      issuedAt: record.issuedAt,
      data: decrypted
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:recordId/revise", requireRole([ROLES.MEDECIN]), requireSignedRequest, async (req, res, next) => {
  try {
    const parsed = reviseSchema.parse(req.body || {});

    const previous = await PrescriptionRecord.findOne({ recordId: req.params.recordId }).lean();
    if (!previous) {
      return res.status(404).json({ error: "Prescription not found" });
    }

    if (normalizeWallet(previous.doctorWallet) !== normalizeWallet(req.auth.walletAddress)) {
      return res.status(403).json({ error: "Only issuing doctor can revise prescription" });
    }

    const previousChain = await blockchainService.verifyHash(previous.recordId, previous.dataHash);
    if (previousChain.status === "DELIVERED") {
      return res.status(409).json({ error: "Delivered prescription cannot be revised" });
    }

    const recordId = crypto.randomUUID();
    const issuedAt = new Date();
    const encryptedData = encryptJson(parsed.data);

    const revised = {
      recordId,
      patientWallet: previous.patientWallet,
      doctorWallet: previous.doctorWallet,
      pharmacyWallet: parsed.pharmacyWallet
        ? normalizeWallet(parsed.pharmacyWallet)
        : previous.pharmacyWallet,
      authorWallet: normalizeWallet(req.auth.walletAddress),
      authorRole: req.auth.role,
      previousRecordId: previous.recordId,
      version: previous.version + 1,
      hashVersion: "v2",
      encryptedData,
      signedRequest: req.signedRequest,
      issuedAt
    };

    revised.dataHash = sha256Hex(canonicalize(buildRecordHashPayload(revised)));

    await PrescriptionRecord.create(revised);

    await PrescriptionLifecycleEvent.create({
      recordId: previous.recordId,
      status: "CANCELLED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      reason: parsed.reason || "Revised by doctor"
    });

    await PrescriptionLifecycleEvent.create({
      recordId: revised.recordId,
      status: "PRESCRIBED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role
    });

    await blockchainService.cancelPrescription(previous.recordId);
    await blockchainService.storeHash({
      recordId: revised.recordId,
      hash: revised.dataHash,
      ownerWallet: revised.patientWallet,
      authorizedWallets: [revised.doctorWallet, revised.pharmacyWallet].filter(Boolean)
    });

    await logAudit({
      action: "PRESCRIPTION_REVISED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      targetRecordId: revised.recordId,
      requestId: req.requestId,
      ip: req.ip,
      metadata: {
        previousRecordId: previous.recordId
      }
    });

    res.status(201).json({
      recordId: revised.recordId,
      previousRecordId: previous.recordId,
      version: revised.version,
      status: "PRESCRIBED"
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:recordId/deliver", requireRole([ROLES.PHARMACIE]), requireSignedRequest, async (req, res, next) => {
  try {
    const record = await PrescriptionRecord.findOne({ recordId: req.params.recordId }).lean();
    if (!record) {
      return res.status(404).json({ error: "Prescription not found" });
    }

    await assertReadable(record.recordId, req.auth.walletAddress);
    await verifyRecordIntegrity(record);

    const anchor = await blockchainService.deliverPrescription(record.recordId, req.auth.walletAddress);

    await PrescriptionLifecycleEvent.create({
      recordId: record.recordId,
      status: "DELIVERED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role
    });

    await logAudit({
      action: "PRESCRIPTION_DELIVERED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      targetRecordId: record.recordId,
      requestId: req.requestId,
      ip: req.ip
    });

    res.json({
      recordId: record.recordId,
      status: anchor.status
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:recordId/grant", requireRole([ROLES.PATIENT]), requireSignedRequest, async (req, res, next) => {
  try {
    const parsed = accessSchema.parse(req.body || {});
    const record = await PrescriptionRecord.findOne({ recordId: req.params.recordId }).lean();

    if (!record) {
      return res.status(404).json({ error: "Prescription not found" });
    }

    if (normalizeWallet(record.patientWallet) !== normalizeWallet(req.auth.walletAddress)) {
      return res.status(403).json({ error: "Only prescription owner can grant access" });
    }

    const anchor = await blockchainService.grantAccess(record.recordId, parsed.wallet, req.auth.walletAddress);

    await logAudit({
      action: "PRESCRIPTION_ACCESS_GRANTED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      targetRecordId: record.recordId,
      requestId: req.requestId,
      ip: req.ip,
      metadata: { grantedWallet: normalizeWallet(parsed.wallet) }
    });

    res.json({
      recordId: record.recordId,
      authorizedWallets: anchor.authorizedWallets
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:recordId/revoke", requireRole([ROLES.PATIENT]), requireSignedRequest, async (req, res, next) => {
  try {
    const parsed = accessSchema.parse(req.body || {});
    const record = await PrescriptionRecord.findOne({ recordId: req.params.recordId }).lean();

    if (!record) {
      return res.status(404).json({ error: "Prescription not found" });
    }

    if (normalizeWallet(record.patientWallet) !== normalizeWallet(req.auth.walletAddress)) {
      return res.status(403).json({ error: "Only prescription owner can revoke access" });
    }

    const anchor = await blockchainService.revokeAccess(record.recordId, parsed.wallet, req.auth.walletAddress);

    await logAudit({
      action: "PRESCRIPTION_ACCESS_REVOKED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      targetRecordId: record.recordId,
      requestId: req.requestId,
      ip: req.ip,
      metadata: { revokedWallet: normalizeWallet(parsed.wallet) }
    });

    res.json({
      recordId: record.recordId,
      authorizedWallets: anchor.authorizedWallets
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
