const WalletIdentity = require("../models/WalletIdentity");
const { ROLES, normalizeRole } = require("../config/roles");
const { normalizeWallet } = require("../utils/signature");

const detailsManagedRoles = new Set([ROLES.HOPITAL, ROLES.ASSURANCE, ROLES.PHARMACIE, ROLES.MEDECIN, ROLES.LABO]);
const employmentApprovalRoles = new Set([ROLES.HOPITAL, ROLES.ASSURANCE, ROLES.PHARMACIE, ROLES.LABO]);
const PENDING_PROFILE_MARKER = "PENDING_PROFILE";

function normalizeOptional(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const text = String(value).trim();
  return text ? text : undefined;
}

function normalizeDateOfBirth(value) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error("Invalid dateOfBirth"), {
      status: 400,
      publicMessage: "Invalid dateOfBirth"
    });
  }

  const now = new Date();
  if (date.getTime() >= now.getTime()) {
    throw Object.assign(new Error("Invalid dateOfBirth"), {
      status: 400,
      publicMessage: "dateOfBirth must be in the past"
    });
  }

  return date;
}

function normalizeProfileInput(profileInput, role) {
  const normalizedRole = normalizeRole(role);

  if (!profileInput || typeof profileInput !== "object") {
    throw Object.assign(new Error("Identity profile is required"), {
      status: 400,
      publicMessage: "Identity profile is required"
    });
  }

  const fullName = normalizeOptional(profileInput.fullName);
  const nickname = normalizeOptional(profileInput.nickname);
  const dateOfBirthRaw = normalizeOptional(profileInput.dateOfBirth);
  const cabinetName = normalizeOptional(profileInput.cabinetName);

  if (!fullName || fullName.length < 2) {
    throw Object.assign(new Error("Invalid fullName"), {
      status: 400,
      publicMessage: "fullName is required"
    });
  }

  if (!nickname || nickname.length < 2) {
    throw Object.assign(new Error("Invalid nickname"), {
      status: 400,
      publicMessage: "nickname is required"
    });
  }

  if (!dateOfBirthRaw) {
    throw Object.assign(new Error("Invalid dateOfBirth"), {
      status: 400,
      publicMessage: "dateOfBirth is required"
    });
  }

  const dateOfBirth = normalizeDateOfBirth(dateOfBirthRaw);
  const region = normalizeOptional(profileInput.region);

  if (normalizedRole === ROLES.MEDECIN && !cabinetName) {
    throw Object.assign(new Error("Missing cabinetName"), {
      status: 400,
      publicMessage: "cabinetName is required for MEDECIN role"
    });
  }

  return {
    role: normalizedRole,
    fullName,
    nickname,
    dateOfBirth,
    cabinetName,
    region
  };
}

function normalizeRoleDetailsInput(role, institutionName, departmentName) {
  const normalizedRole = normalizeRole(role);
  if (!detailsManagedRoles.has(normalizedRole)) {
    throw Object.assign(new Error("Unsupported role for details mapping"), {
      status: 400,
      publicMessage: "Details can only be set for HOPITAL, ASSURANCE, PHARMACIE, MEDECIN, LABO"
    });
  }

  const normalizedInstitution = normalizeOptional(institutionName);
  const normalizedDepartment = normalizeOptional(departmentName);

  if (normalizedRole !== ROLES.MEDECIN && !normalizedInstitution) {
    throw Object.assign(new Error("Invalid institutionName"), {
      status: 400,
      publicMessage: "institutionName is required"
    });
  }

  if (!normalizedDepartment) {
    throw Object.assign(new Error("Invalid departmentName"), {
      status: 400,
      publicMessage: "departmentName is required"
    });
  }

  return {
    role: normalizedRole,
    institutionName: normalizedInstitution,
    departmentName: normalizedDepartment
  };
}

