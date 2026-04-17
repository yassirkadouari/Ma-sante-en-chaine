import { NextResponse } from "next/server";

type AnchorItem = {
  recordId: string;
  ownerWallet: string;
  cid: string;
  createdAt?: string;
  updatedAt?: string;
};

type ResolvedIdentity = {
  fullName: string | null;
  cabinetName: string | null;
  institutionName: string | null;
  departmentName: string | null;
};

const EMPTY_IDENTITY: ResolvedIdentity = {
  fullName: null,
  cabinetName: null,
  institutionName: null,
  departmentName: null,
};

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const token = process.env.NEXT_PUBLIC_IPFS_API_TOKEN || "";
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal, headers });
  } finally {
    clearTimeout(timeout);
  }
}

function readNested(source: Record<string, unknown>, key: string): unknown {
  const [head, tail] = key.split(".", 2);
  if (!tail) return source[head];
  const nested = source[head];
  if (!nested || typeof nested !== "object") return undefined;
  return (nested as Record<string, unknown>)[tail];
}

function asText(value: unknown): string | null {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeWallet(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function firstTextCandidate(document: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = asText(readNested(document, key));
    if (value) return value;
  }
  return null;
}

function extractWalletCandidates(document: Record<string, unknown>): string[] {
  const keys = [
    "walletAddress",
    "wallet",
    "ownerWallet",
    "doctorWallet",
    "pharmacyWallet",
    "providerWallet",
    "identity.walletAddress",
    "identity.wallet",
    "profile.walletAddress",
  ];

  const wallets = keys
    .map((key) => asText(readNested(document, key)))
    .filter(Boolean) as string[];

  return Array.from(new Set(wallets));
}

function extractIdentity(document: Record<string, unknown>): ResolvedIdentity {
  const explicitFullName = firstTextCandidate(document, [
    "fullName",
    "identity.fullName",
    "profile.fullName",
    "patient.fullName",
    "doctor.fullName",
    "nomComplet",
    "displayName",
    "name",
    "nickname",
  ]);

  const firstName = firstTextCandidate(document, [
    "firstName",
    "prenom",
    "identity.firstName",
    "profile.firstName",
    "givenName",
  ]);
  const lastName = firstTextCandidate(document, [
    "lastName",
    "nom",
    "identity.lastName",
    "profile.lastName",
    "familyName",
  ]);
  const derivedFullName = [firstName, lastName].filter(Boolean).join(" ").trim() || null;

  return {
    fullName: explicitFullName || derivedFullName,
    cabinetName: firstTextCandidate(document, [
      "cabinetName",
      "identity.cabinetName",
      "profile.cabinetName",
      "doctor.cabinetName",
      "medicalOfficeName",
      "clinicName",
      "cabinet",
    ]),
    institutionName: firstTextCandidate(document, [
      "institutionName",
      "identity.institutionName",
      "profile.institutionName",
      "hospitalName",
      "etablissement",
      "organizationName",
    ]),
    departmentName: firstTextCandidate(document, [
      "departmentName",
      "identity.departmentName",
      "profile.departmentName",
      "department",
      "speciality",
      "specialty",
    ]),
  };
}

function mergeIdentity(base: ResolvedIdentity, patch: ResolvedIdentity): ResolvedIdentity {
  return {
    fullName: base.fullName || patch.fullName,
    cabinetName: base.cabinetName || patch.cabinetName,
    institutionName: base.institutionName || patch.institutionName,
    departmentName: base.departmentName || patch.departmentName,
  };
}

function anchorTime(item: AnchorItem): number {
  return Date.parse(item.updatedAt || item.createdAt || "1970-01-01T00:00:00Z");
}

function isIdentityAnchor(recordId: string): boolean {
  return (
    recordId.startsWith("mongo:walletidentities:") ||
    recordId.startsWith("mongo:users:") ||
    recordId.startsWith("mongo:walletroles:")
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ wallet: string }> }
) {
  const { wallet } = await params;
  const targetWallet = asText(wallet);
  const targetWalletNormalized = normalizeWallet(targetWallet);

  if (!targetWallet) {
    return NextResponse.json({ error: "wallet invalide" }, { status: 400 });
  }

  const blockchainApi = (process.env.NEXT_PUBLIC_BLOCKCHAIN_API_URL || "http://localhost:4600").replace(/\/$/, "");
  const gatewayBase = (process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs").replace(/\/$/, "");

  try {
    const anchorsRes = await fetchWithTimeout(`${blockchainApi}/anchors`, 3500);
    if (!anchorsRes.ok) {
      return NextResponse.json({ wallet: targetWallet, ...EMPTY_IDENTITY, source: "anchors-unavailable" }, { status: 200 });
    }

    const anchorsPayload = (await anchorsRes.json()) as { items?: AnchorItem[] };
    const anchors = (anchorsPayload.items || [])
      .filter(
        (item) =>
          (normalizeWallet(item.ownerWallet) === targetWalletNormalized ||
            String(item.recordId || "").toLowerCase().includes(targetWalletNormalized)) &&
          item.cid &&
          !item.cid.startsWith("pending:") &&
          isIdentityAnchor(item.recordId)
      )
      .sort((a, b) => anchorTime(b) - anchorTime(a))
      .slice(0, 16);

    let resolved = { ...EMPTY_IDENTITY };

    for (const anchor of anchors) {
      try {
        const docRes = await fetchWithTimeout(`${gatewayBase}/${anchor.cid}`, 1400);
        if (!docRes.ok) continue;

        const wrapped = (await docRes.json()) as { document?: Record<string, unknown> };
        const document = wrapped.document || (wrapped as Record<string, unknown>);

        const wallets = extractWalletCandidates(document);
        const normalizedWallets = new Set(wallets.map((value) => normalizeWallet(value)));
        if (!normalizedWallets.has(targetWalletNormalized) && normalizeWallet(anchor.ownerWallet) !== targetWalletNormalized) {
          continue;
        }

        resolved = mergeIdentity(resolved, extractIdentity(document));

        if (resolved.fullName && (resolved.cabinetName || resolved.institutionName || resolved.departmentName)) {
          break;
        }
      } catch {
        // Ignore unreadable identity records and continue.
      }
    }

    return NextResponse.json({
      wallet: targetWallet,
      ...resolved,
      source: anchors[0]?.recordId || "none",
    });
  } catch {
    return NextResponse.json({ wallet: targetWallet, ...EMPTY_IDENTITY, source: "error" }, { status: 200 });
  }
}
