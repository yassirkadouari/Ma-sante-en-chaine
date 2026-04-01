const express = require("express");
const { z } = require("zod");
const MedicalEvent = require("../models/MedicalEvent");
const PrescriptionRecord = require("../models/PrescriptionRecord");
const { requireAuth, requireRole } = require("../middleware/auth");
const { ROLES } = require("../config/roles");
const { normalizeWallet } = require("../utils/signature");
const blockchainService = require("../services/blockchainService");

const router = express.Router();

router.use(requireAuth);

// Allowed roles to search patient history
const AUTHORIZED_ROLES = [
  ROLES.ADMIN,
  ROLES.SUB_ADMIN,
  ROLES.MEDECIN,
  ROLES.PHARMACIE,
  ROLES.LABO,
  ROLES.HOPITAL,
  ROLES.ASSURANCE
];

router.get("/patient/:walletAddress", requireRole(AUTHORIZED_ROLES), async (req, res, next) => {
  try {
    const targetWallet = normalizeWallet(req.params.walletAddress);

    // 1. Fetch Medical Events (Visits, Lab Results, Hospital Events)
    const events = await MedicalEvent.find({ patientId: targetWallet })
      .sort({ occurredAt: -1 })
      .lean();

    // 2. Fetch Prescriptions
    const prescriptions = await PrescriptionRecord.find({ patientWallet: targetWallet })
      .sort({ issuedAt: -1 })
      .lean();

    // 3. Enrich prescriptions with blockchain status
    const prescriptionsWithStatus = await Promise.all(
      prescriptions.map(async (p) => {
        const chain = await blockchainService.verifyHash(p.recordId, p.dataHash);
        return {
          recordId: p.recordId,
          doctorWallet: p.doctorWallet,
          status: chain.status || "PRESCRIBED",
          version: p.version,
          issuedAt: p.issuedAt,
          pdfPath: p.pdfPath,
          blockchainHash: p.blockchainHash
        };
      })
    );

    // Grouping the archive
    const archive = {
      walletAddress: targetWallet,
      summary: {
        totalVisits: events.filter(e => e.eventType === "VISIT").length,
        totalLabTests: events.filter(e => e.eventType === "LAB_RESULT").length,
        totalHospitalEvents: events.filter(e => ["ADMISSION", "OPERATION", "DISCHARGE", "INTERVENTION"].includes(e.eventType)).length,
        totalPrescriptions: prescriptions.length
      },
      events: events.map(e => ({
        eventId: e._id,
        eventType: e.eventType,
        actorId: e.actorId,
        actorRole: e.actorRole,
        occurredAt: e.occurredAt,
        data: e.eventData,
        hash: e.hash,
        chainProof: e.chainProof
      })),
      prescriptions: prescriptionsWithStatus
    };

    res.json(archive);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
