const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { requireSignedRequest } = require("../middleware/requestSignature");
const { ROLES, normalizeRole } = require("../config/roles");
const roleService = require("../services/roleService");
const identityService = require("../services/identityService");
const { logAudit } = require("../services/auditService");

const router = express.Router();

const assignSchema = z.object({
  walletAddress: z.string().min(10),
  role: z.string().min(2),
  region: z.string().optional(),
  institutionName: z.string().optional(),
  departmentName: z.string().optional()
});

const institutionSchema = z.object({
  walletAddress: z.string().min(10),
  role: z.string().min(2),
  institutionName: z.string().min(2).optional(),
  departmentName: z.string().min(2)
});

const userApprovalSchema = z.object({
  walletAddress: z.string().min(10),
  approved: z.boolean()
});

router.use(requireAuth);
router.use(requireRole([ROLES.ADMIN, ROLES.SUB_ADMIN]));

router.get("/users", async (req, res, next) => {
  try {
    const roles = await roleService.listWalletRoles();
    const withIdentity = await Promise.all(
      roles.map(async (item) => ({
        ...item,
        identity: await identityService.getWalletIdentity(item.walletAddress)
      }))
    );

    const callerIdentity = await identityService.getWalletIdentity(req.auth.walletAddress);
    let items = withIdentity;

    if (callerIdentity && callerIdentity.role === ROLES.SUB_ADMIN && !callerIdentity.isGlobalAdmin) {
      // Sub-admins only see users in their region (or users with no region yet who are pending)
      items = withIdentity.filter(user => 
        user.identity && (user.identity.region === callerIdentity.region || !user.identity.region)
      );
    }

    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.post("/users", requireSignedRequest, async (req, res, next) => {
  try {
    const parsed = assignSchema.parse(req.body || {});
    const callerIdentity = await identityService.getWalletIdentity(req.auth.walletAddress);

    // Security Check: Only Global Admin can create other Admins or Sub-Admins
    const targetRole = normalizeRole(parsed.role);
    const isGlobal = callerIdentity?.isGlobalAdmin;

    if (!isGlobal && (targetRole === ROLES.ADMIN || targetRole === ROLES.SUB_ADMIN)) {
      return res.status(403).json({ error: "Seul l'administrateur global peut créer des comptes administratifs." });
    }

    // Security Check: Sub-Admin can only manage users in their own region
    if (!isGlobal && callerIdentity?.role === ROLES.SUB_ADMIN) {
      if (parsed.region && parsed.region !== callerIdentity.region) {
        return res.status(403).json({ error: "Vous ne pouvez assigner des rôles qu'au sein de votre propre région." });
      }
      // Force the region to the caller's region if not specified or for consistency
      parsed.region = callerIdentity.region;
    }

    const doc = await roleService.assignRole({
      walletAddress: parsed.walletAddress,
      role: parsed.role,
      actorWallet: req.auth.walletAddress
    });

    if (parsed.region) {
      await identityService.ensureWalletIdentity({
        walletAddress: parsed.walletAddress,
        role: parsed.role,
        profileInput: {
          fullName: "PENDING_PROFILE",
          nickname: "User",
          dateOfBirth: "1970-01-01",
          region: parsed.region
        },
        actorWallet: req.auth.walletAddress,
        institutionName: parsed.institutionName,
        departmentName: parsed.departmentName
      });
    } else if (parsed.institutionName || parsed.departmentName) {
      await identityService.ensureWalletIdentity({
        walletAddress: parsed.walletAddress,
        role: parsed.role,
        actorWallet: req.auth.walletAddress,
        institutionName: parsed.institutionName,
        departmentName: parsed.departmentName
      });
    }

    await logAudit({
      action: "ROLE_ASSIGNED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      requestId: req.requestId,
      ip: req.ip,
      metadata: {
        walletAddress: doc.walletAddress,
        role: doc.role,
        region: parsed.region || null
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

router.patch("/users/institution", requireSignedRequest, async (req, res, next) => {
  try {
    const parsed = institutionSchema.parse(req.body || {});

    const callerIdentity = await identityService.getWalletIdentity(req.auth.walletAddress);
    const targetIdentity = await identityService.getWalletIdentity(parsed.walletAddress);
    const isGlobal = callerIdentity?.isGlobalAdmin;

    // Security Check: Sub-Admin can only update institutions in their own region
    if (!isGlobal && callerIdentity?.role === ROLES.SUB_ADMIN) {
      if (targetIdentity && targetIdentity.region !== callerIdentity.region) {
        return res.status(403).json({ error: "Vous ne pouvez mettre à jour les institutions qu'au sein de votre propre région." });
      }
    }

    // Keep role registry and identity details in sync for a single admin action.
    await roleService.assignRole({
      walletAddress: parsed.walletAddress,
      role: parsed.role,
      actorWallet: req.auth.walletAddress
    });

    const identity = await identityService.setRoleDetailsByAdmin({
      walletAddress: parsed.walletAddress,
      role: parsed.role,
      institutionName: parsed.institutionName,
      departmentName: parsed.departmentName,
      actorWallet: req.auth.walletAddress
    });

    await logAudit({
      action: "INSTITUTION_UPDATED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      requestId: req.requestId,
      ip: req.ip,
      metadata: {
        walletAddress: parsed.walletAddress,
        role: parsed.role,
        institutionName: parsed.institutionName || null,
        departmentName: parsed.departmentName
      }
    });

    res.json({
      walletAddress: parsed.walletAddress,
      role: parsed.role,
      institutionName: parsed.institutionName || null,
      departmentName: parsed.departmentName,
      identity
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/users/approval", requireSignedRequest, async (req, res, next) => {
  try {
    const parsed = userApprovalSchema.parse(req.body || {});
    
    const callerIdentity = await identityService.getWalletIdentity(req.auth.walletAddress);
    const targetIdentity = await identityService.getWalletIdentity(parsed.walletAddress);
    const isGlobal = callerIdentity?.isGlobalAdmin;

    // Security Check: Sub-Admin can only approve/reject users in their own region
    if (!isGlobal && callerIdentity?.role === ROLES.SUB_ADMIN) {
      if (targetIdentity && targetIdentity.region !== callerIdentity.region) {
        return res.status(403).json({ error: "Vous ne pouvez approuver des utilisateurs qu'au sein de votre propre région." });
      }
    }

    const identity = await identityService.setUserApprovalByAdmin({
      walletAddress: parsed.walletAddress,
      approved: parsed.approved,
      actorWallet: req.auth.walletAddress
    });

    await logAudit({
      action: parsed.approved ? "USER_APPROVED" : "USER_REJECTED",
      actorWallet: req.auth.walletAddress,
      actorRole: req.auth.role,
      requestId: req.requestId,
      ip: req.ip,
      metadata: {
        walletAddress: parsed.walletAddress,
        role: identity.role
      }
    });

    res.json({ walletAddress: parsed.walletAddress, approved: parsed.approved, identity });
  } catch (error) {
    next(error);
  }
});

router.delete("/users", requireSignedRequest, async (req, res, next) => {
  try {
    const parsed = assignSchema.parse(req.body || {});
    const callerIdentity = await identityService.getWalletIdentity(req.auth.walletAddress);
    const targetIdentity = await identityService.getWalletIdentity(parsed.walletAddress);

    const isGlobal = callerIdentity?.isGlobalAdmin;

    // Security Check: Sub-Admin can only revoke roles in their own region
    if (!isGlobal && callerIdentity?.role === ROLES.SUB_ADMIN) {
      if (targetIdentity && targetIdentity.region !== callerIdentity.region) {
        return res.status(403).json({ error: "Vous ne pouvez révoquer des rôles qu'au sein de votre propre région." });
      }
    }

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
