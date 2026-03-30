const BlockchainAnchor = require("../models/BlockchainAnchor");
const { normalizeWallet } = require("../utils/signature");

async function storeHash({ recordId, hash, ownerWallet, authorizedWallets = [] }) {
  const owner = normalizeWallet(ownerWallet);
  const authorized = [...new Set(authorizedWallets.map(normalizeWallet).filter(Boolean))];

  const anchor = await BlockchainAnchor.create({
    recordId,
    hash,
    ownerWallet: owner,
    authorizedWallets: authorized,
    status: "PRESCRIBED"
  });

  return anchor;
}

async function verifyHash(recordId, candidateHash) {
  const anchor = await BlockchainAnchor.findOne({ recordId }).lean();
  if (!anchor) {
    return { exists: false, valid: false, storedHash: null };
  }

  return {
    exists: true,
    valid: anchor.hash === candidateHash,
    storedHash: anchor.hash,
    status: anchor.status
  };
}

async function grantAccess(recordId, wallet, requestedByWallet) {
  const actor = normalizeWallet(requestedByWallet);
  const target = normalizeWallet(wallet);
  const anchor = await BlockchainAnchor.findOne({ recordId });

  if (!anchor) {
    throw Object.assign(new Error("Anchor not found"), { status: 404, publicMessage: "On-chain anchor not found" });
  }

  if (normalizeWallet(anchor.ownerWallet) !== actor) {
    throw Object.assign(new Error("Forbidden"), { status: 403, publicMessage: "Only owner can grant access" });
  }

  const current = new Set(anchor.authorizedWallets.map(normalizeWallet));
  current.add(target);
  anchor.authorizedWallets = [...current];
  await anchor.save();
  return anchor;
}

async function revokeAccess(recordId, wallet, requestedByWallet) {
  const actor = normalizeWallet(requestedByWallet);
  const target = normalizeWallet(wallet);
  const anchor = await BlockchainAnchor.findOne({ recordId });

  if (!anchor) {
    throw Object.assign(new Error("Anchor not found"), { status: 404, publicMessage: "On-chain anchor not found" });
  }

  if (normalizeWallet(anchor.ownerWallet) !== actor) {
    throw Object.assign(new Error("Forbidden"), { status: 403, publicMessage: "Only owner can revoke access" });
  }

  anchor.authorizedWallets = anchor.authorizedWallets
    .map(normalizeWallet)
    .filter((item) => item !== target);

  await anchor.save();
  return anchor;
}

async function isAuthorized(recordId, wallet) {
  const normalized = normalizeWallet(wallet);
  const anchor = await BlockchainAnchor.findOne({ recordId }).lean();
  if (!anchor) {
    return false;
  }

  if (normalizeWallet(anchor.ownerWallet) === normalized) {
    return true;
  }

  return anchor.authorizedWallets.map(normalizeWallet).includes(normalized);
}

async function deliverPrescription(recordId, pharmacyWallet) {
  const anchor = await BlockchainAnchor.findOne({ recordId });

  if (!anchor) {
    throw Object.assign(new Error("Anchor not found"), { status: 404, publicMessage: "On-chain anchor not found" });
  }

  const pharmacy = normalizeWallet(pharmacyWallet);
  const canDeliver = anchor.authorizedWallets.map(normalizeWallet).includes(pharmacy);

  if (!canDeliver) {
    throw Object.assign(new Error("Forbidden"), { status: 403, publicMessage: "Pharmacy not authorized for this prescription" });
  }

  if (anchor.status === "DELIVERED") {
    throw Object.assign(new Error("Already delivered"), { status: 409, publicMessage: "Prescription already delivered" });
  }

  if (anchor.status === "CANCELLED") {
    throw Object.assign(new Error("Cancelled"), { status: 409, publicMessage: "Prescription is cancelled" });
  }

  anchor.status = "DELIVERED";
  await anchor.save();
  return anchor;
}

async function cancelPrescription(recordId) {
  const anchor = await BlockchainAnchor.findOne({ recordId });
  if (!anchor) {
    throw Object.assign(new Error("Anchor not found"), { status: 404, publicMessage: "On-chain anchor not found" });
  }
  anchor.status = "CANCELLED";
  await anchor.save();
  return anchor;
}

module.exports = {
  storeHash,
  verifyHash,
  grantAccess,
  revokeAccess,
  isAuthorized,
  deliverPrescription,
  cancelPrescription
};
