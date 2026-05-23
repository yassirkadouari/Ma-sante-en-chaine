import { connectWallet, signMessage } from "./wallet";
import { loadSession, saveSession, type Session } from "./session";
import { downloadJsonFromIpfs, getGatewayUrl, uploadJsonToIpfs } from "./ipfsClient";
import {
  decryptMedicalPayload,
  encryptMedicalPayloadOrPlain,
  sha256HexFromObject,
  type EncryptedPayload,
} from "./medicalCrypto";
import {
  canReadOnChain,
  cancelRecordOnChain,
  getAnchorFromChain,
  listAnchorsFromChain,
  listClaimsFromChain,
  markClaimReimbursedOnChain,
  markDeliveredOnChain,
  reviewClaimOnChain,
  storeAnchorOnChain,
  submitClaimOnChain,
  verifyHashOnChain,
} from "./chainContract";
import {
  invalidateWalletIdentityCache,
  invalidateWalletRoleCache,
  resolveWalletIdentityOnChain,
  resolveWalletRoleOnChain,
} from "./onchainIdentity";
import {
  listGovernanceAssignments,
  listGovernanceWallets,
  recordGovernanceAssignment,
} from "./governanceStore";

type SignedRequestOptions = {
  method?: string;
  path: string;
  body?: unknown;
  signed?: boolean;
  auth?: boolean;
};

type AnchorItem = {
  recordId: string;
  kind: "PRESCRIPTION" | "VISIT" | "LAB_RESULT" | "OPERATION" | "OTHER";
  hash: string;
  cid: string;
  ownerWallet: string;
  doctorWallet: string;
  pharmacyWallet?: string | null;
  insurerWallet?: string | null;
  status: "PRESCRIBED" | "DELIVERED" | "CANCELLED";
  createdAt?: string;
  updatedAt?: string;
};

type ClaimItem = {
  claimId: string;
  sourceRecordId: string;
  claimantWallet: string;
  insurerWallet: string;
  amountRequested: number;
  amountApproved?: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "REIMBURSED";
  reasonHash?: string;
  paymentRefHash?: string;
  createdAt: string;
  updatedAt: string;
};

type PrescriptionData = {
  ordonnanceText?: string;
  medications?: string;
  instructions?: string;
};

type PatientProfile = {
  primaryDoctorWallet?: string | null;
  bloodType?: string | null;
  age?: number | null;
  diseases?: string[];
  region?: string | null;
};

type AdminListItem = {
  walletAddress: string;
  roles: string[];
  identity: {
    role: string;
    fullName: string;
    nickname: string;
    dateOfBirth: string;
    region: string | null;
    isGlobalAdmin: boolean;
    institutionName?: string | null;
    departmentName?: string | null;
    approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
  };
};

const PATIENT_PROFILE_STORAGE_KEY = "msce.patient.medical.profile.v1";

function loadPatientProfileMap(): Record<string, PatientProfile> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PATIENT_PROFILE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function loadPatientProfile(walletAddress: string): PatientProfile {
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) return {};
  return loadPatientProfileMap()[wallet] || {};
}

function savePatientProfile(walletAddress: string, profile: PatientProfile) {
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) return;
  if (typeof window === "undefined") return;
  try {
    const map = loadPatientProfileMap();
    map[wallet] = profile;
    localStorage.setItem(PATIENT_PROFILE_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore localStorage write failures.
  }
}

