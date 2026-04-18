export type Session = {
  token: string;
  walletAddress: string;
  role: string;
  identity?: {
    role: string;
    fullName: string;
    nickname: string;
    dateOfBirth: string;
    region?: string | null;
    isGlobalAdmin?: boolean;
    cabinetName?: string | null;
    institutionName?: string | null;
    departmentName?: string | null;
    approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
    approvedByWallet?: string | null;
    approvedAt?: string | null;
    primaryDoctorWallet?: string | null;
  } | null;
};

const KEY = "msc_session_v2";
let inMemorySession: Session | null = null;

function normalizeSession(input: Session | null): Session | null {
  if (!input) return null;
  return {
    ...input,
    token: input.token || "wallet-signed-session",
  };
}

export function saveSession(session: Session) {
  const normalized = normalizeSession(session);
  inMemorySession = normalized;

  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota/privacy mode failures and keep in-memory fallback.
  }
}

export function loadSession(): Session | null {
  if (inMemorySession) {
    return inMemorySession;
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Session;
    const normalized = normalizeSession(parsed);
    inMemorySession = normalized;
    return normalized;
  } catch {
    localStorage.removeItem(KEY);
    return null;
  }
}

export function clearSession() {
  inMemorySession = null;

  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ignore storage failures.
  }
}
