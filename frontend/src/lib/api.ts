import { connectWallet, signMessage } from "./wallet";
import { loadSession, saveSession, type Session } from "./session";
import { downloadJsonFromIpfs, getGatewayUrl, uploadJsonToIpfs } from "./ipfsClient";
import { decryptMedicalPayload, type EncryptedPayload } from "./medicalCrypto";

const BLOCKCHAIN_API_URL = (process.env.NEXT_PUBLIC_BLOCKCHAIN_API_URL || "http://localhost:4600").replace(/\/$/, "");
const CLAIMS_KEY = "msc_claim_overrides_v1";
const PROFILE_KEY = "msc_patient_profiles_v1";

type SignedRequestOptions = {
  method?: string;
  path: string;
  body?: unknown;
  signed?: boolean;
  auth?: boolean;
};

type AnchorItem = {
  recordId: string;
  hash: string;
  cid: string;
  ownerWallet: string;
  doctorWallet: string;
  pharmacyWallet?: string | null;
  authorizedWallets?: string[];
  status: string;
  createdAt?: string;
  updatedAt?: string;
};

type ClaimOverride = {
  requested?: boolean;
  status?: "PENDING" | "APPROVED" | "REJECTED" | "REIMBURSED";
  amountApproved?: number;
  reason?: string;
  paymentReference?: string;
  reimbursedAt?: string;
  sourceType?: "PRESCRIPTION" | "VISIT" | "OPERATION" | "LAB_TEST";
  sourceId?: string;
  patientWallet?: string;
  providerWallet?: string;
  providerRole?: string;
  amountRequested?: number;
  createdAt?: string;
  verification?: {
    anchorValid?: boolean;
    anchorStatus?: string;
    method?: string;
  };
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

const ADMIN_ROLE_RECORD_PREFIX = "mongo:walletroles:";

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

  const ipfs = await uploadJsonToIpfs(document, `wallet-role-${payload.walletAddress}-${Date.now()}.json`);
  const hash = await bodyDigest(document);

  await blockchainRequest("/anchors/store", {
    method: "POST",
    body: JSON.stringify({
      recordId: `${ADMIN_ROLE_RECORD_PREFIX}${payload.walletAddress}:${Date.now()}:${payload.role}:${payload.revoked ? "REVOKED" : "ACTIVE"}${payload.isGlobalAdmin ? ":GLOBAL" : ""}`,
      hash,
      cid: ipfs.cid,
      ownerWallet: payload.walletAddress,
      doctorWallet: session.walletAddress,
      authorizedWallets: [session.walletAddress],
      timestamp: Math.floor(Date.now() / 1000),
    }),
  });
}

async function sha256Hex(input: Uint8Array) {
  if (typeof crypto !== "undefined" && typeof crypto.subtle?.digest === "function") {
    const digest = await crypto.subtle.digest("SHA-256", input as BufferSource);
    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }

  throw new Error("SHA-256 indisponible dans cet environnement.");
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

async function bodyDigest(body: unknown) {
  const data = new TextEncoder().encode(canonicalize(body || {}));
  return sha256Hex(data);
}

function signedMessage(method: string, path: string, timestamp: string, nonce: string, bodyHash: string) {
  return [
    "MaSanteEnChaine Signed Request",
    `method:${method.toUpperCase()}`,
    `path:${path}`,
    `timestamp:${timestamp}`,
    `nonce:${nonce}`,
    `bodyHash:${bodyHash}`
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

async function blockchainRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BLOCKCHAIN_API_URL}${path}`, {
    cache: "no-store",
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    ...init
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (payload as { error?: string })?.error || `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

function parsePath(path: string) {
  const [pathname, queryString] = path.split("?");
  return {
    pathname,
    query: new URLSearchParams(queryString || "")
  };
}

function loadClaimOverrides(): Record<string, ClaimOverride> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(CLAIMS_KEY) || "{}") as Record<string, ClaimOverride>;
  } catch {
    return {};
  }
}

function saveClaimOverrides(overrides: Record<string, ClaimOverride>) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CLAIMS_KEY, JSON.stringify(overrides));
}

function loadProfiles(): Record<string, PatientProfile> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}") as Record<string, PatientProfile>;
  } catch {
    return {};
  }
}