function createNonce() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `nonce-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeWallet(value: string | null | undefined) {
  return String(value || "").trim();
}

function requireSession() {
  const session = loadSession();
  if (!session?.token) {
    const error = new Error("Session absente ou expiree. Merci de vous reconnecter.");
    if (typeof window !== "undefined") {
      const currentPath = `${window.location.pathname}${window.location.search}`;
      const loginUrl = `/login?next=${encodeURIComponent(currentPath)}`;
      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign(loginUrl);
      }
    }
    throw error;
  }

  return session;
}

function requireRole(session: Session, roles: string[]) {
  if (!roles.includes(session.role)) {
    throw new Error(`Role ${session.role} non autorise pour cette action.`);
  }
}

function normalizeRole(value: string) {
  const v = value.trim().toUpperCase();
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

function getSessionRegion(session: Session): string | null {
  const value = String(session.identity?.region || "").trim();
  return value || null;
}

function canAssignRole(session: Session, targetRole: string): boolean {
  if (session.identity?.isGlobalAdmin) return true;
  return targetRole !== "ADMIN" && targetRole !== "SUB_ADMIN";
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const keys = Object.keys(input)
      .filter((key) => input[key] !== undefined)
      .sort();

    const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(input[key])}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function toHex32(value: string): string {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    throw new Error("Hash vide");
  }
  if (text.startsWith("0x") && text.length === 66) return text;
  if (/^[0-9a-f]{64}$/.test(text)) return `0x${text}`;
  throw new Error("Hash invalide: attendu 32 bytes hex");
}

async function bodyDigest(body: unknown) {
  const canonical = canonicalize(body || {});
  const hash = await sha256HexFromObject(canonical);
  return toHex32(hash);
}

function signedMessage(method: string, path: string, timestamp: string, nonce: string, bodyHash: string) {
  return [
    "MaSanteEnChaine Signed Request",
    `method:${method.toUpperCase()}`,
    `path:${path}`,
    `timestamp:${timestamp}`,
    `nonce:${nonce}`,
    `bodyHash:${bodyHash}`,
  ].join("\n");
}

async function enforceSignedRequest(method: string, path: string, body: unknown, session: Session | null) {
  const { walletAddress } = await connectWallet();
  if (session && walletAddress !== session.walletAddress) {
    throw new Error("Le wallet connecte ne correspond pas a la session active.");
  }

  const timestamp = String(Date.now());
  const nonce = createNonce();
  const hash = await bodyDigest(body || {});
  const message = signedMessage(method, path, timestamp, nonce, hash);
  await signMessage(walletAddress, message);

  return walletAddress;
}

function parsePath(path: string) {
  const [pathname, queryString] = path.split("?");
  return {
    pathname,
    query: new URLSearchParams(queryString || ""),
  };
}

function toIsoTimestamp(value: number | undefined): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return new Date().toISOString();
  const ms = num > 1_000_000_000_000 ? num : num * 1000;
  return new Date(ms).toISOString();
}

function mapAnchor(raw: any): AnchorItem {
  return {
    recordId: String(raw.recordId || ""),
    kind: (String(raw.kind || "OTHER").toUpperCase() as AnchorItem["kind"]) || "OTHER",
    hash: String(raw.hash || ""),
    cid: String(raw.cid || ""),
    ownerWallet: String(raw.ownerWallet || ""),
    doctorWallet: String(raw.doctorWallet || ""),
    pharmacyWallet: raw.pharmacyWallet ? String(raw.pharmacyWallet) : null,
    insurerWallet: raw.insurerWallet ? String(raw.insurerWallet) : null,
    status: (String(raw.status || "PRESCRIBED").toUpperCase() as AnchorItem["status"]) || "PRESCRIBED",
    createdAt: toIsoTimestamp(Number(raw.createdAt || 0)),
    updatedAt: toIsoTimestamp(Number(raw.updatedAt || 0)),
  };
}

async function listAnchors() {
  const anchors = await listAnchorsFromChain();
  return (anchors || []).map((item) => mapAnchor(item));
}

async function listPharmacyWallets() {
  const wallets = new Set<string>();

  for (const assignment of listGovernanceAssignments()) {
    if (assignment.revoked) {
      continue;
    }

    if (normalizeRole(String(assignment.role || "")) !== "PHARMACIE") {
      continue;
    }

    const walletAddress = normalizeWallet(assignment.walletAddress);
    if (walletAddress) {
      wallets.add(walletAddress);
    }
  }

  if (wallets.size > 0) {
    return Array.from(wallets);
  }

  // Fallback for legacy datasets where governance assignments are not yet mirrored in local log.
  const anchors = await listAnchors();
  for (const anchor of anchors) {
    const pharmacy = normalizeWallet(anchor.pharmacyWallet || "");
    if (pharmacy) {
      wallets.add(pharmacy);
    }
  }

  return Array.from(wallets);
}

function normalizeAnchorLookupInput(value: string) {
  let candidate = String(value || "").trim();
  if (!candidate) {
    return "";
  }

  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // Keep raw value when decodeURIComponent fails.
  }

  candidate = candidate.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

  if (/^https?:\/\//i.test(candidate)) {
    try {
      const parsedUrl = new URL(candidate);
      for (const key of ["recordId", "prescriptionId", "anchorId", "id"]) {
        const queryValue = String(parsedUrl.searchParams.get(key) || "").trim();
        if (queryValue) {
          candidate = queryValue;
          break;
        }
      }

      const segments = parsedUrl.pathname
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean);
      const markerIndex = segments.findIndex((segment) =>
        ["prescriptions", "prescription", "ordonnances", "ordonnance"].includes(segment.toLowerCase())
      );
      if (markerIndex >= 0 && segments[markerIndex + 1]) {
        candidate = decodeURIComponent(segments[markerIndex + 1]);
      }
    } catch {
      // Ignore malformed URL payloads.
    }
  }

  const lowered = candidate.toLowerCase();
  for (const marker of [
    "msc:prescription:",
    "msc://prescription/",
    "msce:prescription:",
    "msce://prescription/",
    "prescription://",
    "prescription:",
  ]) {
    const markerIndex = lowered.indexOf(marker);
    if (markerIndex >= 0) {
      candidate = candidate.slice(markerIndex + marker.length).trim();
      break;
    }
  }

  candidate = candidate.replace(/^['"]+|['"]+$/g, "").trim();

  const explicitHex = candidate.match(/0x[0-9a-fA-F]{64}/);
  if (explicitHex?.[0]) {
    return explicitHex[0].toLowerCase();
  }

  const explicitRecordId = candidate.match(/(presc:[A-Za-z0-9-]+)/i);
  if (explicitRecordId?.[1]) {
    return explicitRecordId[1].trim();
  }

  return candidate;
}

async function getAnchor(recordIdOrKey: string) {
  const lookupValue = normalizeAnchorLookupInput(recordIdOrKey);
  if (!lookupValue) {
    throw new Error("Record ID invalide ou vide.");
  }

  let anchor = await getAnchorFromChain(lookupValue);

  if (!anchor) {
    const allAnchors = await listAnchorsFromChain().catch(() => [] as any[]);
    const prefix = lookupValue.toLowerCase();
    const prefixMatches = allAnchors.filter((item) =>
      String((item as any)?.recordId || "").toLowerCase().startsWith(prefix)
    );

    if (prefixMatches.length === 1) {
      anchor = prefixMatches[0];
    } else if (prefixMatches.length > 1) {
      throw new Error("Record ID ambigu: plusieurs ordonnances correspondent a ce prefixe.");
    } else if (allAnchors.length === 0) {
      throw new Error(
        "Aucune ancre trouvee sur le contrat actif. Ce QR peut pointer vers un ancien contrat; regenez une ordonnance."
      );
    }
  }

  if (!anchor) {
    throw new Error("anchor not found");
  }

  return mapAnchor(anchor);
}

function isPrescriptionAnchor(anchor: AnchorItem) {
  return anchor.kind === "PRESCRIPTION";
}

function isEventAnchor(anchor: AnchorItem) {
  return anchor.kind === "VISIT" || anchor.kind === "LAB_RESULT" || anchor.kind === "OPERATION";
}

async function canAccessAnchor(anchor: AnchorItem, session: Session) {
  if (session.role === "ADMIN" || session.role === "SUB_ADMIN") return true;
  if (session.role === "PHARMACIE" && isPrescriptionAnchor(anchor)) return true;

  try {
    const blockchainAllowed = await canReadOnChain(anchor.recordId, session.walletAddress);
    if (blockchainAllowed) return true;
  } catch (err) {
    // Fallback to local check
  }

  const owner = normalizeWallet(anchor.ownerWallet).toLowerCase();
  const doctor = normalizeWallet(anchor.doctorWallet).toLowerCase();
  const pharmacy = normalizeWallet(anchor.pharmacyWallet || "").toLowerCase();
  const insurer = normalizeWallet(anchor.insurerWallet || "").toLowerCase();
  const current = normalizeWallet(session.walletAddress).toLowerCase();

  return owner === current || doctor === current || pharmacy === current || insurer === current;
}

function mapPrescriptionSummary(anchor: AnchorItem) {
  return {
    recordId: anchor.recordId,
    status: anchor.status,
    patientWallet: anchor.ownerWallet,
    doctorWallet: anchor.doctorWallet,
    pharmacyWallet: anchor.pharmacyWallet || null,
    ipfsCid: anchor.cid || null,
    blockchainHash: anchor.hash,
    version: 1,
    hasTextContent: !!anchor.cid,
    totalAmount: 0,
  };
}

function asNonEmptyText(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function extractPrescriptionData(payload: unknown): PrescriptionData {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const input = payload as Record<string, unknown>;
  return {
    ordonnanceText: asNonEmptyText(input.ordonnanceText ?? input.text ?? input.summary ?? input.details),
    medications: asNonEmptyText(input.medications ?? input.medicaments),
    instructions: asNonEmptyText(input.instructions ?? input.posology ?? input.posologie),
  };
}

function isHybridEncryptedPayload(payload: unknown): payload is EncryptedPayload {
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

function safeDateIso(value: unknown, fallback: string) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  const ts = Date.parse(text);
  if (Number.isNaN(ts)) return fallback;
  return new Date(ts).toISOString();
}

function positiveAmount(value: unknown) {
  const normalizedValue =
    typeof value === "string"
      ? value.replace(/\s+/g, "").replace(",", ".")
      : value;

  const amount = Number(normalizedValue);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function isRateLimitError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("429") ||
    message.includes("403") ||
    message.includes("forbidden") ||
    message.includes("blocked") ||
    message.includes("plan usage limit")
  );
}

function isContractUnavailableError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("contracts.contractnotfound") ||
    message.includes("no contract was found at the specified address")
  );
}

function pendingRecordId(kind: "presc" | "event") {
  return `pending:${kind}:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
}

