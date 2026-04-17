import { NextResponse } from "next/server";

const DEFAULT_IPFS_API = "http://127.0.0.1:5001/api/v0";
const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs";
const DEFAULT_PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";

function getIpfsApiBase(): string {
  return (
    process.env.IPFS_API_URL ||
    process.env.NEXT_PUBLIC_IPFS_API_URL ||
    DEFAULT_IPFS_API
  ).replace(/\/$/, "");
}

function isPinataApi(base: string): boolean {
  return base.toLowerCase().includes("pinata.cloud");
}

function getIpfsGatewayBase(apiBase: string): string {
  const configured = process.env.IPFS_GATEWAY_URL || process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  if (isPinataApi(apiBase)) {
    return DEFAULT_PINATA_GATEWAY;
  }

  return DEFAULT_IPFS_GATEWAY;
}

function buildAuthHeaders(): Record<string, string> {
  const token = process.env.IPFS_API_TOKEN || process.env.NEXT_PUBLIC_IPFS_API_TOKEN || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readFromIpfsApiCat(apiBase: string, cid: string): Promise<unknown> {
  const response = await fetch(`${apiBase}/cat?arg=${encodeURIComponent(cid)}`, {
    method: "POST",
    headers: buildAuthHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`IPFS API cat failed (${response.status}).`);
  }

  const text = await response.text();
  return JSON.parse(text);
}

async function readFromGateway(gatewayBase: string, cid: string): Promise<unknown> {
  const response = await fetch(`${gatewayBase}/${cid}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`IPFS gateway read failed (${response.status}).`);
  }

  return await response.json();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { cid?: string };
    const cid = String(body.cid || "").trim();
    if (!cid) {
      return NextResponse.json({ error: "cid is required" }, { status: 400 });
    }

    const apiBase = getIpfsApiBase();
    const gatewayBase = getIpfsGatewayBase(apiBase);

    // Prefer direct read from the configured IPFS API for immediate availability,
    // then fallback to gateway for hosted providers.
    if (!isPinataApi(apiBase)) {
      try {
        const payload = await readFromIpfsApiCat(apiBase, cid);
        return NextResponse.json({ payload, source: "ipfs-api" });
      } catch {
        // Fallback to gateway below.
      }
    }

    const payload = await readFromGateway(gatewayBase, cid);
    return NextResponse.json({ payload, source: "gateway" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "IPFS read error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
