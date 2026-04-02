const crypto = require("crypto");
const express = require("express");
const { z } = require("zod");
const AuthNonce = require("../models/AuthNonce");
const WalletIdentity = require("../models/WalletIdentity");
const { env } = require("../config/env");
const { normalizeRole, ROLES } = require("../config/roles");
const { normalizeWallet, verifyWalletMessage } = require("../utils/signature");
const { signSessionToken } = require("../utils/jwt");
const { requireAuth } = require("../middleware/auth");
const roleService = require("../services/roleService");
const identityService = require("../services/identityService");

const router = express.Router();

const nonceSchema = z.object({
  walletAddress: z.string().min(10),
  role: z.string().min(2).optional()
});

const verifySchema = z.object({
  walletAddress: z.string().min(10),
  role: z.string().min(2).optional(),
  nonce: z.string().min(10),
  signature: z.string().min(10),
  profile: z
    .object({
      fullName: z.string().min(2).optional(),
      nickname: z.string().min(2).optional(),
      dateOfBirth: z.string().min(4).optional(),
      cabinetName: z.string().min(2).optional()
    })
    .optional()
});

function buildLoginMessage({ walletAddress, role, nonce, expiresAt }) {
  return [
    "MaSanteEnChaine Wallet Login",
    `wallet:${walletAddress}`,
    `role:${role}`,
    `nonce:${nonce}`,
    `expiresAt:${expiresAt.toISOString()}`
  ].join("\n");
}

router.post("/nonce", async (req, res, next) => {
  try {
    const parsed = nonceSchema.parse(req.body || {});
    const walletAddress = normalizeWallet(parsed.walletAddress);
    const roles = await roleService.getRolesForWallet(walletAddress);
    const identity = await identityService.getWalletIdentity(walletAddress);

    if (!roles.length) {
      return res.status(403).json({ error: "Wallet has no assigned role" });
    }

    const requestedRole = parsed.role ? normalizeRole(parsed.role) : null;

    if (requestedRole && !roles.includes(requestedRole)) {
      return res.status(403).json({ error: "Wallet is not authorized for requested role", roles });
    }

    if (requestedRole && !Object.values(ROLES).includes(requestedRole)) {
      return res.status(400).json({ error: "Unsupported role" });
    }

    const role = requestedRole || roles[0];

    const nonce = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + env.loginNonceTtlSeconds * 1000);
    const message = buildLoginMessage({ walletAddress, role, nonce, expiresAt });

    await AuthNonce.create({
      walletAddress,
      role,
      nonce,
      message,
      expiresAt
    });

    res.json({
      walletAddress,
      role,
      roles,
      identity,
      requiresProfile: !identity || !identityService.isUserProfileComplete(identity),
      nonce,
      message,
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    next(error);
  }
});

router.post("/verify", async (req, res, next) => {
  try {
    const parsed = verifySchema.parse(req.body || {});
    const walletAddress = normalizeWallet(parsed.walletAddress);
    const role = parsed.role ? normalizeRole(parsed.role) : null;

    const nonceDoc = await AuthNonce.findOne({
      walletAddress,
      nonce: parsed.nonce
    });

    if (!nonceDoc) {
      return res.status(401).json({ error: "Invalid nonce" });
    }

    if (role && role !== nonceDoc.role) {
      return res.status(401).json({ error: "Role mismatch for nonce" });
    }

    const allowedRoles = await roleService.getRolesForWallet(walletAddress);
    if (!allowedRoles.includes(nonceDoc.role)) {
      return res.status(403).json({ error: "Wallet is no longer authorized for this role" });
    }

    if (nonceDoc.usedAt) {
      return res.status(409).json({ error: "Nonce already used" });
    }

    if (nonceDoc.expiresAt.getTime() < Date.now()) {
      return res.status(401).json({ error: "Nonce expired" });
    }

    const valid = await verifyWalletMessage({
      address: walletAddress,
      message: nonceDoc.message,
      signature: parsed.signature
    });

    if (!valid) {
      return res.status(401).json({ error: "Invalid wallet signature" });
    }

    const { identity } = await identityService.ensureWalletIdentity({
      walletAddress,
      role: nonceDoc.role,
      profileInput: parsed.profile,
      actorWallet: walletAddress
    });

    const access = identityService.canAccessRole(identity, nonceDoc.role);
    if (!access.allowed) {
      return res.status(403).json({
        error: access.reason || "Access denied",
        identity
      });
    }

    nonceDoc.usedAt = new Date();
    await nonceDoc.save();

    const token = signSessionToken({
      sub: walletAddress,
      role: nonceDoc.role,
      sessionNonce: nonceDoc._id.toString()
    });

    res.json({
      token,
      walletAddress,
      role: nonceDoc.role,
      roles: allowedRoles,
      identity,
      expiresIn: env.jwtTtl
    });
  } catch (error) {
    next(error);
  }
});

router.get("/roles/:walletAddress", async (req, res, next) => {
  try {
    const walletAddress = normalizeWallet(req.params.walletAddress);
    const roles = await roleService.getRolesForWallet(walletAddress);
    res.json({ walletAddress, roles });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const [roles, identity] = await Promise.all([
      roleService.getRolesForWallet(req.auth.walletAddress),
      identityService.getWalletIdentity(req.auth.walletAddress)
    ]);

    res.json({
      walletAddress: req.auth.walletAddress,
      role: req.auth.role,
      roles,
      identity
    });
  } catch (error) {
    next(error);
  }
});

const registerSchema = z.object({
  walletAddress: z.string().min(10),
  role: z.string().min(2),
  region: z.string().min(2),
  profile: z.object({
    fullName: z.string().min(2),
    nickname: z.string().min(2),
    dateOfBirth: z.string().min(4),
    cabinetName: z.string().optional(),
    institutionName: z.string().optional(),
    departmentName: z.string().optional()
  })
});

router.post("/register", async (req, res, next) => {
  try {
    const parsed = registerSchema.parse(req.body || {});
    const walletAddress = normalizeWallet(parsed.walletAddress);
    const role = normalizeRole(parsed.role);

    // 1. Check if identity already exists and is complete
    const existingIdentity = await identityService.getWalletIdentity(walletAddress);
    if (existingIdentity && identityService.isUserProfileComplete(existingIdentity)) {
      return res.status(409).json({ error: "Identity already exists and is complete for this wallet" });
    }

    // 2. Create identity with PENDING status and region
    const { identity } = await identityService.ensureWalletIdentity({
      walletAddress,
      role,
      profileInput: {
        ...parsed.profile,
        region: parsed.region
      },
      actorWallet: walletAddress
    });

    // 3. Assign the requested role
    await roleService.assignRole({
      walletAddress,
      role,
      actorWallet: walletAddress
    });

    res.status(201).json({
      message: "Registration request submitted. Waiting for admin approval.",
      identity
    });
  } catch (error) {
    next(error);
  }
});

const relinkSchema = z.object({
  doctorWallet: z.string().min(10)
});

router.patch("/relink-doctor", requireAuth, async (req, res, next) => {
  try {
    const parsed = relinkSchema.parse(req.body || {});
    const doctorWallet = normalizeWallet(parsed.doctorWallet);

    const identity = await WalletIdentity.findOne({
      walletAddress: normalizeWallet(req.auth.walletAddress)
    });

    if (!identity) {
      return res.status(404).json({ error: "Identity not found" });
    }

    identity.primaryDoctorWallet = doctorWallet;
    await identity.save();

    res.json({
      message: "Primary doctor updated successfully",
      primaryDoctorWallet: doctorWallet
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
