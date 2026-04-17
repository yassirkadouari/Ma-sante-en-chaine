import { NextResponse } from "next/server";

type AnchorItem = {
  recordId: string;
  ownerWallet: string;
  doctorWallet: string;
  pharmacyWallet?: string | null;
  cid: string;
  createdAt?: string;
  updatedAt?: string;
};

const ROLE_CACHE_TTL_MS = 2 * 60 * 1000;
const roleCache = new Map<string, { role: string | null; source: string; expiresAt: number; region?: string | null; isGlobalAdmin?: boolean }>();

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

function normalizeRole(value: string) {
  const v = value.trim().toUpperCase();
  if (v === "DOCTOR" || v === "MEDECIN" || v === "MEDECIN_TRAITANT") return "MEDECIN";
  if (v === "PATIENT") return "PATIENT";
  if (v === "PHARMACY" || v === "PHARMACIE" || v === "PHARMACIEN") return "PHARMACIE";
  if (v === "HOSPITAL" || v === "HOPITAL" || v === "HOSPITALIER") return "HOPITAL";
  if (v === "INSURANCE" || v === "ASSURANCE" || v === "ASSUREUR") return "ASSURANCE";
  if (v === "LAB" || v === "LABO" || v === "LABORATOIRE") return "LABO";
  if (v === "ADMIN" || v === "SUPER_ADMIN" || v === "SUB_ADMIN") return "ADMIN";
  return "";
}

function readNested(source: Record<string, unknown>, key: string): unknown {
  const [head, tail] = key.split(".", 2);
  if (!tail) return source[head];
  const nested = source[head];
  if (!nested || typeof nested !== "object") return undefined;
  return (nested as Record<string, unknown>)[tail];
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
    .map((key) => String(readNested(document, key) || "").trim())
    .filter(Boolean);

  return Array.from(new Set(wallets));
}

function extractRoleCandidates(document: Record<string, unknown>): string[] {
  const keys = [
    "role",
    "requestedRole",
    "identity.role",
    "profile.role",
    "actorRole",
    "providerRole",
  ];

  return keys
    .map((key) => String(readNested(document, key) || "").trim())
    .filter(Boolean);
}

