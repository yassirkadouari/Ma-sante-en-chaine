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
  } | null;
};

const KEY = "msc_session";

export function saveSession(session: Session) {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function loadSession(): Session | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as Session;
  } catch {
    localStorage.removeItem(KEY);
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(KEY);
}
