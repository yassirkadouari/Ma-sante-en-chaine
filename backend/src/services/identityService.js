const WalletIdentity = require("../models/WalletIdentity");
const { ROLES, normalizeRole } = require("../config/roles");
const { normalizeWallet } = require("../utils/signature");

const detailsManagedRoles = new Set([ROLES.HOPITAL, ROLES.ASSURANCE, ROLES.PHARMACIE, ROLES.MEDECIN]);
const employmentApprovalRoles = new Set([ROLES.HOPITAL, ROLES.ASSURANCE, ROLES.PHARMACIE]);
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
    cabinetName
  };
}

function normalizeRoleDetailsInput(role, institutionName, departmentName) {
  const normalizedRole = normalizeRole(role);
  if (!detailsManagedRoles.has(normalizedRole)) {
    throw Object.assign(new Error("Unsupported role for details mapping"), {
      status: 400,
      publicMessage: "Details can only be set for HOPITAL, ASSURANCE, PHARMACIE, MEDECIN"
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

  return {
    walletAddress: doc.walletAddress,
    role: doc.role,
    fullName: doc.fullName,
    nickname: doc.nickname,
    dateOfBirth: doc.dateOfBirth.toISOString().slice(0, 10),
    cabinetName: doc.cabinetName || null,
    institutionName: doc.institutionName || null,
    departmentName: doc.departmentName || null,
    doctorApprovalStatus: doc.doctorApprovalStatus || "APPROVED",
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
  return toPublicIdentity(doc);
}

async function ensureWalletIdentity({ walletAddress, role, profileInput, actorWallet }) {
  const wallet = normalizeWallet(walletAddress);
  const existing = await WalletIdentity.findOne({ walletAddress: wallet });

  if (existing) {
    const normalizedRole = normalizeRole(role);
    let mustSave = false;

    if (existing.role !== normalizedRole) {
      existing.role = normalizedRole;
      if (normalizedRole === ROLES.MEDECIN && !existing.doctorApprovalStatus) {
        existing.doctorApprovalStatus = "PENDING";
      }
      mustSave = true;
    }

    if (profileInput && !isUserProfileComplete(existing)) {
      const normalizedProfile = normalizeProfileInput(profileInput, normalizedRole);
      existing.fullName = normalizedProfile.fullName;
      existing.nickname = normalizedProfile.nickname;
      existing.dateOfBirth = normalizedProfile.dateOfBirth;
      existing.cabinetName = normalizedProfile.cabinetName;
      existing.updatedByWallet = normalizeWallet(actorWallet || walletAddress);
      mustSave = true;
    }

    if (mustSave) {
      await existing.save();
    }

    return { identity: toPublicIdentity(existing), created: false };
  }

  const normalizedProfile = normalizeProfileInput(profileInput, role);
  const actor = normalizeWallet(actorWallet || walletAddress);
  const isDoctor = normalizedProfile.role === ROLES.MEDECIN;

  const created = await WalletIdentity.create({
    walletAddress: wallet,
    ...normalizedProfile,
    doctorApprovalStatus: isDoctor ? "PENDING" : "APPROVED",
    createdByWallet: actor,
    updatedByWallet: actor
  });

  return { identity: toPublicIdentity(created), created: true };
}

async function upsertWalletIdentity({ walletAddress, role, profileInput, actorWallet }) {
  const wallet = normalizeWallet(walletAddress);
  const normalizedProfile = normalizeProfileInput(profileInput, role);
  const actor = normalizeWallet(actorWallet || walletAddress);
  const isDoctor = normalizedProfile.role === ROLES.MEDECIN;

  const doc = await WalletIdentity.findOneAndUpdate(
    { walletAddress: wallet },
    {
      $set: {
        ...normalizedProfile,
        doctorApprovalStatus: isDoctor ? "PENDING" : "APPROVED",
        approvedByWallet: isDoctor ? undefined : actor,
        approvedAt: isDoctor ? undefined : new Date(),
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

async function setDoctorApprovalByAdmin({ walletAddress, approved, actorWallet }) {
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

  if (doc.role !== ROLES.MEDECIN) {
    throw Object.assign(new Error("Not a medecin role"), {
      status: 400,
      publicMessage: "Doctor approval is only available for MEDECIN"
    });
  }

  doc.doctorApprovalStatus = status;
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

  if (identity.role !== normalizedRole) {
    return { allowed: true };
  }

  if (normalizedRole === ROLES.MEDECIN && identity.doctorApprovalStatus !== "APPROVED") {
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
  setDoctorApprovalByAdmin,
  isUserProfileComplete,
  canAccessRole,
  toPublicIdentity
};
