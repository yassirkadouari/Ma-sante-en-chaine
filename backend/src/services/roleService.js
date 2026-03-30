const WalletRole = require("../models/WalletRole");
const { env } = require("../config/env");
const { ROLES, normalizeRole } = require("../config/roles");
const { normalizeWallet } = require("../utils/signature");

function normalizeRoleList(items) {
  return [...new Set(items.map(normalizeRole).filter((role) => Object.values(ROLES).includes(role)))];
}

async function getRolesForWallet(walletAddress) {
  const wallet = normalizeWallet(walletAddress);

  const dbRoles = await WalletRole.find({ walletAddress: wallet }).lean();
  const configuredAdmin = env.adminWallets
    .map(normalizeWallet)
    .includes(wallet)
    ? [ROLES.ADMIN]
    : [];

  return normalizeRoleList([...dbRoles.map((item) => item.role), ...configuredAdmin]);
}

async function assignRole({ walletAddress, role, actorWallet }) {
  const wallet = normalizeWallet(walletAddress);
  const normalizedRole = normalizeRole(role);

  if (!Object.values(ROLES).includes(normalizedRole)) {
    throw Object.assign(new Error("Unsupported role"), { status: 400, publicMessage: "Unsupported role" });
  }

  const doc = await WalletRole.findOneAndUpdate(
    { walletAddress: wallet, role: normalizedRole },
    {
      $set: {
        updatedByWallet: normalizeWallet(actorWallet)
      },
      $setOnInsert: {
        createdByWallet: normalizeWallet(actorWallet)
      }
    },
    { upsert: true, new: true }
  );

  return doc;
}

async function revokeRole({ walletAddress, role }) {
  const wallet = normalizeWallet(walletAddress);
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === ROLES.ADMIN && env.adminWallets.map(normalizeWallet).includes(wallet)) {
    throw Object.assign(new Error("Forbidden"), {
      status: 403,
      publicMessage: "Cannot revoke ADMIN role configured via ADMIN_WALLETS"
    });
  }

  await WalletRole.deleteOne({ walletAddress: wallet, role: normalizedRole });
}

async function listWalletRoles() {
  const rows = await WalletRole.find({}).sort({ walletAddress: 1, role: 1 }).lean();
  const byWallet = new Map();

  for (const row of rows) {
    if (!byWallet.has(row.walletAddress)) {
      byWallet.set(row.walletAddress, new Set());
    }
    byWallet.get(row.walletAddress).add(row.role);
  }

  for (const adminWallet of env.adminWallets.map(normalizeWallet)) {
    if (!byWallet.has(adminWallet)) {
      byWallet.set(adminWallet, new Set());
    }
    byWallet.get(adminWallet).add(ROLES.ADMIN);
  }

  return [...byWallet.entries()].map(([walletAddress, roles]) => ({
    walletAddress,
    roles: [...roles].sort()
  }));
}

module.exports = {
  getRolesForWallet,
  assignRole,
  revokeRole,
  listWalletRoles
};
