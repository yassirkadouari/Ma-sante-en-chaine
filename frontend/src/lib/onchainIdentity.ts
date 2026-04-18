import { listAnchorsFromChain } from "./chainContract";
import { downloadJsonFromIpfs } from "./ipfsClient";
import { decryptMedicalPayload, type EncryptedPayload } from "./medicalCrypto";
import { listGovernanceAssignmentsForWallet, type GovernanceAssignmentDoc } from "./governanceStore";

export type WalletIdentity = {
  fullName?: string | null;
  cabinetName?: string | null;
  institutionName?: string | null;
  departmentName?: string | null;
};

export type RoleResolution = {
  role: string;
  anchorsCount: number;
  region?: string | null;
  isGlobalAdmin?: boolean;
  source: string;
};

type GovernanceDoc = GovernanceAssignmentDoc;

const ROLE_CACHE_TTL_MS = 60_000;
const roleCache = new Map<string, { value: RoleResolution; expiresAt: number }>();
const identityCache = new Map<string, { value: WalletIdentity; expiresAt: number }>();

function normalizeWallet(value: string | null | undefined) {
  return String(value || "").trim();
}

function normalizeRole(value: string | null | undefined) {
  const v = String(value || "").trim().toUpperCase();
  if (v === "DOCTOR" || v === "MEDECIN" || v === "MEDECIN_TRAITANT") return "MEDECIN";
  if (v === "PATIENT") return "PATIENT";
  if (v === "PHARMACY" || v === "PHARMACIE" || v === "PHARMACIEN") return "PHARMACIE";
  if (v === "HOSPITAL" || v === "HOPITAL" || v === "HOSPITALIER") return "HOPITAL";
  if (v === "INSURANCE" || v === "ASSURANCE" || v === "ASSUREUR") return "ASSURANCE";
  if (v === "LAB" || v === "LABO" || v === "LABORATOIRE") return "LABO";
  if (v === "ADMIN" || v === "SUPER_ADMIN") return "ADMIN";
  if (v === "SUB_ADMIN") return "SUB_ADMIN";
  return "";
}

function isEncryptedPayload(payload: unknown): payload is EncryptedPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const input = payload as Record<string, unknown>;
  return (
    input.version === "msce-hybrid-aesgcm-v2" &&
    input.algorithm === "AES-GCM" &&
    typeof input.ivB64 === "string" &&
    typeof input.ciphertextB64 === "string" &&
    Array.isArray(input.encryptedKeys)
  );
}

async function readGovernanceDocument(cid: string): Promise<GovernanceDoc | null> {
  try {
    const payload = await downloadJsonFromIpfs<unknown>(cid);
    if (isEncryptedPayload(payload)) {
      try {
        const decrypted = await decryptMedicalPayload<Record<string, unknown>>(payload);
        return decrypted as GovernanceDoc;
      } catch {
        return null;
      }
    }

    if (!payload || typeof payload !== "object") {
      return null;
    }

    return payload as GovernanceDoc;
  } catch {
    return null;
  }
}

function mergeIdentity(base: WalletIdentity, patch: WalletIdentity): WalletIdentity {
  return {
    fullName: base.fullName || patch.fullName || null,
    cabinetName: base.cabinetName || patch.cabinetName || null,
    institutionName: base.institutionName || patch.institutionName || null,
    departmentName: base.departmentName || patch.departmentName || null,
  };
}

