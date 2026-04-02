const BlockchainAnchor = require("../models/BlockchainAnchor");
const { normalizeWallet } = require("../utils/signature");

const blockchainMode = String(process.env.BLOCKCHAIN_MODE || "mock").trim().toLowerCase();
const blockchainApiUrl = String(process.env.BLOCKCHAIN_API_URL || "").trim();
const blockchainTimeoutMs = Number(process.env.BLOCKCHAIN_TIMEOUT_MS || 8000);

function isRemoteMode() {
  return blockchainMode === "remote";
}

function withStatusError(message, status, publicMessage) {
  return Object.assign(new Error(message), {
    status,
    publicMessage: publicMessage || message
  });
}

async function remoteRequest(path, payload) {
  if (!blockchainApiUrl) {
    throw withStatusError(
      "BLOCKCHAIN_API_URL is required when BLOCKCHAIN_MODE=remote",
      503,
      "Blockchain service unavailable"
    );
  }

  if (typeof fetch !== "function") {
    throw withStatusError(
      "Global fetch is unavailable in this Node runtime",
      503,
      "Blockchain service unavailable"
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), blockchainTimeoutMs);

  try {
    const response = await fetch(`${blockchainApiUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
      signal: controller.signal
    });

    let body = {};
    try {
      body = await response.json();
    } catch (error) {
      body = {};
    }

    if (!response.ok) {
      throw withStatusError(
        body.error || `Blockchain API error (${response.status})`,
        response.status,
        body.error || "Blockchain operation failed"
      );
    }

    return body;
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw withStatusError("Blockchain request timeout", 504, "Blockchain request timeout");
    }
    if (error && typeof error.status === "number") {
      throw error;
    }
    throw withStatusError("Blockchain service unreachable", 503, "Blockchain service unreachable");
  } finally {
    clearTimeout(timeout);
  }
}

async function mockStoreHash({ recordId, hash, ownerWallet, authorizedWallets = [] }) {
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

async function mockVerifyHash(recordId, candidateHash) {
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

async function mockGrantAccess(recordId, wallet, requestedByWallet) {
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

async function mockRevokeAccess(recordId, wallet, requestedByWallet) {
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

async function mockIsAuthorized(recordId, wallet) {
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

async function mockDeliverPrescription(recordId, pharmacyWallet) {
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

async function mockCancelPrescription(recordId) {
  const anchor = await BlockchainAnchor.findOne({ recordId });
  if (!anchor) {
    throw Object.assign(new Error("Anchor not found"), { status: 404, publicMessage: "On-chain anchor not found" });
  }
  anchor.status = "CANCELLED";
  await anchor.save();
  return anchor;
}

async function storeHash({ recordId, hash, ownerWallet, authorizedWallets = [] }) {
  if (!isRemoteMode()) {
    return mockStoreHash({ recordId, hash, ownerWallet, authorizedWallets });
  }

  const result = await remoteRequest("/anchors/store", {
    recordId,
    hash,
    ownerWallet: normalizeWallet(ownerWallet),
    authorizedWallets: [...new Set((authorizedWallets || []).map(normalizeWallet).filter(Boolean))]
  });

  return result.anchor || result;
}

async function verifyHash(recordId, candidateHash) {
  if (!isRemoteMode()) {
    return mockVerifyHash(recordId, candidateHash);
  }

  const result = await remoteRequest("/anchors/verify", {
    recordId,
    candidateHash
  });

  return {
    exists: Boolean(result.exists),
    valid: Boolean(result.valid),
    storedHash: result.storedHash || null,
    status: result.status || null
  };
}

async function grantAccess(recordId, wallet, requestedByWallet) {
  if (!isRemoteMode()) {
    return mockGrantAccess(recordId, wallet, requestedByWallet);
  }

  const result = await remoteRequest("/anchors/grant", {
    recordId,
    wallet: normalizeWallet(wallet),
    requestedByWallet: normalizeWallet(requestedByWallet)
  });

  return result.anchor || result;
}

async function revokeAccess(recordId, wallet, requestedByWallet) {
  if (!isRemoteMode()) {
    return mockRevokeAccess(recordId, wallet, requestedByWallet);
  }

  const result = await remoteRequest("/anchors/revoke", {
    recordId,
    wallet: normalizeWallet(wallet),
    requestedByWallet: normalizeWallet(requestedByWallet)
  });

  return result.anchor || result;
}

async function isAuthorized(recordId, wallet) {
  if (!isRemoteMode()) {
    return mockIsAuthorized(recordId, wallet);
  }

  const result = await remoteRequest("/anchors/is-authorized", {
    recordId,
    wallet: normalizeWallet(wallet)
  });

  return Boolean(result.authorized);
}

async function deliverPrescription(recordId, pharmacyWallet) {
  if (!isRemoteMode()) {
    return mockDeliverPrescription(recordId, pharmacyWallet);
  }

  const result = await remoteRequest("/anchors/deliver", {
    recordId,
    pharmacyWallet: normalizeWallet(pharmacyWallet)
  });

  return result.anchor || result;
}

async function cancelPrescription(recordId) {
  if (!isRemoteMode()) {
    return mockCancelPrescription(recordId);
  }

  const result = await remoteRequest("/anchors/cancel", {
    recordId
  });

  return result.anchor || result;
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