async function uploadMedicalPayloadWithFallback(
  payload: Record<string, unknown>,
  recipientWallets: string[],
  fileName: string
) {
  const packaged = await encryptMedicalPayloadOrPlain(payload, { recipientWallets });
  const hash = await bodyDigest(packaged.payload);

  if (!packaged.encrypted && packaged.missingRecipientWallets.length > 0) {
    console.warn(
      `[MSC] Missing recipient encryption key(s): ${packaged.missingRecipientWallets.join(", ")}. Storing plain JSON on IPFS for this record.`
    );
  }

  try {
    const uploaded = await uploadJsonToIpfs(packaged.payload, fileName);
    return { uploaded, hash };
  } catch (error) {
    if (!isRateLimitError(error)) {
      throw error;
    }

    const pendingCid = `pending:${hash.slice(2, 18)}:${Date.now()}`;
    console.warn(
      `[MSC] IPFS upload rate-limited; anchoring with pending CID ${pendingCid} to avoid blocking medical flow.`
    );
    
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(pendingCid, JSON.stringify(packaged.payload));
      } catch (e) {
        console.error("Impossible de sauvegarder le payload en attente dans le localStorage", e);
      }
    }

    return {
      uploaded: {
        cid: pendingCid,
        size: 0,
      },
      hash,
    };
  }
}

function normalizeMedicalEventType(value: unknown): string {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "MEDICAL_ACT";

  if (["VISIT", "CONSULTATION", "CONSULT", "RENDEZ_VOUS"].includes(raw)) return "VISIT";
  if (["LAB_RESULT", "LAB", "ANALYSE", "ANALYSIS"].includes(raw)) return "LAB_RESULT";
  return raw;
}

function deriveMedicalEventDomain(type: string): "VISIT" | "LAB_RESULT" | "MEDICAL_ACT" {
  if (type === "VISIT") return "VISIT";
  if (type === "LAB_RESULT") return "LAB_RESULT";
  return "MEDICAL_ACT";
}

function deliveryReceiptRecordId(recordId: string) {
  return `receipt:${recordId}`;
}

async function readDeliveredPrescriptionAmount(recordId: string) {
  try {
    const receiptAnchor = await getAnchor(deliveryReceiptRecordId(recordId));
    const cid = String(receiptAnchor.cid || "").trim();
    if (!cid) {
      return 0;
    }

    const payload = await downloadJsonFromIpfs<unknown>(cid);
    let parsedPayload: Record<string, unknown> | null = null;

    if (isHybridEncryptedPayload(payload)) {
      parsedPayload = await decryptMedicalPayload<Record<string, unknown>>(payload);
    } else if (payload && typeof payload === "object") {
      parsedPayload = payload as Record<string, unknown>;
    }

    if (!parsedPayload) return 0;
    return positiveAmount(parsedPayload.totalAmount ?? parsedPayload.amount ?? parsedPayload.amountRequested);
  } catch {
    return 0;
  }
}

async function parseAnchorPayload(anchor: AnchorItem): Promise<{
  payload: Record<string, unknown> | null;
  blockchainVerified: boolean;
}> {
  const cid = String(anchor.cid || "").trim();
  if (!cid) {
    return { payload: null, blockchainVerified: false };
  }

  try {
    const raw = await downloadJsonFromIpfs<unknown>(cid);
    const envelopeHash = await bodyDigest(raw);
    const blockchainVerified = await verifyHashOnChain(anchor.recordId, envelopeHash).catch(() => false);

    if (isHybridEncryptedPayload(raw)) {
      try {
        const decrypted = await decryptMedicalPayload<Record<string, unknown>>(raw);
        return { payload: decrypted, blockchainVerified: blockchainVerified || envelopeHash === anchor.hash };
      } catch {
        return { payload: null, blockchainVerified: blockchainVerified || envelopeHash === anchor.hash };
      }
    }

    if (raw && typeof raw === "object") {
      return { payload: raw as Record<string, unknown>, blockchainVerified: blockchainVerified || envelopeHash === anchor.hash };
    }

    return { payload: null, blockchainVerified: blockchainVerified || envelopeHash === anchor.hash };
  } catch {
    return { payload: null, blockchainVerified: false };
  }
}

async function buildClaims(session: Session, statusFilter: string) {
  const rawClaims = await listClaimsFromChain();
  const rows: ClaimItem[] = [];

  for (const claim of rawClaims || []) {
    if (!claim) continue;

    const mapped: ClaimItem = {
      claimId: String(claim.claimId || ""),
      sourceRecordId: String(claim.sourceRecordId || ""),
      claimantWallet: String(claim.claimantWallet || ""),
      insurerWallet: String(claim.insurerWallet || ""),
      amountRequested: Number(claim.amountRequested || 0),
      amountApproved: claim.amountApproved !== undefined ? Number(claim.amountApproved) : undefined,
      status: (String(claim.status || "PENDING") as ClaimItem["status"]),
      reasonHash: claim.reasonHash ? String(claim.reasonHash) : undefined,
      paymentRefHash: claim.paymentRefHash ? String(claim.paymentRefHash) : undefined,
      createdAt: toIsoTimestamp(Number(claim.createdAt || 0)),
      updatedAt: toIsoTimestamp(Number(claim.updatedAt || 0)),
    };

    if (session.role === "PATIENT" && normalizeWallet(mapped.claimantWallet).toLowerCase() !== normalizeWallet(session.walletAddress).toLowerCase()) {
      continue;
    }

    if (session.role === "ASSURANCE" && normalizeWallet(mapped.insurerWallet).toLowerCase() !== normalizeWallet(session.walletAddress).toLowerCase()) {
      continue;
    }

    rows.push(mapped);
  }

  const withSource = await Promise.all(
    rows.map(async (claim) => {
      const sourceAnchor = await getAnchor(claim.sourceRecordId).catch(() => null);
      const sourceType = sourceAnchor?.kind === "PRESCRIPTION"
        ? "PRESCRIPTION"
        : sourceAnchor?.kind === "VISIT"
          ? "VISIT"
          : sourceAnchor?.kind === "LAB_RESULT"
            ? "LAB_TEST"
            : "OPERATION";

      const providerRole = sourceAnchor?.kind === "LAB_RESULT"
        ? "LABO"
        : sourceAnchor?.kind === "VISIT"
          ? "MEDECIN"
          : sourceAnchor?.kind === "OPERATION"
            ? "HOPITAL"
            : "MEDECIN";

      return {
        claimId: claim.claimId,
        sourceType,
        sourceId: claim.sourceRecordId,
        patientWallet: sourceAnchor?.ownerWallet || claim.claimantWallet,
        providerWallet: sourceAnchor?.doctorWallet,
        providerRole,
        amountRequested: claim.amountRequested,
        amountApproved: claim.amountApproved,
        status: claim.status,
        reason: claim.reasonHash,
        paymentReference: claim.paymentRefHash,
        reimbursedAt: claim.status === "REIMBURSED" ? claim.updatedAt : undefined,
        verification: {
          anchorValid: Boolean(sourceAnchor),
          anchorStatus: sourceAnchor?.status,
          method: "INK_CONTRACT",
        },
        createdAt: claim.createdAt,
      };
    })
  );

  if (!statusFilter || statusFilter === "ALL") {
    return withSource;
  }

  return withSource.filter((item) => item.status === statusFilter);
}