function governanceTimestamp(value: string | null | undefined): number {
  const parsed = Date.parse(String(value || ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function latestGovernanceDoc(docs: GovernanceDoc[]): GovernanceDoc | null {
  let best: GovernanceDoc | null = null;
  let bestTs = 0;

  for (const doc of docs) {
    const ts = governanceTimestamp(doc.assignedAt);
    if (!best || ts >= bestTs) {
      best = doc;
      bestTs = ts;
    }
  }

  return best;
}

function forcedAdminWallets(): string[] {
  return String(process.env.NEXT_PUBLIC_ADMIN_WALLETS || "")
    .split(",")
    .map((item) => normalizeWallet(item))
    .filter(Boolean);
}

export function invalidateWalletRoleCache(walletAddress?: string) {
  if (!walletAddress) {
    roleCache.clear();
    return;
  }

  roleCache.delete(normalizeWallet(walletAddress));
}

export function invalidateWalletIdentityCache(walletAddress?: string) {
  if (!walletAddress) {
    identityCache.clear();
    return;
  }

  identityCache.delete(normalizeWallet(walletAddress));
}

export async function resolveWalletRoleOnChain(walletAddress: string): Promise<RoleResolution> {
  const wallet = normalizeWallet(walletAddress);
  const cached = roleCache.get(wallet);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  if (!wallet) {
    const unassigned: RoleResolution = {
      role: "",
      anchorsCount: 0,
      region: null,
      isGlobalAdmin: false,
      source: "empty-wallet",
    };
    roleCache.set(wallet, { value: unassigned, expiresAt: now + ROLE_CACHE_TTL_MS });
    return unassigned;
  }

  if (forcedAdminWallets().includes(wallet)) {
    const forced: RoleResolution = {
      role: "ADMIN",
      anchorsCount: 0,
      region: null,
      isGlobalAdmin: true,
      source: "forced-admin-env",
    };
    roleCache.set(wallet, { value: forced, expiresAt: now + ROLE_CACHE_TTL_MS });
    return forced;
  }

  const governanceLogDocs = listGovernanceAssignmentsForWallet(wallet);
  const latestGovernanceLogDoc = latestGovernanceDoc(governanceLogDocs);
  if (latestGovernanceLogDoc) {
    const normalized = normalizeRole(latestGovernanceLogDoc.role);
    if (normalized && !latestGovernanceLogDoc.revoked) {
      const resolvedFromIpfsLog: RoleResolution = {
        role: normalized,
        anchorsCount: 0,
        region: String(latestGovernanceLogDoc.region || "").trim() || null,
        isGlobalAdmin: Boolean(latestGovernanceLogDoc.isGlobalAdmin),
        source: "governance-ipfs-log",
      };
      roleCache.set(wallet, { value: resolvedFromIpfsLog, expiresAt: now + ROLE_CACHE_TTL_MS });
      return resolvedFromIpfsLog;
    }

    const revokedOrInvalidFromIpfsLog: RoleResolution = {
      role: "",
      anchorsCount: 0,
      region: null,
      isGlobalAdmin: false,
      source: latestGovernanceLogDoc.revoked ? "governance-ipfs-revoked" : "governance-ipfs-invalid-role",
    };
    roleCache.set(wallet, { value: revokedOrInvalidFromIpfsLog, expiresAt: now + ROLE_CACHE_TTL_MS });
    return revokedOrInvalidFromIpfsLog;
  }

  const anchors = await listAnchorsFromChain();
  let bestDoc: GovernanceDoc | null = null;
  let bestDocTs = 0;

  for (const anchor of anchors) {
    if (!anchor) continue;
    if (String(anchor.kind || "") !== "OTHER") continue;
    const cid = String(anchor.cid || "").trim();
    if (!cid || cid.startsWith("pending:")) continue;

    const doc = await readGovernanceDocument(cid);
    if (!doc) continue;

    const docWallet = normalizeWallet(doc.walletAddress);
    if (!docWallet || docWallet !== wallet) continue;

    const ts = governanceTimestamp(doc.assignedAt);
    if (!bestDoc || ts >= bestDocTs) {
      bestDoc = doc;
      bestDocTs = ts;
    }
  }

  if (bestDoc) {
    const normalized = normalizeRole(bestDoc.role);
    if (normalized && !bestDoc.revoked) {
      const resolved: RoleResolution = {
        role: normalized,
        anchorsCount: anchors.length,
        region: String(bestDoc.region || "").trim() || null,
        isGlobalAdmin: Boolean(bestDoc.isGlobalAdmin),
        source: "governance-chain-doc",
      };
      roleCache.set(wallet, { value: resolved, expiresAt: now + ROLE_CACHE_TTL_MS });
      return resolved;
    }

    const revokedOrInvalid: RoleResolution = {
      role: "",
      anchorsCount: anchors.length,
      region: null,
      isGlobalAdmin: false,
      source: bestDoc.revoked ? "governance-revoked" : "governance-invalid-role",
    };
    roleCache.set(wallet, { value: revokedOrInvalid, expiresAt: now + ROLE_CACHE_TTL_MS });
    return revokedOrInvalid;
  }

  const unresolved: RoleResolution = {
    role: "",
    anchorsCount: anchors.length,
    region: null,
    isGlobalAdmin: false,
    source: "role-not-found",
  };

  roleCache.set(wallet, { value: unresolved, expiresAt: now + ROLE_CACHE_TTL_MS });
  return unresolved;
}

export async function resolveWalletIdentityOnChain(walletAddress: string): Promise<WalletIdentity> {
  const wallet = normalizeWallet(walletAddress);
  const now = Date.now();
  const cached = identityCache.get(wallet);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const anchors = await listAnchorsFromChain();
  let resolved: WalletIdentity = {
    fullName: null,
    cabinetName: null,
    institutionName: null,
    departmentName: null,
  };

  for (const doc of listGovernanceAssignmentsForWallet(wallet)) {
    const fullName = String(doc.fullName || `${doc.firstName || ""} ${doc.lastName || ""}`).trim() || null;
    resolved = mergeIdentity(resolved, {
      fullName,
      cabinetName: String(doc.cabinetName || "").trim() || null,
      institutionName: String(doc.institutionName || "").trim() || null,
      departmentName: String(doc.departmentName || "").trim() || null,
    });
  }

  for (const anchor of anchors) {
    if (!anchor) continue;
    if (String(anchor.kind || "") !== "OTHER") continue;
    const cid = String(anchor.cid || "").trim();
    if (!cid || cid.startsWith("pending:")) continue;

    const doc = await readGovernanceDocument(cid);
    if (!doc) continue;

    const docWallet = normalizeWallet(doc.walletAddress);
    if (!docWallet || docWallet !== wallet) continue;

    const fullName = String(doc.fullName || `${doc.firstName || ""} ${doc.lastName || ""}`).trim() || null;
    resolved = mergeIdentity(resolved, {
      fullName,
      cabinetName: String(doc.cabinetName || "").trim() || null,
      institutionName: String(doc.institutionName || "").trim() || null,
      departmentName: String(doc.departmentName || "").trim() || null,
    });
  }

  identityCache.set(wallet, { value: resolved, expiresAt: now + ROLE_CACHE_TTL_MS });
  return resolved;
}
