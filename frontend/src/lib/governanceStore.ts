export type GovernanceAssignmentDoc = {
  walletAddress?: string;
  role?: string;
  region?: string | null;
  revoked?: boolean;
  isGlobalAdmin?: boolean;
  institutionName?: string | null;
  departmentName?: string | null;
  approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
  assignedByWallet?: string;
  assignedAt?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  cabinetName?: string;
};

export type GovernanceLogEntry = GovernanceAssignmentDoc & {
  cid: string;
  storedAt: string;
};

const GOVERNANCE_STORAGE_KEY = "msce.governance.ipfs.log.v1";
const MAX_GOVERNANCE_ENTRIES = 2000;

function normalizeWallet(value: string | null | undefined) {
  return String(value || "").trim();
}

function storageAvailable() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readRawEntries(): GovernanceLogEntry[] {
  if (!storageAvailable()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(GOVERNANCE_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => item as GovernanceLogEntry)
      .filter((item) => typeof item?.cid === "string" && Boolean(item.cid.trim()));
  } catch {
    return [];
  }
}

function writeRawEntries(entries: GovernanceLogEntry[]) {
  if (!storageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(GOVERNANCE_STORAGE_KEY, JSON.stringify(entries.slice(-MAX_GOVERNANCE_ENTRIES)));
  } catch {
    // Ignore write failures (private mode / quota) to keep UI non-blocking.
  }
}

function sortByAssignedAtDesc(entries: GovernanceLogEntry[]) {
  return [...entries].sort((a, b) => {
    const aTs = Date.parse(String(a.assignedAt || a.storedAt || ""));
    const bTs = Date.parse(String(b.assignedAt || b.storedAt || ""));
    const aSafe = Number.isNaN(aTs) ? 0 : aTs;
    const bSafe = Number.isNaN(bTs) ? 0 : bTs;
    return bSafe - aSafe;
  });
}

export function recordGovernanceAssignment(document: GovernanceAssignmentDoc, cid: string) {
  const normalizedCid = String(cid || "").trim();
  if (!normalizedCid) {
    return;
  }

  const nowIso = new Date().toISOString();
  const nextEntry: GovernanceLogEntry = {
    ...document,
    walletAddress: normalizeWallet(document.walletAddress),
    role: String(document.role || "").trim(),
    region: document.region ?? null,
    institutionName: document.institutionName ?? null,
    departmentName: document.departmentName ?? null,
    cid: normalizedCid,
    storedAt: nowIso,
    assignedAt: document.assignedAt || nowIso,
  };

  const existing = readRawEntries().filter((entry) => entry.cid !== normalizedCid);
  existing.push(nextEntry);
  writeRawEntries(existing);
}

export function listGovernanceAssignments(): GovernanceLogEntry[] {
  return sortByAssignedAtDesc(readRawEntries());
}

export function listGovernanceAssignmentsForWallet(walletAddress: string): GovernanceLogEntry[] {
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) return [];

  return listGovernanceAssignments().filter((entry) => normalizeWallet(entry.walletAddress) === wallet);
}

export function listGovernanceWallets(): string[] {
  const wallets = new Set<string>();
  for (const entry of listGovernanceAssignments()) {
    const wallet = normalizeWallet(entry.walletAddress);
    if (wallet) {
      wallets.add(wallet);
    }
  }
  return Array.from(wallets);
}