function saveProfiles(profiles: Record<string, PatientProfile>) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles));
}

async function listAnchors() {
  const payload = await blockchainRequest<{ items: AnchorItem[] }>("/anchors");
  return payload.items || [];
}

async function getAnchor(recordId: string) {
  const payload = await blockchainRequest<{ anchor: AnchorItem }>(`/anchors/${recordId}`);
  return payload.anchor;
}

function isSystemAnchorRecord(recordId: string) {
  const id = String(recordId || "").toLowerCase();
  return (
    id.startsWith("mongo:authnonces:") ||
    id.startsWith("mongo:requestnonces:") ||
    id.startsWith("mongo:walletroles:") ||
    id.startsWith("mongo:walletidentities:") ||
    id.startsWith("mongo:users:") ||
    id.startsWith("receipt:")
  );
}

function isPrescriptionAnchor(anchor: AnchorItem) {
  const id = String(anchor.recordId || "").toLowerCase();
  if (isSystemAnchorRecord(id)) return false;
  if (id.startsWith("event:") || id.startsWith("evt:") || id.startsWith("visit:")) return false;

  // Only explicit prescription anchors are listed as ordonnances.
  return id.startsWith("presc:") || id.startsWith("ord:") || id.startsWith("ordonnance:");
}

function canAccessAnchor(anchor: AnchorItem, session: Session) {
  const sessionWallet = normalizeWallet(session.walletAddress);
  const ownerWallet = normalizeWallet(anchor.ownerWallet);
  const doctorWallet = normalizeWallet(anchor.doctorWallet);
  const pharmacyWallet = normalizeWallet(anchor.pharmacyWallet || "");
  const authorizedWallets = (anchor.authorizedWallets || []).map((wallet) => normalizeWallet(wallet));

  if (session.role === "ADMIN" || session.role === "SUB_ADMIN" || session.role === "ASSURANCE") {
    return true;
  }

  if (session.role === "PATIENT") {
    return ownerWallet === sessionWallet;
  }

  if (session.role === "PHARMACIE") {
    if (isPrescriptionAnchor(anchor)) {
      return true;
    }

    return (
      pharmacyWallet === sessionWallet ||
      authorizedWallets.includes(sessionWallet)
    );
  }

  if (session.role === "MEDECIN" || session.role === "HOPITAL" || session.role === "LABO") {
    return (
      doctorWallet === sessionWallet ||
      authorizedWallets.includes(sessionWallet)
    );
  }

  return ownerWallet === sessionWallet;
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
    totalAmount: 0
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

function isEncryptedPayload(payload: unknown): payload is EncryptedPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const input = payload as Record<string, unknown>;
  return (
    input.algorithm === "AES-GCM" &&
    typeof input.saltB64 === "string" &&
    typeof input.ivB64 === "string" &&
    typeof input.ciphertextB64 === "string"
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
    if (!cid || cid.startsWith("pending:") || cid.startsWith("pending-file:")) {
      return 0;
    }

    const payload = await downloadJsonFromIpfs<Record<string, unknown>>(cid);
    return positiveAmount(payload.totalAmount ?? payload.amount ?? payload.amountRequested);
  } catch {
    return 0;
  }
}

