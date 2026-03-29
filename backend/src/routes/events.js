const express = require("express");
const MedicalEvent = require("../models/MedicalEvent");
const { hashEventPayload } = require("../utils/hash");
const { EVENT_TYPES, ACTOR_ROLES, HASH_VERSION, EVENT_VERSION } = require("../config/events");

const router = express.Router();

function requireRole(allowedRoles) {
  return (req, res, next) => {
    const role = req.header("x-user-role");
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
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

router.get("/types", (req, res) => {
  res.json({
    eventTypes: EVENT_TYPES,
    actorRoles: ACTOR_ROLES,
    hashVersion: HASH_VERSION,
    eventVersion: EVENT_VERSION
  });
});

router.post("/", requireRole(["MEDECIN", "PHARMACIE", "HOPITAL", "LABO", "ASSURANCE"]), async (req, res) => {
  try {
    const { patientId, actorId, actorRole, eventType, eventData, occurredAt, consent, audit } = req.body;

    if (!patientId || !actorId || !actorRole || !eventType || !eventData) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!EVENT_TYPES.includes(eventType)) {
      return res.status(400).json({ error: "Unsupported eventType" });
    }

    if (!ACTOR_ROLES.includes(actorRole)) {
      return res.status(400).json({ error: "Unsupported actorRole" });
    }

    const eventDoc = new MedicalEvent({
      patientId,
      actorId,
      actorRole,
      eventType,
      eventVersion: EVENT_VERSION,
      eventData,
      occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
      hashVersion: HASH_VERSION,
      consent: consent || {},
      audit: audit || {}
    });

    const payload = buildHashPayload(eventDoc);
    eventDoc.hash = hashEventPayload(payload);

    await eventDoc.save();

    res.status(201).json({
      id: eventDoc._id,
      hash: eventDoc.hash,
      chainStatus: eventDoc.chainProof.status
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create event" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const eventDoc = await MedicalEvent.findById(req.params.id).lean();
    if (!eventDoc) {
      return res.status(404).json({ error: "Event not found" });
    }
    res.json(eventDoc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load event" });
  }
});

router.post("/:id/verify", async (req, res) => {
  try {
    const eventDoc = await MedicalEvent.findById(req.params.id);
    if (!eventDoc) {
      return res.status(404).json({ error: "Event not found" });
    }

    const payload = buildHashPayload(eventDoc);
    const computed = hashEventPayload(payload);

    res.json({
      valid: computed === eventDoc.hash,
      stored: eventDoc.hash,
      computed
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to verify event" });
  }
});

router.post("/:id/anchor", requireRole(["ASSURANCE", "ANAM"]), async (req, res) => {
  try {
    const eventDoc = await MedicalEvent.findById(req.params.id);
    if (!eventDoc) {
      return res.status(404).json({ error: "Event not found" });
    }

    const { txHash, blockNumber } = req.body;

    eventDoc.chainProof = {
      txHash: txHash || "pending",
      blockNumber: blockNumber || null,
      status: "ANCHORED"
    };

    await eventDoc.save();

    res.json({
      id: eventDoc._id,
      chainStatus: eventDoc.chainProof.status,
      txHash: eventDoc.chainProof.txHash,
      blockNumber: eventDoc.chainProof.blockNumber
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to anchor event" });
  }
});

module.exports = router;
