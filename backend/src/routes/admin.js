const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { requireSignedRequest } = require("../middleware/requestSignature");
const { ROLES } = require("../config/roles");
const roleService = require("../services/roleService");
const { logAudit } = require("../services/auditService");

const router = express.Router();

const assignSchema = z.object({
  walletAddress: z.string().min(10),
  role: z.string().min(2)
});

router.use(requireAuth);
router.use(requireRole([ROLES.ADMIN]));

router.get("/users", async (req, res, next) => {
  try {
    const items = await roleService.listWalletRoles();
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.post("/users", requireSignedRequest, async (req, res, next) => {
  try {
    const parsed = assignSchema.parse(req.body || {});
    const doc = await roleService.assignRole({
      walletAddress: parsed.walletAddress,
      role: parsed.role,
      actorWallet: req.auth.walletAddress
    });

    await logAudit({
      action: "ROLE_ASSIGNED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      requestId: req.requestId,
      ip: req.ip,
      metadata: {
        walletAddress: doc.walletAddress,
        role: doc.role
      }
    });

    res.status(201).json({
      walletAddress: doc.walletAddress,
      role: doc.role
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/users", requireSignedRequest, async (req, res, next) => {
  try {
    const parsed = assignSchema.parse(req.body || {});
    await roleService.revokeRole({
      walletAddress: parsed.walletAddress,
      role: parsed.role
    });

    await logAudit({
      action: "ROLE_REVOKED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      requestId: req.requestId,
      ip: req.ip,
      metadata: {
        walletAddress: parsed.walletAddress,
        role: parsed.role
      }
    });

    res.json({
      walletAddress: parsed.walletAddress,
      role: parsed.role,
      revoked: true
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
