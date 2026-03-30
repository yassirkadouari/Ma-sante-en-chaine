const crypto = require("crypto");
const express = require("express");
const { z } = require("zod");
const AuthNonce = require("../models/AuthNonce");
const { env } = require("../config/env");
const { normalizeRole, ROLES } = require("../config/roles");
const { normalizeWallet, verifyWalletMessage } = require("../utils/signature");
const { signSessionToken } = require("../utils/jwt");
const { requireAuth } = require("../middleware/auth");
const roleService = require("../services/roleService");

const router = express.Router();

const nonceSchema = z.object({
  walletAddress: z.string().min(10),
  role: z.string().min(2).optional()
});

const verifySchema = z.object({
  walletAddress: z.string().min(10),
  role: z.string().min(2).optional(),
  nonce: z.string().min(10),
  signature: z.string().min(10)
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
    const roles = await roleService.getRolesForWallet(req.auth.walletAddress);
    res.json({
      walletAddress: req.auth.walletAddress,
      role: req.auth.role,
      roles
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