function toPublicIdentity(doc) {
  if (!doc) {
    return null;
  }

  const { env } = require("../config/env");
  const isGlobal = doc.isGlobalAdmin || env.adminWallets.map(normalizeWallet).includes(normalizeWallet(doc.walletAddress));

  return {
    walletAddress: doc.walletAddress,
    role: doc.role,
    fullName: doc.fullName,
    nickname: doc.nickname,
    dateOfBirth: doc.dateOfBirth.toISOString().slice(0, 10),
    region: doc.region || null,
    isGlobalAdmin: isGlobal,
    cabinetName: doc.cabinetName || null,
    institutionName: doc.institutionName || null,
    departmentName: doc.departmentName || null,
    approvalStatus: doc.approvalStatus || "PENDING",
    approvedByWallet: doc.approvedByWallet || null,
    approvedAt: doc.approvedAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

function isUserProfileComplete(identity) {
  if (!identity) {
    return false;
  }

  const fullName = normalizeOptional(identity.fullName);
  const nickname = normalizeOptional(identity.nickname);
  if (!fullName || !nickname) {
    return false;
  }

  if (fullName === PENDING_PROFILE_MARKER || nickname === PENDING_PROFILE_MARKER) {
    return false;
  }

  const dob = new Date(identity.dateOfBirth);
  if (Number.isNaN(dob.getTime())) {
    return false;
  }

  // Placeholder dates from bootstrap profiles should force first-login completion.
  if (dob.getFullYear() <= 1900) {
    return false;
  }

  return true;
}

async function getWalletIdentity(walletAddress) {
  const wallet = normalizeWallet(walletAddress);
  const doc = await WalletIdentity.findOne({ walletAddress: wallet }).lean();
  
  if (!doc) {
    // Check if wallet has an assigned role in the DB or via env config
    const WalletRole = require("../models/WalletRole");
    const { env } = require("../config/env");
    
    const dbRoles = await WalletRole.find({ walletAddress: wallet }).lean();
    const isBootstrappedAdmin = env.adminWallets.map(normalizeWallet).includes(wallet);
    
    if (dbRoles.length > 0 || isBootstrappedAdmin) {
        const primaryRole = isBootstrappedAdmin ? ROLES.ADMIN : dbRoles[0].role;
        return {
            walletAddress: wallet,
            role: primaryRole,
            fullName: "Utilisateur Autorisé",
            nickname: "User",
            dateOfBirth: "1970-01-01",
            isGlobalAdmin: isBootstrappedAdmin || dbRoles.some(r => r.role === ROLES.ADMIN),
            approvalStatus: "APPROVED", // Already approved by role assignment
            isPlaceholder: true
        };
    }
  }

  return toPublicIdentity(doc);
}

async function ensureWalletIdentity({ walletAddress, role, profileInput, actorWallet, institutionName, departmentName }) {
  const wallet = normalizeWallet(walletAddress);
  const existing = await WalletIdentity.findOne({ walletAddress: wallet });

  if (existing) {
    const normalizedRole = normalizeRole(role);
    let mustSave = false;

    if (existing.role !== normalizedRole) {
      existing.role = normalizedRole;
      if (!existing.approvalStatus) {
        existing.approvalStatus = "PENDING";
      }
      mustSave = true;
    }

    if (profileInput && !isUserProfileComplete(existing)) {
      const normalizedProfile = normalizeProfileInput(profileInput, normalizedRole);
      existing.fullName = normalizedProfile.fullName;
      existing.nickname = normalizedProfile.nickname;
      existing.dateOfBirth = normalizedProfile.dateOfBirth;
      existing.cabinetName = normalizedProfile.cabinetName;
      existing.region = normalizedProfile.region;
      existing.updatedByWallet = normalizeWallet(actorWallet || walletAddress);
      mustSave = true;
    }

    if (mustSave) {
      await existing.save();
    }

    return { identity: toPublicIdentity(existing), created: false };
  }

  // If no DB record exists, check if this wallet is pre-authorized
  const WalletRole = require("../models/WalletRole");
  const { env } = require("../config/env");
  const isBootstrappedAdmin = env.adminWallets.map(normalizeWallet).includes(wallet);
  const dbRoles = await WalletRole.find({ walletAddress: wallet }).lean();

  if (!profileInput && (isBootstrappedAdmin || dbRoles.length > 0)) {
    // Create skeletal identity for pre-authorized users
    const primaryRole = isBootstrappedAdmin ? ROLES.ADMIN : dbRoles[0].role;
    const actor = normalizeWallet(actorWallet || walletAddress);
    
    const created = await WalletIdentity.create({
      walletAddress: wallet,
      role: primaryRole,
      fullName: PENDING_PROFILE_MARKER,
      nickname: PENDING_PROFILE_MARKER,
      dateOfBirth: new Date("1970-01-01"),
      approvalStatus: "APPROVED",
      isGlobalAdmin: isBootstrappedAdmin || dbRoles.some(r => r.role === ROLES.ADMIN),
      createdByWallet: actor,
      updatedByWallet: actor,
      institutionName: normalizeOptional(institutionName),
      departmentName: normalizeOptional(departmentName)
    });
    
    return { identity: toPublicIdentity(created), created: true };
  }

  // Standard path for new users (e.g. Patients) who MUST provide a profile
  const normalizedProfile = normalizeProfileInput(profileInput, role);
  const actor = normalizeWallet(actorWallet || walletAddress);

  const created = await WalletIdentity.create({
    walletAddress: wallet,
    ...normalizedProfile,
    approvalStatus: (role === ROLES.PATIENT || actor !== wallet) ? "APPROVED" : "PENDING",
    createdByWallet: actor,
    updatedByWallet: actor
  });

  return { identity: toPublicIdentity(created), created: true };
}

async function upsertWalletIdentity({ walletAddress, role, profileInput, actorWallet }) {
  const wallet = normalizeWallet(walletAddress);
  const normalizedProfile = normalizeProfileInput(profileInput, role);
  const actor = normalizeWallet(actorWallet || walletAddress);

  const doc = await WalletIdentity.findOneAndUpdate(
    { walletAddress: wallet },
    {
      $set: {
        ...normalizedProfile,
        approvalStatus: "PENDING",
        updatedByWallet: actor
      },
      $setOnInsert: {
        createdByWallet: actor
      }
    },
    { upsert: true, new: true }
  );

  return toPublicIdentity(doc);
}

async function setRoleDetailsByAdmin({ walletAddress, role, institutionName, departmentName, actorWallet }) {
  const wallet = normalizeWallet(walletAddress);
  const normalized = normalizeRoleDetailsInput(role, institutionName, departmentName);
  const actor = normalizeWallet(actorWallet || walletAddress);

  let existing = await WalletIdentity.findOne({ walletAddress: wallet });
  if (!existing) {
    existing = await WalletIdentity.create({
      walletAddress: wallet,
      role: normalized.role,
      fullName: PENDING_PROFILE_MARKER,
      nickname: PENDING_PROFILE_MARKER,
      dateOfBirth: new Date("1900-01-01"),
      institutionName: normalized.institutionName,
      departmentName: normalized.departmentName,
      doctorApprovalStatus: normalized.role === ROLES.MEDECIN ? "PENDING" : "APPROVED",
      createdByWallet: actor,
      updatedByWallet: actor
    });

    return toPublicIdentity(existing);
  }

  existing.role = normalized.role;
  existing.institutionName = normalized.institutionName || existing.institutionName;
  existing.departmentName = normalized.departmentName;
  existing.updatedByWallet = actor;
  await existing.save();

  return toPublicIdentity(existing);
}

async function setUserApprovalByAdmin({ walletAddress, approved, actorWallet }) {
  const wallet = normalizeWallet(walletAddress);
  const actor = normalizeWallet(actorWallet || walletAddress);
  const status = approved ? "APPROVED" : "REJECTED";

  const doc = await WalletIdentity.findOne({ walletAddress: wallet });

  if (!doc) {
    throw Object.assign(new Error("Identity not found"), {
      status: 404,
      publicMessage: "Wallet identity not found"
    });
  }

  const adminIdentity = await WalletIdentity.findOne({ walletAddress: actor });
  const { env } = require("../config/env");
  const isBootstrappedGlobalAdmin = env.adminWallets
    .map(normalizeWallet)
    .includes(actor);

  const canApproveAsGlobalAdmin =
    isBootstrappedGlobalAdmin ||
    (adminIdentity && (adminIdentity.isGlobalAdmin || adminIdentity.role === ROLES.ADMIN));

  const canApproveAsRegionalAdmin = adminIdentity && adminIdentity.role === ROLES.SUB_ADMIN;

  if (!canApproveAsGlobalAdmin && !canApproveAsRegionalAdmin) {
    throw Object.assign(new Error("Unauthorized"), { status: 403 });
  }

  if (canApproveAsRegionalAdmin && adminIdentity.region !== doc.region) {
    throw Object.assign(new Error("Permission denied: user is in a different region"), {
      status: 403,
      publicMessage: "Vous ne pouvez approuver que les utilisateurs de votre région."
    });
  }

  doc.approvalStatus = status;
  doc.approvedByWallet = actor;
  doc.approvedAt = new Date();
  doc.updatedByWallet = actor;
  await doc.save();

  return toPublicIdentity(doc);
}

function canAccessRole(identity, role) {
  const normalizedRole = normalizeRole(role);
  if (!identity) {
    return { allowed: false, reason: "Identity profile missing" };
  }

  // ADMIN/SUB_ADMIN roles and validated Global Admins bypass approval checks
  if (normalizedRole === ROLES.ADMIN || normalizedRole === ROLES.SUB_ADMIN || identity.isGlobalAdmin) {
    return { allowed: true };
  }

  // Admin approval required for all roles except PATIENT
  if (normalizedRole !== ROLES.PATIENT && identity.approvalStatus !== "APPROVED") {
    return { allowed: false, reason: "Votre compte est en attente de validation par un administrateur." };
  }

  if (normalizedRole === ROLES.MEDECIN && identity.doctorApprovalStatus && identity.doctorApprovalStatus !== "APPROVED") {
    return { allowed: false, reason: "Compte medecin en attente de validation administrateur" };
  }

  if (employmentApprovalRoles.has(normalizedRole)) {
    if (!identity.institutionName || !identity.departmentName) {
      return {
        allowed: false,
        reason: "Compte en attente: l'administrateur doit renseigner institut et departement"
      };
    }
  }

  return { allowed: true };
}

module.exports = {
  getWalletIdentity,
  ensureWalletIdentity,
  upsertWalletIdentity,
  setRoleDetailsByAdmin,
  setUserApprovalByAdmin,
  isUserProfileComplete,
  canAccessRole,
  toPublicIdentity
};
