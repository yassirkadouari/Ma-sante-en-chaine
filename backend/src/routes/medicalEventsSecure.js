const crypto = require("crypto");
const express = require("express");
const { z } = require("zod");
const MedicalEvent = require("../models/MedicalEvent");
const PrescriptionRecord = require("../models/PrescriptionRecord");
const InsuranceClaim = require("../models/InsuranceClaim");
const { hashEventPayload } = require("../utils/hash");
const { decryptJson } = require("../utils/encryption");
const { requireAuth, requireRole } = require("../middleware/auth");
const { requireSignedRequest } = require("../middleware/requestSignature");
const { normalizeWallet } = require("../utils/signature");
const { ROLES } = require("../config/roles");
const { logAudit } = require("../services/auditService");
const blockchainService = require("../services/blockchainService");

const router = express.Router();
router.use(requireAuth);

const profileSchema = z.object({
  patientWallet: z.string().min(10),
  bloodType: z.string().min(1),
  age: z.number().int().positive(),
  diseases: z.array(z.string().min(2)).optional()
});

const visitSchema = z.object({
  patientWallet: z.string().min(10),
  diagnosis: z.string().min(2),
  notes: z.string().max(500).optional(),
  amountClaim: z.number().min(0).optional()
});

const operationSchema = z.object({
  patientWallet: z.string().min(10),
  operationName: z.string().min(2),
  department: z.string().min(2),
  notes: z.string().max(500).optional(),
  amountClaim: z.number().min(0)
});

function createId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
}

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

async function createEvent({ patientWallet, actorWallet, actorRole, eventType, eventData }) {
  const patient = normalizeWallet(patientWallet);
  const actor = normalizeWallet(actorWallet);
  const eventDoc = new MedicalEvent({
    patientId: patient,
    actorId: actor,
    actorRole,
    eventType,
    eventVersion: "v2",
    eventData,
    occurredAt: new Date(),
    hashVersion: "v2",
    consent: {
      required: false,
      grantedBy: patient,
      grantedAt: new Date(),
      method: "WALLET_SIGNATURE"
    },
    audit: {
      createdByWallet: actor,
      createdByRole: actorRole
    },
    chainProof: {
      txHash: null,
      blockNumber: null,
      status: "PENDING"
    }
  });

  eventDoc.hash = hashEventPayload(buildHashPayload(eventDoc));
  await eventDoc.save();

  const anchorRecordId = `event:${eventDoc._id.toString()}`;
  const anchor = await blockchainService.storeHash({
    recordId: anchorRecordId,
    hash: eventDoc.hash,
    ownerWallet: patient,
    authorizedWallets: [actor]
  });

  eventDoc.chainProof = {
    txHash: `anchor-${anchor.recordId}`,
    blockNumber: Date.now(),
    status: "ANCHORED"
  };
  await eventDoc.save();

  return eventDoc;
}

async function verifyMedicalEventOnChain(eventDoc) {
  const recordId = `event:${eventDoc._id.toString()}`;
  const check = await blockchainService.verifyHash(recordId, eventDoc.hash);
  if (!check.exists || !check.valid) {
    throw Object.assign(new Error("Medical event blockchain verification failed"), {
      status: 409,
      publicMessage: "Medical event blockchain verification failed"
    });
  }
  return check;
}