async function storeRoleAssignment(
  session: Session,
  payload: {
    walletAddress: string;
    role: string;
    region: string | null;
    revoked?: boolean;
    institutionName?: string | null;
    departmentName?: string | null;
    approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
    isGlobalAdmin?: boolean;
  }
) {
  const document = {
    walletAddress: payload.walletAddress,
    role: payload.role,
    region: payload.region,
    revoked: Boolean(payload.revoked),
    institutionName: payload.institutionName || null,
    departmentName: payload.departmentName || null,
    approvalStatus: payload.approvalStatus || (payload.role === "MEDECIN" ? "PENDING" : "APPROVED"),
    isGlobalAdmin: Boolean(payload.isGlobalAdmin),
    assignedByWallet: session.walletAddress,
    assignedAt: new Date().toISOString(),
  };

  let uploaded: { cid: string; size: number };
  try {
    uploaded = await uploadJsonToIpfs(document, `wallet-role-${payload.walletAddress}-${Date.now()}.json`);
  } catch (error: any) {
    throw new Error(
      `Echec assignation role: upload IPFS impossible pour ${payload.walletAddress}. ` +
      `Verifiez NEXT_PUBLIC_IPFS_API_URL/NEXT_PUBLIC_IPFS_API_TOKEN et la connectivite navigateur. ` +
      `${String(error?.message || error)}`
    );
  }

  recordGovernanceAssignment(document, uploaded.cid);
  invalidateWalletRoleCache(payload.walletAddress);
  invalidateWalletIdentityCache(payload.walletAddress);
}