function anchorTime(item: AnchorItem): number {
  return Date.parse(item.updatedAt || item.createdAt || "1970-01-01T00:00:00Z");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ wallet: string }> }
) {
  const { wallet } = await params;
  const targetWallet = String(wallet || "").trim();
  const url = new URL(request.url);
  const nocache = url.searchParams.get("nocache") === "true";

  const forcedAdmins = String(process.env.NEXT_PUBLIC_ADMIN_WALLETS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (forcedAdmins.includes(targetWallet)) {
    return NextResponse.json({
      wallet: targetWallet,
      role: "ADMIN",
      anchorsCount: 0,
      source: "forced-admin-wallet",
      region: null,
      isGlobalAdmin: true,
    });
  }

  const now = Date.now();
  const cached = roleCache.get(targetWallet);
  if (!nocache && cached && cached.expiresAt > now) {
    if (cached.source.startsWith("fallback")) {
      roleCache.delete(targetWallet);
    } else {
    return NextResponse.json({
      wallet: targetWallet,
      role: cached.role,
      anchorsCount: 0,
      source: `${cached.source}:cache`,
      region: cached.region ?? null,
      isGlobalAdmin: cached.isGlobalAdmin,
    });
    }
  }

  const blockchainApi = (process.env.NEXT_PUBLIC_BLOCKCHAIN_API_URL || "http://localhost:4600").replace(/\/$/, "");
  const gatewayBase = (process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs").replace(/\/$/, "");

  try {
    const anchorsRes = await fetchWithTimeout(`${blockchainApi}/anchors`, 3500);
    if (!anchorsRes.ok) {
      return NextResponse.json({ wallet: targetWallet, role: null, anchorsCount: 0 }, { status: 200 });
    }

    const anchorsPayload = (await anchorsRes.json()) as { items?: AnchorItem[] };
    const anchors = anchorsPayload.items || [];

    // Authoritative source for current role: latest walletroles record for this wallet.
    const walletRoleAnchors = anchors
      .filter(
        (item) =>
          item.recordId.startsWith("mongo:walletroles:") &&
          item.ownerWallet === targetWallet &&
          item.cid &&
          !item.cid.startsWith("pending:")
      )
      .sort((a, b) => anchorTime(b) - anchorTime(a))
      .slice(0, 12);

    const hasWalletRoleAnchors = walletRoleAnchors.length > 0;

    for (const anchor of walletRoleAnchors) {
      let document: Record<string, unknown> | null = null;
      try {
        const roleRes = await fetchWithTimeout(`${gatewayBase}/${anchor.cid}`, 1400);
        if (roleRes.ok) {
          const wrapped = (await roleRes.json()) as { document?: Record<string, unknown> };
          document = wrapped.document || (wrapped as Record<string, unknown>);
        }
      } catch {
        // IPFS Timeout or network error
      }

      if (document) {
        const wallets = extractWalletCandidates(document);
        if (!wallets.includes(targetWallet) && anchor.ownerWallet !== targetWallet) {
          continue;
        }

        const revoked = Boolean(document.revoked);
        if (revoked) {
          roleCache.set(targetWallet, {
            role: null,
            source: `${anchor.recordId}:revoked`,
            expiresAt: Date.now() + 5000,
            region: null,
            isGlobalAdmin: false,
          });
          return NextResponse.json({
            wallet: targetWallet,
            role: null,
            anchorsCount: anchors.length,
            source: `${anchor.recordId}:revoked`,
          });
        }

        for (const candidate of extractRoleCandidates(document)) {
          const normalized = normalizeRole(candidate);
          if (normalized) {
            const region = String(readNested(document, "region") || "").trim() || null;
            const isGlobalAdmin = Boolean(readNested(document, "isGlobalAdmin"));
            roleCache.set(targetWallet, {
              role: normalized,
              source: `${anchor.recordId}${isGlobalAdmin ? ":global" : ""}`,
              expiresAt: Date.now() + ROLE_CACHE_TTL_MS,
              region,
              isGlobalAdmin,
            });
            return NextResponse.json({
              wallet: targetWallet,
              role: normalized,
              anchorsCount: anchors.length,
              source: anchor.recordId,
              region,
              isGlobalAdmin,
            });
          }
        }
      } else {
        // Fallback: Predict role from anchor.recordId to avoid being blocked by IPFS latency.
        // recordId format: mongo:walletroles:<wallet>:<ts>:<role>[:ACTIVE|REVOKED][:GLOBAL]
        const parts = anchor.recordId.split(":");
        if (parts.length >= 5) {
          const roleRaw = parts[4];
          const isRevoked = parts.length >= 6 && parts[5] === "REVOKED";
          const isGlobalAdmin = parts.length >= 7 && parts[6] === "GLOBAL";
          const candidateRole = normalizeRole(roleRaw);

          if (isRevoked) {
            roleCache.set(targetWallet, {
              role: null,
              source: `${anchor.recordId}:fallback-revoked`,
              expiresAt: Date.now() + 5000,
              region: null,
              isGlobalAdmin: false,
            });
            return NextResponse.json({
              wallet: targetWallet,
              role: null,
              anchorsCount: anchors.length,
              source: `${anchor.recordId}:fallback-revoked`,
            });
          }

          if (candidateRole) {
            roleCache.set(targetWallet, {
              role: candidateRole,
              source: `${anchor.recordId}:fallback`,
              expiresAt: Date.now() + 15000, // Shorter cache since region cannot be reliably known
              region: null,
              isGlobalAdmin,
            });
            return NextResponse.json({
              wallet: targetWallet,
              role: candidateRole,
              anchorsCount: anchors.length,
              source: `${anchor.recordId}:fallback`,
              region: null,
              isGlobalAdmin,
            });
          }
        }
      }
      }

    if (hasWalletRoleAnchors) {
      roleCache.set(targetWallet, {
        role: null,
        source: "role-anchor-unresolved",
        expiresAt: Date.now() + 3000,
        region: null,
        isGlobalAdmin: false,
      });
      return NextResponse.json({
        wallet: targetWallet,
        role: null,
        anchorsCount: anchors.length,
        source: "role-anchor-unresolved",
      });
    }

    // Backward-compatibility for old migrations without walletroles records.
    const identityAnchors = anchors
      .filter(
        (item) =>
          (item.recordId.startsWith("mongo:walletidentities:") || item.recordId.startsWith("mongo:users:")) &&
          item.ownerWallet === targetWallet &&
          item.cid &&
          !item.cid.startsWith("pending:")
      )
      .sort((a, b) => anchorTime(b) - anchorTime(a))
      .slice(0, 8);

    for (const anchor of identityAnchors) {
      try {
        const roleRes = await fetchWithTimeout(`${gatewayBase}/${anchor.cid}`, 1400);
        if (!roleRes.ok) continue;

        const wrapped = (await roleRes.json()) as { document?: Record<string, unknown> };
        const document = wrapped.document || (wrapped as Record<string, unknown>);
        const revoked = Boolean(document.revoked);
        if (revoked) continue;

        const wallets = extractWalletCandidates(document);
        if (!wallets.includes(targetWallet) && anchor.ownerWallet !== targetWallet) continue;

        for (const candidate of extractRoleCandidates(document)) {
          const normalized = normalizeRole(candidate);
          if (normalized) {
            const region = String(readNested(document, "region") || "").trim() || null;
            const isGlobalAdmin = Boolean(readNested(document, "isGlobalAdmin"));
            roleCache.set(targetWallet, {
              role: normalized,
              source: `${anchor.recordId}${isGlobalAdmin ? ":global" : ""}`,
              expiresAt: Date.now() + ROLE_CACHE_TTL_MS,
              region,
              isGlobalAdmin,
            });
            return NextResponse.json({
              wallet: targetWallet,
              role: normalized,
              anchorsCount: anchors.length,
              source: anchor.recordId,
              region,
              isGlobalAdmin,
            });
          }
        }
      } catch {
        // Continue to fallback if an old identity document cannot be read.
      }
    }

    const appearsAsOwner = anchors.some((item) => item.ownerWallet === targetWallet);
    const appearsAsDoctor = anchors.some((item) => item.doctorWallet === targetWallet);
    const appearsAsPharmacy = anchors.some((item) => item.pharmacyWallet === targetWallet);

    // If a wallet appears in multiple positions and has no role anchor,
    // prefer PATIENT to avoid unintentionally forcing practitioner dashboards.
    if (appearsAsOwner) {
      roleCache.set(targetWallet, { role: "PATIENT", source: appearsAsDoctor ? "fallback-owner+doctor" : "fallback-owner", expiresAt: Date.now() + 5000, region: null, isGlobalAdmin: false });
      return NextResponse.json({ wallet: targetWallet, role: "PATIENT", anchorsCount: anchors.length, source: appearsAsDoctor ? "fallback-owner+doctor" : "fallback-owner" });
    }
    if (appearsAsPharmacy) {
      roleCache.set(targetWallet, { role: "PHARMACIE", source: "fallback-pharmacy", expiresAt: Date.now() + 5000, region: null, isGlobalAdmin: false });
      return NextResponse.json({ wallet: targetWallet, role: "PHARMACIE", anchorsCount: anchors.length, source: "fallback-pharmacy" });
    }
    if (appearsAsDoctor) {
      roleCache.set(targetWallet, { role: "MEDECIN", source: "fallback-doctor", expiresAt: Date.now() + 5000, region: null, isGlobalAdmin: false });
      return NextResponse.json({ wallet: targetWallet, role: "MEDECIN", anchorsCount: anchors.length, source: "fallback-doctor" });
    }

    roleCache.set(targetWallet, { role: null, source: "none", expiresAt: Date.now() + 5000, region: null, isGlobalAdmin: false });
    return NextResponse.json({ wallet: targetWallet, role: null, anchorsCount: anchors.length });
  } catch {
    return NextResponse.json({ wallet: targetWallet, role: null, anchorsCount: 0 }, { status: 200 });
  }
}