async function createAutoClaim({ sourceType, sourceId, patientWallet, providerWallet, providerRole, amountRequested, sourceHash }) {
  if (!amountRequested || amountRequested <= 0) {
    return null;
  }

  try {
    return await InsuranceClaim.create({
      claimId: createId(),
      sourceType,
      sourceId,
      patientWallet: normalizeWallet(patientWallet),
      requesterWallet: normalizeWallet(patientWallet),
      providerWallet: normalizeWallet(providerWallet),
      providerRole,
      amountRequested,
      verification: {
        method: "MEDICAL_EVENT_HASH",
        anchorValid: true,
        anchorStatus: "ANCHORED",
        sourceHash,
        checkedAt: new Date()
      }
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return null;
    }
    throw error;
  }
}

router.post("/profile", requireRole([ROLES.HOPITAL]), requireSignedRequest, async (req, res, next) => {
  try {
    const parsed = profileSchema.parse(req.body || {});

    const event = await createEvent({
      patientWallet: parsed.patientWallet,
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      eventType: "PATIENT_PROFILE",
      eventData: {
        bloodType: parsed.bloodType,
        age: parsed.age,
        diseases: parsed.diseases || []
      }
    });

    await logAudit({
      action: "PATIENT_PROFILE_UPDATED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      requestId: req.requestId,
      ip: req.ip,
      metadata: {
        eventId: event._id.toString(),
        patientWallet: normalizeWallet(parsed.patientWallet)
      }
    });

    res.status(201).json({ eventId: event._id, hash: event.hash });
  } catch (error) {
    next(error);
  }
});

router.post("/visit", requireRole([ROLES.MEDECIN]), requireSignedRequest, async (req, res, next) => {
  try {
    const parsed = visitSchema.parse(req.body || {});
    const event = await createEvent({
      patientWallet: parsed.patientWallet,
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      eventType: "VISITE",
      eventData: {
        diagnosis: parsed.diagnosis,
        notes: parsed.notes || null,
        amountClaim: Number(parsed.amountClaim || 0)
      }
    });

    const claim = await createAutoClaim({
      sourceType: "VISIT",
      sourceId: event._id.toString(),
      patientWallet: parsed.patientWallet,
      providerWallet: req.auth.walletAddress,
      providerRole: req.auth.role,
      amountRequested: Number(parsed.amountClaim || 0),
      sourceHash: event.hash
    });

    await verifyMedicalEventOnChain(event);

    await logAudit({
      action: "VISIT_RECORDED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      requestId: req.requestId,
      ip: req.ip,
      metadata: {
        eventId: event._id.toString(),
        patientWallet: normalizeWallet(parsed.patientWallet),
        claimId: claim?.claimId || null
      }
    });

    res.status(201).json({ eventId: event._id, hash: event.hash, claimId: claim?.claimId || null });
  } catch (error) {
    next(error);
  }
});

router.post("/operation", requireRole([ROLES.HOPITAL]), requireSignedRequest, async (req, res, next) => {
  try {
    const parsed = operationSchema.parse(req.body || {});
    const event = await createEvent({
      patientWallet: parsed.patientWallet,
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      eventType: "INTERVENTION",
      eventData: {
        operationName: parsed.operationName,
        department: parsed.department,
        notes: parsed.notes || null,
        amountClaim: parsed.amountClaim
      }
    });

    const claim = await createAutoClaim({
      sourceType: "OPERATION",
      sourceId: event._id.toString(),
      patientWallet: parsed.patientWallet,
      providerWallet: req.auth.walletAddress,
      providerRole: req.auth.role,
      amountRequested: parsed.amountClaim,
      sourceHash: event.hash
    });

    await verifyMedicalEventOnChain(event);

    await logAudit({
      action: "OPERATION_RECORDED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      requestId: req.requestId,
      ip: req.ip,
      metadata: {
        eventId: event._id.toString(),
        patientWallet: normalizeWallet(parsed.patientWallet),
        claimId: claim?.claimId || null
      }
    });

    res.status(201).json({ eventId: event._id, hash: event.hash, claimId: claim?.claimId || null });
  } catch (error) {
    next(error);
  }
});

router.get("/mine", requireRole([ROLES.PATIENT]), async (req, res, next) => {
  try {
    const patientWallet = normalizeWallet(req.auth.walletAddress);
    const [events, records, identity] = await Promise.all([
      MedicalEvent.find({ patientId: patientWallet }).sort({ occurredAt: -1 }).lean(),
      PrescriptionRecord.find({ patientWallet }).sort({ createdAt: -1 }).lean(),
      require("../models/WalletIdentity").findOne({ walletAddress: patientWallet }).lean()
    ]);

    const latestProfileEvent = events.find((item) => item.eventType === "PATIENT_PROFILE");

    const medications = [];
    for (const record of records) {
      try {
        const payload = decryptJson(record.encryptedData);
        const meds = Array.isArray(payload?.medications) ? payload.medications : [];
        const status = payload?.status || null;
        for (const med of meds) {
          medications.push({
            recordId: record.recordId,
            name: med?.name || null,
            dose: med?.dose || null,
            frequency: med?.frequency || null,
            durationDays: med?.durationDays || null,
            status
          });
        }
      } catch (error) {
        continue;
      }
    }

    const pastOperations = events
      .filter((item) => ["INTERVENTION", "HOSPITALISATION", "OPERATION", "ADMISSION", "DISCHARGE"].includes(item.eventType))
      .map((item) => ({
        eventId: item._id,
        occurredAt: item.occurredAt,
        data: item.eventData,
        eventType: item.eventType,
        actorWallet: item.actorId
      }));

    const labResults = events
      .filter((item) => item.eventType === "LAB_RESULT")
      .map((item) => ({
        eventId: item._id,
        occurredAt: item.occurredAt,
        data: item.eventData,
        actorWallet: item.actorId
      }));

    const visits = events
      .filter((item) => item.eventType === "VISITE")
      .map((item) => ({
        eventId: item._id,
        occurredAt: item.occurredAt,
        data: item.eventData,
        actorWallet: item.actorId
      }));

    const verifiedEvents = await Promise.all(
      events.map(async (item) => {
        const check = await blockchainService.verifyHash(`event:${item._id.toString()}`, item.hash);
        return {
          eventId: item._id,
          eventType: item.eventType,
          occurredAt: item.occurredAt,
          actorRole: item.actorRole,
          actorWallet: item.actorId,
          eventData: item.eventData,
          hash: item.hash,
          chainProof: item.chainProof,
          blockchainVerified: Boolean(check.exists && check.valid)
        };
      })
    );

    res.json({
      profile: {
        bloodType: latestProfileEvent?.eventData?.bloodType || null,
        age: latestProfileEvent?.eventData?.age || null,
        diseases: latestProfileEvent?.eventData?.diseases || [],
        region: identity?.region || null,
        primaryDoctorWallet: identity?.primaryDoctorWallet || null
      },
      events: verifiedEvents,
      visits,
      labResults,
      pastOperations,
      currentMedications: medications
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