export async function apiRequest<T>(options: SignedRequestOptions): Promise<T> {
  const method = (options.method || (options.body ? "POST" : "GET")).toUpperCase();
  const { pathname, query } = parsePath(options.path);
  const session = options.auth === false ? null : requireSession();

  if (options.signed) {
    await enforceSignedRequest(method, pathname, options.body, session);
  }

  if (pathname === "/prescriptions" && method === "GET") {
    const anchors = (await listAnchors()).filter(isPrescriptionAnchor);
    const withAccess = await Promise.all(
      anchors.map(async (anchor) => ({
        anchor,
        allowed: session ? await canAccessAnchor(anchor, session) : false,
      }))
    );

    return { items: withAccess.filter((row) => row.allowed).map((row) => mapPrescriptionSummary(row.anchor)) } as T;
  }

  if (pathname === "/prescriptions" && method === "POST") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["MEDECIN", "HOPITAL"]);

    const body = (options.body || {}) as {
      patientWallet?: string;
      pharmacyWallet?: string;
      insurerWallet?: string;
      ordonnanceText?: string;
      medications?: string;
      instructions?: string;
    };

    const patientWallet = normalizeWallet(body.patientWallet);
    if (!patientWallet) {
      throw new Error("patientWallet est obligatoire");
    }

    const payload = {
      schema: "msce-prescription-v2",
      patientWallet,
      doctorWallet: session.walletAddress,
      ordonnanceText: String(body.ordonnanceText || "").trim(),
      medications: String(body.medications || "").trim() || null,
      instructions: String(body.instructions || "").trim() || null,
      createdAt: new Date().toISOString(),
    };

    if (!payload.ordonnanceText) {
      throw new Error("Le texte de l'ordonnance est obligatoire");
    }

    const pharmacyWallets = Array.from(
      new Set(
        [
          ...(await listPharmacyWallets()),
          normalizeWallet(body.pharmacyWallet),
        ].filter(Boolean)
      )
    );

    const recipients = [
      patientWallet,
      session.walletAddress,
      ...pharmacyWallets,
      normalizeWallet(body.insurerWallet),
    ].filter(Boolean);

    const { uploaded, hash } = await uploadMedicalPayloadWithFallback(
      payload,
      recipients,
      `ordonnance-${Date.now()}.json`
    );

    const recordId = await storeAnchorOnChain({
      recordKey: `presc:${crypto.randomUUID()}`,
      kind: "PRESCRIPTION",
      cid: uploaded.cid,
      hashHex: hash,
      ownerWallet: patientWallet,
      doctorWallet: session.walletAddress,
      // Keep pharmacy unassigned so any approved pharmacy can process pricing/delivery.
      pharmacyWallet: null,
      insurerWallet: normalizeWallet(body.insurerWallet) || null,
    });

    return { recordId, status: "PRESCRIBED" } as T;
  }

  if (pathname.match(/^\/prescriptions\/[^/]+$/) && method === "GET") {
    if (!session) throw new Error("Session requise");
    const recordId = pathname.split("/")[2];
    const anchor = await getAnchor(recordId);

    if (!isPrescriptionAnchor(anchor)) {
      throw new Error("Cet identifiant ne correspond pas a une ordonnance.");
    }

    if (!(await canAccessAnchor(anchor, session))) {
      throw new Error("Acces refuse a cette ordonnance.");
    }

    const cid = String(anchor.cid || "").trim();
    const baseResponse = {
      recordId: anchor.recordId,
      status: anchor.status,
      blockchainHash: anchor.hash,
      ipfsCid: cid || null,
    };

    if (!cid || cid.startsWith("pending:")) {
      return {
        ...baseResponse,
        contentState: "PENDING_IPFS",
        data: {
          ordonnanceText: "Ordonnance ancree sans contenu IPFS lisible.",
        },
      } as T;
    }

    let ipfsPayload: unknown;
    try {
      ipfsPayload = await downloadJsonFromIpfs<unknown>(cid);
    } catch {
      return {
        ...baseResponse,
        contentState: "UNAVAILABLE",
        data: {
          ordonnanceText: "Impossible de lire le document IPFS associe a cette ordonnance.",
        },
      } as T;
    }

    if (isHybridEncryptedPayload(ipfsPayload)) {
      try {
        const decrypted = await decryptMedicalPayload<Record<string, unknown>>(ipfsPayload);
        const parsed = extractPrescriptionData(decrypted);
        return {
          ...baseResponse,
          contentState: "DECRYPTED",
          data: {
            ordonnanceText: parsed.ordonnanceText || "Ordonnance dechiffree mais contenu texte vide.",
            medications: parsed.medications,
            instructions: parsed.instructions,
          },
        } as T;
      } catch {
        return {
          ...baseResponse,
          contentState: "ENCRYPTED_LOCKED",
          data: {
            ordonnanceText: "Document chiffre: wallet non autorise ou clef de decryptage indisponible.",
          },
        } as T;
      }
    }

    const parsed = extractPrescriptionData(ipfsPayload);

    return {
      ...baseResponse,
      contentState: "PLAIN_IPFS",
      data: {
        ordonnanceText: parsed.ordonnanceText || "Ordonnance IPFS trouvee, mais contenu texte vide.",
        medications: parsed.medications,
        instructions: parsed.instructions,
      },
    } as T;
  }

  if (pathname.match(/^\/prescriptions\/[^/]+\/scan$/) && method === "GET") {
    if (!session) throw new Error("Session requise");
    const recordId = pathname.split("/")[2];
    const anchor = await getAnchor(recordId);
    if (!isPrescriptionAnchor(anchor)) {
      throw new Error("Cet identifiant ne correspond pas a une ordonnance.");
    }
    if (!(await canAccessAnchor(anchor, session))) {
      throw new Error("Acces refuse a cette ordonnance.");
    }

    return {
      recordId: anchor.recordId,
      status: anchor.status,
      data: {
        ordonnanceText: `CID: ${anchor.cid}`,
        hash: anchor.hash,
      },
      blockchainHash: anchor.hash,
    } as T;
  }

  if (pathname.match(/^\/prescriptions\/[^/]+\/deliver$/) && method === "POST") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["PHARMACIE"]);
    const recordId = pathname.split("/")[2];
    const current = await getAnchor(recordId);

    if (!isPrescriptionAnchor(current) || !(await canAccessAnchor(current, session))) {
      throw new Error("Acces refuse a cette ordonnance.");
    }

    try {
      await markDeliveredOnChain(recordId);
    } catch (error: any) {
      const message = String(error?.message || error || "");
      if (message.includes("Unauthorized")) {
        throw new Error(
          "Cette pharmacie n'est pas autorisee a delivrer cette ordonnance. " +
          "Demandez au medecin d'accorder l'acces pour votre wallet."
        );
      }
      if (message.includes("InvalidTransition")) {
        throw new Error("Cette ordonnance est deja delivree, annulee, ou non delivrable dans son etat actuel.");
      }
      throw error;
    }

    const updated = await getAnchor(recordId);

    const deliveryBody = (options.body || {}) as { totalAmount?: unknown };
    const deliveredAmount = positiveAmount(deliveryBody.totalAmount);

    if (deliveredAmount > 0) {
      const receiptPayload = {
        schema: "msce-prescription-delivery-v2",
        sourceRecordId: recordId,
        totalAmount: deliveredAmount,
        deliveredAt: new Date().toISOString(),
        deliveredByWallet: session.walletAddress,
      };

      try {
        const { uploaded, hash } = await uploadMedicalPayloadWithFallback(
          receiptPayload,
          [
            normalizeWallet(current.ownerWallet),
            normalizeWallet(current.doctorWallet),
            normalizeWallet(current.pharmacyWallet || session.walletAddress),
          ].filter(Boolean),
          `delivery-receipt-${recordId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now()}.json`
        );

        await storeAnchorOnChain({
          recordKey: deliveryReceiptRecordId(recordId),
          kind: "OTHER",
          cid: uploaded.cid,
          hashHex: hash,
          ownerWallet: normalizeWallet(current.ownerWallet),
          doctorWallet: normalizeWallet(current.doctorWallet) || normalizeWallet(session.walletAddress),
          pharmacyWallet: normalizeWallet(current.pharmacyWallet || session.walletAddress) || null,
          insurerWallet: normalizeWallet(current.insurerWallet || "") || null,
        });
      } catch {
        // Delivery success must not fail because of receipt persistence issues.
      }
    }

    return { status: updated.status } as T;
  }

  if (pathname.match(/^\/prescriptions\/[^/]+\/cancel$/) && method === "POST") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["PATIENT", "MEDECIN"]);
    const recordId = pathname.split("/")[2];
    const current = await getAnchor(recordId);
    if (!isPrescriptionAnchor(current) || !(await canAccessAnchor(current, session))) {
      throw new Error("Acces refuse a cette ordonnance.");
    }

    const isOwnerOrDoctor =
      normalizeWallet(current.ownerWallet).toLowerCase() === normalizeWallet(session.walletAddress).toLowerCase() ||
      normalizeWallet(current.doctorWallet).toLowerCase() === normalizeWallet(session.walletAddress).toLowerCase();

    if (!isOwnerOrDoctor) {
      throw new Error("Seul le patient ou le medecin emetteur peut annuler.");
    }

    await cancelRecordOnChain(recordId);
    const payload = await getAnchor(recordId);
    return { status: payload.status } as T;
  }

  if (pathname.match(/^\/records\/patient\/[^/]+$/) && method === "GET") {
    if (!session) throw new Error("Session requise");
    const patientWallet = decodeURIComponent(pathname.split("/")[3]).trim();
    if (!patientWallet) throw new Error("wallet patient invalide");

    const allAnchors = await listAnchors();
    const patientAnchors = allAnchors.filter((item) => normalizeWallet(item.ownerWallet).toLowerCase() === normalizeWallet(patientWallet).toLowerCase());

    if (session.role === "PATIENT" && normalizeWallet(session.walletAddress).toLowerCase() !== normalizeWallet(patientWallet).toLowerCase()) {
      throw new Error("Acces refuse au dossier d'un autre patient.");
    }

    if (!["ADMIN", "SUB_ADMIN", "ASSURANCE", "PATIENT"].includes(session.role)) {
      const checks = await Promise.all(
        patientAnchors.map(async (item) => ({
          recordId: item.recordId,
          canRead: await canReadOnChain(item.recordId, session.walletAddress).catch(() => false),
        }))
      );
      const hasRelationship = checks.some((item) => item.canRead);

      if (!hasRelationship) {
        throw new Error("Acces refuse: vous n'etes pas autorise pour ce patient.");
      }
    }

    const prescriptionAnchors = patientAnchors.filter(isPrescriptionAnchor);
    const eventAnchors = patientAnchors.filter(isEventAnchor);

    const events = eventAnchors.map((anchor) => ({
      eventId: `${anchor.recordId}:ANCHOR`,
      eventType: `${anchor.kind}_ANCHORED`,
      actorId: anchor.doctorWallet,
      actorRole: "BLOCKCHAIN",
      occurredAt: anchor.updatedAt || anchor.createdAt || new Date().toISOString(),
      data: {
        recordId: anchor.recordId,
        status: anchor.status,
        cid: anchor.cid,
        hash: anchor.hash,
      },
    }));

    const prescriptions = prescriptionAnchors.map((anchor) => ({
      recordId: anchor.recordId,
      status: anchor.status,
      version: 1,
      issuedAt: anchor.createdAt || new Date().toISOString(),
      doctorWallet: anchor.doctorWallet,
      cid: anchor.cid,
      hash: anchor.hash,
    }));

    return {
      walletAddress: patientWallet,
      summary: {
        totalVisits: eventAnchors.filter((item) => item.kind === "VISIT").length,
        totalLabTests: eventAnchors.filter((item) => item.kind === "LAB_RESULT").length,
        totalHospitalEvents: eventAnchors.filter((item) => item.kind === "OPERATION").length,
        totalPrescriptions: prescriptions.length,
      },
      events,
      prescriptions,
    } as T;
  }

  if (pathname === "/medical-events/mine" && method === "GET") {
    if (!session) throw new Error("Session requise");
    const anchors = (await listAnchors()).filter(
      (item) => normalizeWallet(item.ownerWallet).toLowerCase() === normalizeWallet(session.walletAddress).toLowerCase() && isEventAnchor(item)
    );
    const storedProfile = loadPatientProfile(session.walletAddress);
    const profile: PatientProfile = {
      ...storedProfile,
      primaryDoctorWallet: storedProfile.primaryDoctorWallet || session.identity?.primaryDoctorWallet || null,
    };

    const visits: Array<{
      eventId: string;
      occurredAt: string;
      data: { diagnosis?: string; notes?: string; amountClaim?: number };
      actorWallet?: string;
      blockchainVerified?: boolean;
    }> = [];

    const labResults: Array<{
      eventId: string;
      occurredAt: string;
      data: { testType: string; resultSummary: string; amountClaim?: number; pdfPath?: string; documentCid?: string };
      actorWallet: string;
      blockchainVerified?: boolean;
    }> = [];

    const pastOperations: Array<{
      eventId: string;
      eventType: string;
      occurredAt: string;
      data: { operationName?: string; details?: string; department?: string; notes?: string; amountClaim?: number; pdfPath?: string; documentCid?: string };
      actorWallet: string;
      blockchainVerified?: boolean;
    }> = [];

    for (const anchor of anchors) {
      const recordId = String(anchor.recordId || "");
      const fallbackOccurredAt = String(anchor.createdAt || new Date().toISOString());
      const actorWallet = normalizeWallet(anchor.doctorWallet);

      const { payload, blockchainVerified } = await parseAnchorPayload(anchor);
      const eventType = normalizeMedicalEventType(payload?.eventType);
      const eventDomainRaw = String(payload?.eventDomain || "").trim().toUpperCase();
      const eventDomain = ["VISIT", "LAB_RESULT", "MEDICAL_ACT"].includes(eventDomainRaw)
        ? (eventDomainRaw as "VISIT" | "LAB_RESULT" | "MEDICAL_ACT")
        : deriveMedicalEventDomain(eventType);
      const details = asNonEmptyText(payload?.details);
      const occurredAt = safeDateIso(payload?.createdAt, fallbackOccurredAt);
      const department = asNonEmptyText(payload?.department);
      const amountClaim = positiveAmount(payload?.amountClaim);
      const sourceDocumentCid = asNonEmptyText(payload?.sourceDocumentCid);
      const pdfPath = sourceDocumentCid
        ? (() => {
            try {
              return getGatewayUrl(sourceDocumentCid);
            } catch {
              return undefined;
            }
          })()
        : undefined;

      if (eventDomain === "VISIT" || anchor.kind === "VISIT") {
        const lines = (details || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const diagnosis = asNonEmptyText(payload?.diagnosis) || lines[0] || "Consultation medicale";
        const notes =
          asNonEmptyText(payload?.notes) ||
          lines.slice(1).join("\n") ||
          (blockchainVerified === false ? "Evenement ancre, mais metadata IPFS non disponible." : undefined);

        visits.push({
          eventId: recordId,
          occurredAt,
          data: { diagnosis, notes, amountClaim: amountClaim > 0 ? amountClaim : 0 },
          actorWallet,
          blockchainVerified,
        });
        continue;
      }

      const testType = asNonEmptyText(payload?.testType);
      const resultSummary = asNonEmptyText(payload?.resultSummary);
      if (eventDomain === "LAB_RESULT" || anchor.kind === "LAB_RESULT" || testType || resultSummary) {
        labResults.push({
          eventId: recordId,
          occurredAt,
          actorWallet,
          blockchainVerified,
          data: {
            testType: testType || "Analyse",
            resultSummary: resultSummary || details || "Resultat laboratoire ancre sur blockchain.",
            amountClaim: amountClaim || undefined,
            documentCid: sourceDocumentCid || undefined,
            pdfPath,
          },
        });
        continue;
      }

      pastOperations.push({
        eventId: recordId,
        eventType: eventType || "INTERVENTION",
        occurredAt,
        actorWallet,
        blockchainVerified,
        data: {
          operationName: asNonEmptyText(payload?.operationName) || eventType || "Acte medical",
          details: details || "Acte medical ancre sur blockchain.",
          department: department || "SERVICE_HOSPITALIER",
          notes: asNonEmptyText(payload?.notes),
          amountClaim: amountClaim || undefined,
          documentCid: sourceDocumentCid || undefined,
          pdfPath,
        },
      });
    }

    const sortByDateDesc = <TItem extends { occurredAt: string }>(items: TItem[]) =>
      items.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

    return {
      profile: {
        bloodType: profile.bloodType || null,
        age: profile.age || null,
        diseases: profile.diseases || [],
        primaryDoctorWallet: profile.primaryDoctorWallet || anchors[0]?.doctorWallet || null,
        region: profile.region || null,
      },
      visits: sortByDateDesc(visits),
      labResults: sortByDateDesc(labResults),
      pastOperations: sortByDateDesc(pastOperations),
    } as T;
  }

  if (pathname === "/auth/relink-doctor" && method === "PATCH") {
    if (!session) throw new Error("Session requise");
    const body = (options.body || {}) as { doctorWallet?: string; revoked?: boolean };

    const current = loadPatientProfile(session.walletAddress);
    const updated: PatientProfile = body.revoked
      ? { ...current, primaryDoctorWallet: null }
      : { ...current, primaryDoctorWallet: normalizeWallet(body.doctorWallet) || null };

    savePatientProfile(session.walletAddress, updated);

    saveSession({
      ...session,
      identity: {
        ...(session.identity || {
          role: session.role,
          fullName: session.walletAddress,
          nickname: "wallet",
          dateOfBirth: "1990-01-01",
        }),
        primaryDoctorWallet: updated.primaryDoctorWallet || null,
      },
    });

    return { ok: true } as T;
  }

  if (pathname === "/claims" && method === "GET") {
    if (!session) throw new Error("Session requise");
    const statusFilter = query.get("status") || "ALL";
    const items = await buildClaims(session, statusFilter);
    return { items } as T;
  }

  if (pathname.match(/^\/claims\/prescriptions\/[^/]+$/) && method === "POST") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["PATIENT"]);

    const recordId = pathname.split("/")[3];
    const sourceAnchor = await getAnchor(recordId);
    if (!isPrescriptionAnchor(sourceAnchor) || normalizeWallet(sourceAnchor.ownerWallet).toLowerCase() !== normalizeWallet(session.walletAddress).toLowerCase()) {
      throw new Error("Acces refuse a cette ordonnance.");
    }

    const normalizedStatus = String(sourceAnchor.status || "").toUpperCase();
    if (normalizedStatus !== "DELIVERED") {
      throw new Error("L'ordonnance doit etre delivree avant reclamation assurance.");
    }

    const amountRequested = await readDeliveredPrescriptionAmount(recordId);
    if (amountRequested <= 0) {
      throw new Error("Montant de delivrance introuvable pour cette ordonnance.");
    }

    let insurerWallet = normalizeWallet(sourceAnchor.insurerWallet || "");
    if (!insurerWallet) {
      const assignments = listGovernanceAssignments();
      const assurance = assignments.find(a => !a.revoked && normalizeRole(String(a.role || "")) === "ASSURANCE");
      insurerWallet = assurance ? normalizeWallet(assurance.walletAddress) : "5GnfLbWVRGGdYXC8MntaisxDMtwUXQPTqwQwhZePWRKM9guJ";
    }

    if (!insurerWallet) {
      throw new Error("Aucune assurance associee a cette ordonnance.");
    }

    await submitClaimOnChain({
      claimKey: `claim:${recordId}`,
      sourceRecordKeyOrHash: recordId,
      insurerWallet,
      amountRequested,
    });

    return { ok: true } as T;
  }

  if (pathname.match(/^\/claims\/events\/[^/]+$/) && method === "POST") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["PATIENT"]);

    const eventId = pathname.split("/")[3];
    const anchor = await getAnchor(eventId);
    if (!isEventAnchor(anchor)) {
      throw new Error("Cette source n'est pas un evenement medical.");
    }
    if (normalizeWallet(anchor.ownerWallet).toLowerCase() !== normalizeWallet(session.walletAddress).toLowerCase()) {
      throw new Error("Acces refuse a cet evenement.");
    }

    let insurerWallet = normalizeWallet(anchor.insurerWallet || "");
    if (!insurerWallet) {
      const assignments = listGovernanceAssignments();
      const assurance = assignments.find(a => !a.revoked && normalizeRole(String(a.role || "")) === "ASSURANCE");
      insurerWallet = assurance ? normalizeWallet(assurance.walletAddress) : "5GnfLbWVRGGdYXC8MntaisxDMtwUXQPTqwQwhZePWRKM9guJ";
    }

    if (!insurerWallet) {
      throw new Error("Aucune assurance associee a cet evenement.");
    }

    const parsed = await parseAnchorPayload(anchor);
    const amountRequested = positiveAmount(parsed.payload?.amountClaim);

    if (amountRequested <= 0) {
      throw new Error("Cet evenement ne contient pas de montant remboursable.");
    }

    await submitClaimOnChain({
      claimKey: `claim:${eventId}`,
      sourceRecordKeyOrHash: eventId,
      insurerWallet,
      amountRequested,
    });

    return { ok: true } as T;
  }

  if (pathname.match(/^\/claims\/[^/]+\/review$/) && method === "PATCH") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["ASSURANCE"]);

    const claimId = pathname.split("/")[2];
    const body = (options.body || {}) as { decision?: "APPROVED" | "REJECTED"; amountApproved?: number; reason?: string };
    if (!body.decision) {
      throw new Error("Decision manquante");
    }

    const approve = body.decision === "APPROVED";
    const amountApproved = approve ? Number(body.amountApproved || 0) : undefined;
    const reasonHash = body.reason ? await bodyDigest({ reason: body.reason }) : undefined;

    await reviewClaimOnChain({
      claimKeyOrHash: claimId,
      approve,
      amountApproved,
      reasonHashHex: reasonHash,
    });

    return { ok: true } as T;
  }

  if (pathname.match(/^\/claims\/[^/]+\/reimburse$/) && method === "POST") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["ASSURANCE"]);

    const claimId = pathname.split("/")[2];
    const paymentReference = `PAY-${Date.now()}`;
    const paymentReferenceHash = await bodyDigest({ paymentReference });

    await markClaimReimbursedOnChain(claimId, paymentReferenceHash);
    return { paymentReference } as T;
  }

  if (pathname === "/medical-events/visit" && method === "POST") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["MEDECIN", "HOPITAL"]);

    const body = (options.body || {}) as {
      patientWallet?: string;
      diagnosis?: string;
      notes?: string;
      amountClaim?: number;
      documentCid?: string;
      insurerWallet?: string;
    };

    const patientWallet = normalizeWallet(body.patientWallet);
    if (!patientWallet) {
      throw new Error("patientWallet est obligatoire");
    }

    const diagnosis = asNonEmptyText(body.diagnosis);
    if (!diagnosis) {
      throw new Error("diagnosis est obligatoire");
    }

    const notes = asNonEmptyText(body.notes);
    const createdAt = new Date().toISOString();
    const sourceDocumentCid = asNonEmptyText(body.documentCid);

    const eventPayload = {
      schema: "msce-medical-event-v2",
      eventDomain: "VISIT",
      patientWallet,
      eventType: "VISIT",
      visitKind: "CONSULTATION",
      diagnosis,
      notes: notes || null,
      details: [diagnosis, notes].filter(Boolean).join("\n"),
      amountClaim: positiveAmount(body.amountClaim),
      sourceDocumentCid: sourceDocumentCid || null,
      actorWallet: session.walletAddress,
      actorRole: session.role,
      createdAt,
    };

    const { uploaded, hash } = await uploadMedicalPayloadWithFallback(
      eventPayload,
      [
        normalizeWallet(patientWallet),
        normalizeWallet(session.walletAddress),
        normalizeWallet(body.insurerWallet),
      ].filter(Boolean),
      `medical-visit-${Date.now()}.json`
    );

    const recordId = await storeAnchorOnChain({
      recordKey: `event:${crypto.randomUUID()}`,
      kind: "VISIT",
      cid: uploaded.cid,
      hashHex: hash,
      ownerWallet: patientWallet,
      doctorWallet: session.walletAddress,
      insurerWallet: normalizeWallet(body.insurerWallet) || null,
      pharmacyWallet: null,
    });

    return { eventId: recordId } as T;
  }

  if (pathname === "/hopital/events" && method === "POST") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["HOPITAL", "MEDECIN"]);
    const body = (options.body || {}) as {
      patientWallet?: string;
      eventType?: string;
      department?: string;
      details?: string;
      amountClaim?: number;
      documentCid?: string;
      insurerWallet?: string;
    };

    const patientWallet = normalizeWallet(body.patientWallet);
    if (!patientWallet) {
      throw new Error("patientWallet est obligatoire");
    }

    const createdAt = new Date().toISOString();
    const normalizedEventType = normalizeMedicalEventType(body.eventType || "INTERVENTION");
    const eventDomain = deriveMedicalEventDomain(normalizedEventType);

    if (eventDomain === "VISIT") {
      throw new Error("Utilisez /medical-events/visit pour les visites medicales.");
    }

    if (eventDomain === "LAB_RESULT") {
      throw new Error("Utilisez /labo/results pour les resultats laboratoire.");
    }

    const sourceDocumentCid = asNonEmptyText(body.documentCid);

    const eventPayload = {
      schema: "msce-medical-event-v2",
      eventDomain,
      patientWallet,
      eventType: normalizedEventType,
      department: asNonEmptyText(body.department) || null,
      details: asNonEmptyText(body.details) || null,
      amountClaim: positiveAmount(body.amountClaim),
      sourceDocumentCid: sourceDocumentCid || null,
      actorWallet: session.walletAddress,
      actorRole: session.role,
      createdAt,
    };

    const { uploaded, hash } = await uploadMedicalPayloadWithFallback(
      eventPayload,
      [
        normalizeWallet(patientWallet),
        normalizeWallet(session.walletAddress),
        normalizeWallet(body.insurerWallet),
      ].filter(Boolean),
      `medical-event-${normalizedEventType.toLowerCase()}-${Date.now()}.json`
    );

    const recordId = await storeAnchorOnChain({
      recordKey: `event:${crypto.randomUUID()}`,
      kind: "OPERATION",
      cid: uploaded.cid,
      hashHex: hash,
      ownerWallet: patientWallet,
      doctorWallet: session.walletAddress,
      insurerWallet: normalizeWallet(body.insurerWallet) || null,
      pharmacyWallet: null,
    });

    return { eventId: recordId } as T;
  }

  if (pathname === "/labo/results" && method === "POST") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["LABO", "HOPITAL", "MEDECIN"]);

    const body = (options.body || {}) as {
      patientWallet?: string;
      testType?: string;
      resultSummary?: string;
      amountClaim?: number;
      documentCid?: string;
      insurerWallet?: string;
    };

    const patientWallet = normalizeWallet(body.patientWallet);
    if (!patientWallet) {
      throw new Error("patientWallet est obligatoire");
    }

    const testType = asNonEmptyText(body.testType);
    const resultSummary = asNonEmptyText(body.resultSummary);
    if (!testType || !resultSummary) {
      throw new Error("testType et resultSummary sont obligatoires");
    }

    const createdAt = new Date().toISOString();
    const sourceDocumentCid = asNonEmptyText(body.documentCid);
    const eventPayload = {
      schema: "msce-medical-event-v2",
      eventDomain: "LAB_RESULT",
      patientWallet,
      eventType: "LAB_RESULT",
      department: "LABORATOIRE",
      details: resultSummary,
      testType,
      resultSummary,
      amountClaim: positiveAmount(body.amountClaim),
      sourceDocumentCid: sourceDocumentCid || null,
      actorWallet: session.walletAddress,
      actorRole: session.role,
      createdAt,
    };

    const { uploaded, hash } = await uploadMedicalPayloadWithFallback(
      eventPayload,
      [
        normalizeWallet(patientWallet),
        normalizeWallet(session.walletAddress),
        normalizeWallet(body.insurerWallet),
      ].filter(Boolean),
      `labo-result-${Date.now()}.json`
    );

    const recordId = await storeAnchorOnChain({
      recordKey: `event:${crypto.randomUUID()}`,
      kind: "LAB_RESULT",
      cid: uploaded.cid,
      hashHex: hash,
      ownerWallet: patientWallet,
      doctorWallet: session.walletAddress,
      insurerWallet: normalizeWallet(body.insurerWallet) || null,
      pharmacyWallet: null,
    });

    return { eventId: recordId } as T;
  }

  if (pathname === "/admin/users" && method === "GET") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["ADMIN"]);

    const anchors = await listAnchors();
    const roleWallets = new Set<string>();

    const addWallet = (value?: string | null) => {
      const wallet = String(value || "").trim();
      if (wallet) roleWallets.add(wallet);
    };

    for (const anchor of anchors) {
      addWallet(anchor.ownerWallet);
      addWallet(anchor.doctorWallet);
      addWallet(anchor.pharmacyWallet || null);
      addWallet(anchor.insurerWallet || null);
    }

    for (const walletAddress of listGovernanceWallets()) {
      addWallet(walletAddress);
    }

    addWallet(session.walletAddress);

    const sessionRegion = getSessionRegion(session);
    const users: AdminListItem[] = [];

    for (const walletAddress of Array.from(roleWallets.values())) {
      try {
        const resolvedRole = await resolveWalletRoleOnChain(walletAddress);
        const identity = await resolveWalletIdentityOnChain(walletAddress);

        const role = normalizeRole(String(resolvedRole.role || "")) || "UNASSIGNED";
        const region = String(resolvedRole.region || "").trim() || null;
        if (!session.identity?.isGlobalAdmin && sessionRegion && region && region !== sessionRegion) {
          continue;
        }

        users.push({
          walletAddress,
          roles: [role],
          identity: {
            role,
            fullName: identity.fullName || (walletAddress.toLowerCase() === session.walletAddress.toLowerCase() ? "Local User" : "Utilisateur Wallet"),
            nickname: "wallet-user",
            dateOfBirth: "1990-01-01",
            region,
            isGlobalAdmin: Boolean(resolvedRole.isGlobalAdmin),
            institutionName: identity.institutionName || null,
            departmentName: identity.departmentName || null,
            approvalStatus: role === "MEDECIN" ? "PENDING" : role === "UNASSIGNED" ? undefined : "APPROVED",
          },
        });
      } catch {
        // Keep listing robust even if one wallet fails.
      }
    }

    return { items: users } as T;
  }

  if (pathname === "/admin/users" && method === "POST") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["ADMIN"]);

    const body = (options.body || {}) as {
      walletAddress?: string;
      role?: string;
      region?: string;
      institutionName?: string;
      departmentName?: string;
    };

    const walletAddress = String(body.walletAddress || "").trim();
    const role = normalizeRole(String(body.role || ""));
    if (!walletAddress) throw new Error("walletAddress est obligatoire.");
    if (!role) throw new Error("role invalide.");
    if (!canAssignRole(session, role)) {
      throw new Error("Admin regional: attribution ADMIN/SUB_ADMIN interdite.");
    }

    const region = session.identity?.isGlobalAdmin
      ? String(body.region || "").trim() || null
      : getSessionRegion(session);

    await storeRoleAssignment(session, {
      walletAddress,
      role,
      region,
      institutionName: body.institutionName || null,
      departmentName: body.departmentName || null,
      isGlobalAdmin: role === "ADMIN" && Boolean(session.identity?.isGlobalAdmin),
    });

    return { ok: true } as T;
  }

  if (pathname === "/admin/users" && method === "DELETE") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["ADMIN"]);

    const body = (options.body || {}) as { walletAddress?: string; role?: string };
    const walletAddress = String(body.walletAddress || "").trim();
    const role = normalizeRole(String(body.role || ""));

    if (!walletAddress) throw new Error("walletAddress est obligatoire.");
    if (!role) throw new Error("role invalide.");
    if (!canAssignRole(session, role)) {
      throw new Error("Admin regional: revocation ADMIN/SUB_ADMIN interdite.");
    }

    await storeRoleAssignment(session, {
      walletAddress,
      role,
      region: session.identity?.isGlobalAdmin ? null : getSessionRegion(session),
      revoked: true,
    });

    return { ok: true } as T;
  }

  if (pathname === "/admin/users/institution" && method === "PATCH") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["ADMIN"]);

    const body = (options.body || {}) as {
      walletAddress?: string;
      role?: string;
      institutionName?: string;
      departmentName?: string;
    };

    const walletAddress = String(body.walletAddress || "").trim();
    const role = normalizeRole(String(body.role || ""));
    const institutionName = String(body.institutionName || "").trim();
    const departmentName = String(body.departmentName || "").trim();

    if (!walletAddress) throw new Error("walletAddress est obligatoire.");
    if (!["ASSURANCE", "HOPITAL", "PHARMACIE", "MEDECIN", "LABO"].includes(role)) {
      throw new Error("role incompatible pour les details institutionnels.");
    }
    if (!departmentName) throw new Error("departmentName est obligatoire.");
    if (role !== "MEDECIN" && !institutionName) {
      throw new Error("institutionName est obligatoire pour ce role.");
    }

    await storeRoleAssignment(session, {
      walletAddress,
      role,
      region: session.identity?.isGlobalAdmin ? null : getSessionRegion(session),
      institutionName: institutionName || null,
      departmentName,
    });

    return { ok: true } as T;
  }

  if (pathname === "/admin/users/approval" && method === "PATCH") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["ADMIN"]);

    const body = (options.body || {}) as { walletAddress?: string; approved?: boolean };
    const walletAddress = String(body.walletAddress || "").trim();
    if (!walletAddress) throw new Error("walletAddress est obligatoire.");

    await storeRoleAssignment(session, {
      walletAddress,
      role: "MEDECIN",
      region: session.identity?.isGlobalAdmin ? null : getSessionRegion(session),
      approvalStatus: body.approved ? "APPROVED" : "REJECTED",
    });

    return { ok: true } as T;
  }

  throw new Error(`Route non supportee en mode decentralise: ${method} ${pathname}`);
}
