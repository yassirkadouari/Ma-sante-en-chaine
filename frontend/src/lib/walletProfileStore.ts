import { uploadJsonToIpfs } from "./ipfsClient";

export type WalletProfile = {
  walletAddress: string;
  firstName: string;
  lastName: string;
  age: number;
  profileCid?: string | null;
  updatedAt: string;
};

const PROFILE_STORAGE_KEY = "msce.wallet.profile.v1";

function normalizeWallet(value: string | null | undefined) {
  return String(value || "").trim();
}

function storageAvailable() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readProfileMap(): Record<string, WalletProfile> {
  if (!storageAvailable()) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, WalletProfile>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeProfileMap(value: Record<string, WalletProfile>) {
  if (!storageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore localStorage write issues (private mode / quota).
  }
}

export function readWalletProfile(walletAddress: string): WalletProfile | null {
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) return null;

  const record = readProfileMap()[wallet];
  if (!record) return null;

  const age = Math.floor(Number(record.age || 0));
  if (!Number.isFinite(age) || age <= 0 || age > 120) {
    return null;
  }

  return {
    walletAddress: wallet,
    firstName: String(record.firstName || "").trim(),
    lastName: String(record.lastName || "").trim(),
    age,
    profileCid: String(record.profileCid || "").trim() || null,
    updatedAt: String(record.updatedAt || "").trim() || new Date().toISOString(),
  };
}

export async function saveWalletProfile(input: {
  walletAddress: string;
  firstName: string;
  lastName: string;
  age: number;
}): Promise<WalletProfile> {
  const wallet = normalizeWallet(input.walletAddress);
  const firstName = String(input.firstName || "").trim();
  const lastName = String(input.lastName || "").trim();
  const age = Math.floor(Number(input.age || 0));

  if (!wallet) {
    throw new Error("walletAddress manquant pour le profil wallet.");
  }

  if (!firstName || !lastName) {
    throw new Error("Nom et prénom sont obligatoires.");
  }

  if (!Number.isFinite(age) || age <= 0 || age > 120) {
    throw new Error("Age invalide (1-120).");
  }

  const updatedAt = new Date().toISOString();
  const profilePayload = {
    schema: "msce-wallet-profile-v1",
    walletAddress: wallet,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    age,
    updatedAt,
  };

  let profileCid: string | null = null;
  try {
    const uploaded = await uploadJsonToIpfs(profilePayload, `wallet-profile-${wallet}-${Date.now()}.json`);
    profileCid = String(uploaded.cid || "").trim() || null;
  } catch {
    // Keep local profile persistence even if IPFS upload is temporarily unavailable.
  }

  const nextProfile: WalletProfile = {
    walletAddress: wallet,
    firstName,
    lastName,
    age,
    profileCid,
    updatedAt,
  };

  const current = readProfileMap();
  current[wallet] = nextProfile;
  writeProfileMap(current);

  return nextProfile;
}