async function buildClaims(session: Session, statusFilter: string) {
  const anchors = await listAnchors();
  const overrides = loadClaimOverrides();

  const prescriptionClaims = await Promise.all(
    anchors
      .filter((anchor) => {
        if (!isPrescriptionAnchor(anchor)) return false;
        const claimId = `CLM-${anchor.recordId}`;
        const requested = overrides[claimId]?.requested;
        if (!requested) return false;
        return session.role === "ASSURANCE" || anchor.ownerWallet === session.walletAddress;
      })
      .map(async (anchor) => {
        const claimId = `CLM-${anchor.recordId}`;
        const override = overrides[claimId] || {};
        const status = override.status || "PENDING";

        let amountRequested = Number(override.amountRequested || 0);
        if (amountRequested <= 0) {
          amountRequested = await readDeliveredPrescriptionAmount(anchor.recordId);
          if (amountRequested > 0) {
            overrides[claimId] = {
              ...override,
              amountRequested,
            };
          }
        }

        return {
          claimId,
          sourceType: "PRESCRIPTION",
          sourceId: anchor.recordId,
          patientWallet: anchor.ownerWallet,
          providerWallet: anchor.doctorWallet,
          providerRole: "MEDECIN",
          amountRequested,
          amountApproved: override.amountApproved,
          status,
          reason: override.reason,
          paymentReference: override.paymentReference,
          reimbursedAt: override.reimbursedAt,
          verification: {
            anchorValid: true,
            anchorStatus: anchor.status,
            method: "RUST_ANCHOR"
          },
          createdAt: anchor.createdAt || new Date().toISOString()
        };
      })
  );

  saveClaimOverrides(overrides);

  const eventClaims = Object.entries(overrides)
    .filter(([, override]) => {
      if (!override?.requested) return false;
      if (!override?.sourceType || override.sourceType === "PRESCRIPTION") return false;
      const patientWallet = normalizeWallet(override.patientWallet);
      return session.role === "ASSURANCE" || patientWallet === normalizeWallet(session.walletAddress);
    })
    .map(([claimId, override]) => ({
      claimId,
      sourceType: override.sourceType,
      sourceId: override.sourceId || "",
      patientWallet: override.patientWallet || "",
      providerWallet: override.providerWallet,
      providerRole: override.providerRole,
      amountRequested: Number(override.amountRequested || 0),
      amountApproved: override.amountApproved,
      status: override.status || "PENDING",
      reason: override.reason,
      paymentReference: override.paymentReference,
      reimbursedAt: override.reimbursedAt,
      verification: override.verification || {
        anchorValid: true,
        method: "RUST_ANCHOR",
      },
      createdAt: override.createdAt || new Date().toISOString(),
    }));

  const claims = [...prescriptionClaims, ...eventClaims];

  if (!statusFilter || statusFilter === "ALL") {
    return claims;
  }

  return claims.filter((item) => item.status === statusFilter);
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
    const filtered = anchors.filter((anchor) => (session ? canAccessAnchor(anchor, session) : false));

    return { items: filtered.map(mapPrescriptionSummary) } as T;
  }

  if (pathname.match(/^\/prescriptions\/[^/]+$/) && method === "GET") {
    if (!session) throw new Error("Session requise");
    const recordId = pathname.split("/")[2];
    const anchor = await getAnchor(recordId);
    if (!isPrescriptionAnchor(anchor)) {
      throw new Error("Cet identifiant ne correspond pas a une ordonnance.");
    }
    if (!canAccessAnchor(anchor, session)) {
      throw new Error("Acces refuse a cette ordonnance.");
    }

    const cid = String(anchor.cid || "").trim();
    const baseResponse = {
      recordId: anchor.recordId,
      status: anchor.status,
      blockchainHash: anchor.hash,
      ipfsCid: cid || null,
    };

    if (!cid || cid.startsWith("pending:") || cid.startsWith("pending-file:")) {
      return {
        ...baseResponse,
        contentState: "PENDING_IPFS",
        data: {
          ordonnanceText:
            "Ordonnance ancree sans contenu IPFS lisible. Le medecin doit activer l'upload IPFS chiffre pour afficher le detail.",
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

    if (isEncryptedPayload(ipfsPayload)) {
      const passphrase = String(query.get("passphrase") || "").trim();
      if (!passphrase) {
        return {
          ...baseResponse,
          contentState: "ENCRYPTED_LOCKED",
          data: {
            ordonnanceText: "Document chiffre sur IPFS. Saisissez la passphrase pour afficher le contenu.",
          },
        } as T;
      }

      try {
        const decrypted = await decryptMedicalPayload<Record<string, unknown>>(ipfsPayload, passphrase);
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
            ordonnanceText: "Passphrase invalide ou document IPFS non dechiffrable.",
          },
        } as T;
      }
    }

    const parsed = extractPrescriptionData(ipfsPayload);

    return {
      ...baseResponse,
      contentState: "PLAIN_IPFS",
      data: {
        ordonnanceText: parsed.ordonnanceText || "Ordonnance IPFS trouvee, mais aucun champ texte exploitable n'a ete detecte.",
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
    if (!canAccessAnchor(anchor, session)) {
      throw new Error("Acces refuse a cette ordonnance.");
    }

    return {
      recordId: anchor.recordId,
      status: anchor.status,
      data: {
        ordonnanceText: `CID: ${anchor.cid}`,
        hash: anchor.hash
      },
      blockchainHash: anchor.hash
    } as T;
  }

  if (pathname.match(/^\/prescriptions\/[^/]+\/deliver$/) && method === "POST") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["PHARMACIE"]);
    const recordId = pathname.split("/")[2];
    const current = await getAnchor(recordId);
    if (!isPrescriptionAnchor(current) || !canAccessAnchor(current, session)) {
      throw new Error("Acces refuse a cette ordonnance.");
    }

    const candidates = new Set<string>();
    const pushCandidate = (value: string | null | undefined) => {
      const wallet = normalizeWallet(value);
      if (wallet) candidates.add(wallet);
    };

    // Prefer wallets already accepted by the Rust deliver policy.
    pushCandidate(current.pharmacyWallet || null);
    pushCandidate(session.walletAddress);
    pushCandidate(current.doctorWallet);
    pushCandidate(current.ownerWallet);

    let payload: { anchor: AnchorItem } | null = null;
    let usedCallerWallet = normalizeWallet(session.walletAddress);
    let lastError: Error | null = null;

    for (const candidate of Array.from(candidates.values())) {
      try {
        payload = await blockchainRequest<{ anchor: AnchorItem }>("/anchors/deliver", {
          method: "POST",
          body: JSON.stringify({
            recordId,
            pharmacyWallet: candidate,
          }),
        });
        usedCallerWallet = candidate;
        break;
      } catch (error: any) {
        const message = String(error?.message || "").toLowerCase();
        lastError = error instanceof Error ? error : new Error(String(error?.message || "Erreur de delivrance"));

        // Retry only for caller-policy rejections.
        if (!message.includes("caller not authorized") && !message.includes("only assigned pharmacy can deliver")) {
          throw lastError;
        }
      }
    }

    if (!payload) {
      throw lastError || new Error("Impossible de delivrer cette ordonnance.");
    }

    const deliveryBody = (options.body || {}) as { totalAmount?: unknown };
    const deliveredAmount = positiveAmount(deliveryBody.totalAmount);
    const claimId = `CLM-${recordId}`;
    const overrides = loadClaimOverrides();
    const previous = overrides[claimId] || {};

    overrides[claimId] = {
      ...previous,
      sourceType: "PRESCRIPTION",
      sourceId: recordId,
      patientWallet: current.ownerWallet,
      providerWallet: current.doctorWallet,
      providerRole: "MEDECIN",
      amountRequested: deliveredAmount > 0 ? deliveredAmount : Number(previous.amountRequested || 0),
      createdAt: current.createdAt || previous.createdAt || new Date().toISOString(),
      verification: {
        ...(previous.verification || {}),
        anchorValid: true,
        anchorStatus: payload.anchor.status,
        method: "RUST_ANCHOR",
      },
    };

    saveClaimOverrides(overrides);

    if (deliveredAmount > 0) {
      const receiptPayload = {
        schema: "msce-prescription-delivery-v1",
        sourceRecordId: recordId,
        totalAmount: deliveredAmount,
        deliveredAt: new Date().toISOString(),
        deliveredByWallet: usedCallerWallet,
        actorWallet: normalizeWallet(session.walletAddress),
      };

      try {
        const uploaded = await uploadJsonToIpfs(
          receiptPayload,
          `delivery-receipt-${recordId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now()}.json`
        );
        const hash = await bodyDigest(receiptPayload);

        const authorizedWallets = Array.from(
          new Set(
            [
              normalizeWallet(current.ownerWallet),
              normalizeWallet(current.doctorWallet),
              normalizeWallet(current.pharmacyWallet || usedCallerWallet),
              normalizeWallet(session.walletAddress),
            ].filter(Boolean)
          )
        );

        await blockchainRequest("/anchors/store", {
          method: "POST",
          body: JSON.stringify({
            recordId: deliveryReceiptRecordId(recordId),
            hash,
            cid: uploaded.cid,
            ownerWallet: normalizeWallet(current.ownerWallet),
            doctorWallet: normalizeWallet(current.doctorWallet) || normalizeWallet(session.walletAddress),
            pharmacyWallet: normalizeWallet(current.pharmacyWallet || usedCallerWallet) || undefined,
            authorizedWallets,
            timestamp: Math.floor(Date.now() / 1000),
          }),
        });
      } catch {
        // Delivery success must not fail because of receipt persistence issues.
      }
    }

    return { status: payload.anchor.status } as T;
  }

  if (pathname.match(/^\/prescriptions\/[^/]+\/cancel$/) && method === "POST") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["PATIENT", "MEDECIN"]);
    const recordId = pathname.split("/")[2];
    const current = await getAnchor(recordId);
    if (!isPrescriptionAnchor(current) || !canAccessAnchor(current, session)) {
      throw new Error("Acces refuse a cette ordonnance.");
    }

    const payload = await blockchainRequest<{ anchor: AnchorItem }>("/anchors/cancel", {
      method: "POST",
      body: JSON.stringify({
        recordId,
        requestedByWallet: session.walletAddress
      })
    });

    return { status: payload.anchor.status } as T;
  }

  if (pathname.match(/^\/records\/patient\/[^/]+$/) && method === "GET") {
    if (!session) throw new Error("Session requise");
    const patientWallet = decodeURIComponent(pathname.split("/")[3]).trim();
    if (!patientWallet) throw new Error("wallet patient invalide");

    const allAnchors = await listAnchors();
    const patientAnchors = allAnchors.filter((item) => item.ownerWallet === patientWallet);

    if (session.role === "PATIENT" && session.walletAddress !== patientWallet) {
      throw new Error("Acces refuse au dossier d'un autre patient.");
    }

    if (!["ADMIN", "SUB_ADMIN", "ASSURANCE", "PATIENT"].includes(session.role)) {
      const hasRelationship = patientAnchors.some(
        (item) =>
          item.doctorWallet === session.walletAddress ||
          item.pharmacyWallet === session.walletAddress ||
          (item.authorizedWallets || []).includes(session.walletAddress)
      );

      if (!hasRelationship) {
        throw new Error("Acces refuse: vous n'etes pas autorise pour ce patient.");
      }
    }

    const anchors = patientAnchors.filter((item) => !isSystemAnchorRecord(item.recordId));
    const prescriptionAnchors = anchors.filter(isPrescriptionAnchor);

    const eventBatches = await Promise.all(
      anchors.map(async (item) => {
        const payload = await blockchainRequest<{ items: Array<Record<string, unknown>> }>(`/events/${item.recordId}`);
        return payload.items || [];
      })
    );

    const events = eventBatches.flat().map((evt) => ({
      eventId: String(evt.eventId || crypto.randomUUID()),
      eventType: String(evt.eventType || "ANCHOR_EVENT"),
      actorId: String(evt.actorWallet || "unknown"),
      actorRole: "BLOCKCHAIN",
      occurredAt: String(evt.timestamp || new Date().toISOString()),
      data: evt
    }));

    const prescriptions = prescriptionAnchors.map((anchor) => ({
      recordId: anchor.recordId,
      status: anchor.status,
      version: 1,
      issuedAt: anchor.createdAt || new Date().toISOString(),
      doctorWallet: anchor.doctorWallet,
      cid: anchor.cid,
      hash: anchor.hash
    }));

    return {
      walletAddress: patientWallet,
      summary: {
        totalVisits: 0,
        totalLabTests: 0,
        totalHospitalEvents: events.length,
        totalPrescriptions: prescriptions.length
      },
      events,
      prescriptions
    } as T;
  }

  if (pathname === "/medical-events/mine" && method === "GET") {
    if (!session) throw new Error("Session requise");
    const anchors = (await listAnchors()).filter(
      (item) => item.ownerWallet === session.walletAddress && !isSystemAnchorRecord(item.recordId)
    );
    const profiles = loadProfiles();
    const profile = profiles[session.walletAddress] || {};

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
      if (!recordId.toLowerCase().startsWith("event:")) {
        continue;
      }

      const fallbackOccurredAt = String(anchor.createdAt || new Date().toISOString());
      const actorWallet = normalizeWallet(anchor.doctorWallet);
      const cid = String(anchor.cid || "").trim();

      let payload: Record<string, unknown> | null = null;
      let blockchainVerified: boolean | undefined;

      if (cid && !cid.startsWith("pending:") && !cid.startsWith("pending-file:")) {
        try {
          const downloaded = await downloadJsonFromIpfs<unknown>(cid);
          if (downloaded && typeof downloaded === "object") {
            payload = downloaded as Record<string, unknown>;
            const payloadHash = await bodyDigest(payload);
            blockchainVerified = payloadHash === String(anchor.hash || "");
          }
        } catch {
          blockchainVerified = false;
        }
      }

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

      if (eventDomain === "VISIT" || eventType === "VISIT") {
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
      if (eventDomain === "LAB_RESULT" || eventType === "LAB_RESULT" || testType || resultSummary) {
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
        region: profile.region || null
      },
      visits: sortByDateDesc(visits),
      labResults: sortByDateDesc(labResults),
      pastOperations: sortByDateDesc(pastOperations)
    } as T;
  }

  if (pathname === "/auth/relink-doctor" && method === "PATCH") {
    if (!session) throw new Error("Session requise");
    const body = (options.body || {}) as { doctorWallet?: string; revoked?: boolean };
    
    const profiles = loadProfiles();
    if (body.revoked) {
      profiles[session.walletAddress] = {
        ...(profiles[session.walletAddress] || {}),
        primaryDoctorWallet: null
      };
    } else {
      if (!body.doctorWallet) throw new Error("L'adresse du medecin traitant est requise.");
      profiles[session.walletAddress] = {
        ...(profiles[session.walletAddress] || {}),
        primaryDoctorWallet: String(body.doctorWallet).trim()
      };
    }
    
    saveProfiles(profiles);
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
    if (!isPrescriptionAnchor(sourceAnchor) || sourceAnchor.ownerWallet !== session.walletAddress) {
      throw new Error("Acces refuse a cette ordonnance.");
    }

    const normalizedStatus = String(sourceAnchor.status || "").toUpperCase();
    if (normalizedStatus !== "DELIVERED" && normalizedStatus !== "USED") {
      throw new Error("L'ordonnance doit etre utilisee avant reclamation assurance.");
    }

    const claimId = `CLM-${recordId}`;
    const overrides = loadClaimOverrides();
    const previous = overrides[claimId] || {};
    let amountRequested = Number(previous.amountRequested || 0);
    if (amountRequested <= 0) {
      amountRequested = await readDeliveredPrescriptionAmount(recordId);
    }
    
    if (previous.status && previous.status !== "PENDING") {
      throw new Error(`Cette reclamation a deja ete traitee (Statut: ${previous.status})`);
    }

    overrides[claimId] = {
      ...previous,
      requested: true,
      status: "PENDING",
      sourceType: "PRESCRIPTION",
      sourceId: recordId,
      patientWallet: sourceAnchor.ownerWallet,
      providerWallet: sourceAnchor.doctorWallet,
      providerRole: "MEDECIN",
      amountRequested,
      createdAt: sourceAnchor.createdAt || new Date().toISOString(),
      verification: {
        anchorValid: true,
        anchorStatus: sourceAnchor.status,
        method: "RUST_ANCHOR",
      },
    };
    saveClaimOverrides(overrides);
    
    return { ok: true } as T;
  }

  if (pathname.match(/^\/claims\/events\/[^/]+$/) && method === "POST") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["PATIENT"]);

    const eventId = pathname.split("/")[3];
    const anchor = await getAnchor(eventId);
    if (!String(anchor.recordId || "").toLowerCase().startsWith("event:")) {
      throw new Error("Cette source n'est pas un evenement medical.");
    }
    if (normalizeWallet(anchor.ownerWallet) !== normalizeWallet(session.walletAddress)) {
      throw new Error("Acces refuse a cet evenement.");
    }

    let amountRequested = 0;
    let sourceType: "VISIT" | "OPERATION" | "LAB_TEST" = "OPERATION";
    let providerRole = "HOPITAL";

    const cid = String(anchor.cid || "").trim();
    if (cid && !cid.startsWith("pending:") && !cid.startsWith("pending-file:")) {
      try {
        const payload = await downloadJsonFromIpfs<Record<string, unknown>>(cid);
        amountRequested = positiveAmount(payload.amountClaim);
        const eventType = normalizeMedicalEventType(payload.eventType);
        const eventDomainRaw = String(payload.eventDomain || "").trim().toUpperCase();
        const eventDomain = ["VISIT", "LAB_RESULT", "MEDICAL_ACT"].includes(eventDomainRaw)
          ? eventDomainRaw
          : deriveMedicalEventDomain(eventType);

        if (eventDomain === "VISIT") {
          sourceType = "VISIT";
          providerRole = "MEDECIN";
        } else if (eventDomain === "LAB_RESULT") {
          sourceType = "LAB_TEST";
          providerRole = "LABO";
        } else {
          sourceType = "OPERATION";
          providerRole = "HOPITAL";
        }
      } catch {
        amountRequested = 0;
      }
    }

    if (amountRequested <= 0) {
      throw new Error("Cet evenement ne contient pas de montant remboursable.");
    }

    const claimId = `CLM-${eventId}`;
    const overrides = loadClaimOverrides();
    const previous = overrides[claimId] || {};
    if (previous.status && previous.status !== "PENDING") {
      throw new Error(`Cette reclamation a deja ete traitee (Statut: ${previous.status})`);
    }

    overrides[claimId] = {
      ...previous,
      requested: true,
      status: "PENDING",
      sourceType,
      sourceId: eventId,
      patientWallet: anchor.ownerWallet,
      providerWallet: anchor.doctorWallet,
      providerRole,
      amountRequested,
      createdAt: anchor.createdAt || new Date().toISOString(),
      verification: {
        anchorValid: true,
        anchorStatus: anchor.status,
        method: "RUST_ANCHOR",
      },
    };
    saveClaimOverrides(overrides);

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

    const overrides = loadClaimOverrides();
    overrides[claimId] = {
      ...(overrides[claimId] || {}),
      status: body.decision,
      amountApproved: body.amountApproved,
      reason: body.reason
    };
    saveClaimOverrides(overrides);

    return { ok: true } as T;
  }

  if (pathname.match(/^\/claims\/[^/]+\/reimburse$/) && method === "POST") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["ASSURANCE"]);

    const claimId = pathname.split("/")[2];
    const overrides = loadClaimOverrides();
    const previous = overrides[claimId] || {};
    if (previous.status !== "APPROVED") {
      throw new Error("Le claim doit etre approuve avant remboursement.");
    }

    const paymentReference = `PAY-${Date.now()}`;
    overrides[claimId] = {
      ...previous,
      status: "REIMBURSED",
      paymentReference,
      reimbursedAt: new Date().toISOString()
    };
    saveClaimOverrides(overrides);

    return { paymentReference } as T;
  }

  if (pathname === "/auth/relink-doctor" && method === "PATCH") {
    if (!session) throw new Error("Session requise");
    requireRole(session, ["PATIENT"]);
    const doctorWallet = ((options.body || {}) as { doctorWallet?: string }).doctorWallet?.trim();
    if (!doctorWallet) {
      throw new Error("doctorWallet est obligatoire");
    }

    const profiles = loadProfiles();
    profiles[session.walletAddress] = {
      ...(profiles[session.walletAddress] || {}),
      primaryDoctorWallet: doctorWallet
    };
    saveProfiles(profiles);

    saveSession({
      ...session,
      identity: {
        ...(session.identity || {
          role: session.role,
          fullName: session.walletAddress,
          nickname: "wallet",
          dateOfBirth: "1990-01-01"
        }),
        primaryDoctorWallet: doctorWallet
      }
    });

    return { ok: true } as T;
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
      schema: "msce-medical-event-v1",
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

    const uploaded = await uploadJsonToIpfs(eventPayload, `medical-visit-${Date.now()}.json`);

    const recordId = `event:${crypto.randomUUID()}`;
    const hash = await bodyDigest(eventPayload);

    await blockchainRequest<{ anchor: AnchorItem }>("/anchors/store", {
      method: "POST",
      body: JSON.stringify({
        recordId,
        hash,
        cid: uploaded.cid,
        ownerWallet: patientWallet,
        doctorWallet: session.walletAddress,
        authorizedWallets: [session.walletAddress, patientWallet],
        timestamp: Math.floor(Date.now() / 1000),
      }),
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
    };

    const patientWallet = normalizeWallet(body.patientWallet);
    if (!patientWallet) {
      throw new Error("patientWallet est obligatoire");
    }

    const createdAt = new Date().toISOString();
    const normalizedEventType = normalizeMedicalEventType(body.eventType || "INTERVENTION");
    const eventDomain = deriveMedicalEventDomain(normalizedEventType);

    if (eventDomain === "VISIT") {
      throw new Error("Utilisez /medical-events/visit pour les visites medicales (consultations).");
    }

    if (eventDomain === "LAB_RESULT") {
      throw new Error("Utilisez /labo/results pour les resultats laboratoire.");
    }

    const sourceDocumentCid = asNonEmptyText(body.documentCid);

    const eventPayload = {
      schema: "msce-medical-event-v1",
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

    const uploaded = await uploadJsonToIpfs(eventPayload, `medical-event-${normalizedEventType.toLowerCase()}-${Date.now()}.json`);

    const recordId = `event:${crypto.randomUUID()}`;
    const hash = await bodyDigest(eventPayload);
    const cid = uploaded.cid;

    await blockchainRequest<{ anchor: AnchorItem }>("/anchors/store", {
      method: "POST",
      body: JSON.stringify({
        recordId,
        hash,
        cid,
        ownerWallet: patientWallet,
        doctorWallet: session.walletAddress,
        authorizedWallets: [session.walletAddress, patientWallet],
        timestamp: Math.floor(Date.now() / 1000)
      })
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
      schema: "msce-medical-event-v1",
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

    const uploaded = await uploadJsonToIpfs(eventPayload, `labo-result-${Date.now()}.json`);
    const recordId = `event:${crypto.randomUUID()}`;
    const hash = await bodyDigest(eventPayload);

    await blockchainRequest<{ anchor: AnchorItem }>("/anchors/store", {
      method: "POST",
      body: JSON.stringify({
        recordId,
        hash,
        cid: uploaded.cid,
        ownerWallet: patientWallet,
        doctorWallet: session.walletAddress,
        authorizedWallets: [session.walletAddress, patientWallet],
        timestamp: Math.floor(Date.now() / 1000),
      }),
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
      // Include governance records.
      if (
        anchor.recordId.startsWith("mongo:walletroles:") ||
        anchor.recordId.startsWith("mongo:walletidentities:") ||
        anchor.recordId.startsWith("mongo:users:")
      ) {
        addWallet(anchor.ownerWallet);
      }

      // Include all actors seen in medical/prescription anchors.
      addWallet(anchor.ownerWallet);
      addWallet(anchor.doctorWallet);
      addWallet(anchor.pharmacyWallet || null);
      for (const wallet of anchor.authorizedWallets || []) {
        addWallet(wallet);
      }
    }

    addWallet(session.walletAddress);

    const sessionRegion = getSessionRegion(session);
    const users: AdminListItem[] = [];

    const inferRoleFromAnchors = (walletAddress: string): string => {
      if (anchors.some((item) => item.pharmacyWallet === walletAddress)) return "PHARMACIE";
      if (anchors.some((item) => item.doctorWallet === walletAddress)) return "MEDECIN";
      if (anchors.some((item) => item.ownerWallet === walletAddress)) return "PATIENT";
      return "PATIENT";
    };

    for (const walletAddress of Array.from(roleWallets.values())) {
      try {
        const roleRes = await fetch(`/api/role/resolve/${encodeURIComponent(walletAddress)}?nocache=true`, { cache: "no-store" });
        if (!roleRes.ok) continue;
        const resolved = (await roleRes.json()) as {
          role?: string | null;
          region?: string | null;
          isGlobalAdmin?: boolean;
        };

        const role = normalizeRole(String(resolved.role || "")) || inferRoleFromAnchors(walletAddress);

        const region = String(resolved.region || "").trim() || null;
        if (!session.identity?.isGlobalAdmin && sessionRegion && region && region !== sessionRegion) {
          continue;
        }

        users.push({
          walletAddress,
          roles: [role],
          identity: {
            role,
            fullName: walletAddress === session.walletAddress ? "Local User" : "Utilisateur Wallet",
            nickname: "wallet-user",
            dateOfBirth: "1990-01-01",
            region,
            isGlobalAdmin: Boolean(resolved.isGlobalAdmin),
            approvalStatus: role === "MEDECIN" ? "PENDING" : "APPROVED",
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

  throw new Error(`Route non supportee sans backend Node: ${method} ${pathname}`);
}
