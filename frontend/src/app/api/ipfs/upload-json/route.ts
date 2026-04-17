import { NextResponse } from "next/server";

type UploadResult = {
  cid: string;
  size: number;
};

const DEFAULT_IPFS_API = "http://127.0.0.1:5001/api/v0";

function getIpfsApiBase(): string {
  return (process.env.NEXT_PUBLIC_IPFS_API_URL || DEFAULT_IPFS_API).replace(/\/$/, "");
}

function buildAuthHeaders(): Record<string, string> {
  const token = process.env.IPFS_API_TOKEN || process.env.NEXT_PUBLIC_IPFS_API_TOKEN || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isPinataApi(base: string): boolean {
  return base.toLowerCase().includes("pinata.cloud");
}

function extractCid(raw: string): UploadResult {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new Error("Empty IPFS response.");
  }

  const last = JSON.parse(lines[lines.length - 1]) as { Hash?: string; Size?: string };
  if (!last.Hash) {
    throw new Error("IPFS did not return a CID.");
  }

  return {
    cid: last.Hash,
    size: Number(last.Size || 0),
  };
}

function extractPinataCid(raw: string): UploadResult {
  const parsed = JSON.parse(raw) as { IpfsHash?: string; PinSize?: number };
  if (!parsed.IpfsHash) {
    throw new Error("Pinata did not return an IpfsHash.");
  }

  return {
    cid: parsed.IpfsHash,
    size: Number(parsed.PinSize || 0),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { payload?: unknown; fileName?: string };
    const payload = body.payload;
    const fileName = String(body.fileName || "medical-record.json");

    if (payload === undefined) {
      return NextResponse.json({ error: "payload is required" }, { status: 400 });
    }

    const apiBase = getIpfsApiBase();

    if (isPinataApi(apiBase)) {
      const response = await fetch(`${apiBase}/pinJSONToIPFS`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...buildAuthHeaders(),
        },
        body: JSON.stringify({
          pinataContent: payload,
          pinataMetadata: {
            name: fileName,
          },
        }),
      });

      const raw = await response.text();
      if (!response.ok) {
        return NextResponse.json({ error: `Pinata upload failed (${response.status}): ${raw}` }, { status: 502 });
      }

      return NextResponse.json(extractPinataCid(raw));
    }

    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const formData = new FormData();
    formData.append("file", blob, fileName);

    const response = await fetch(`${apiBase}/add?pin=true&cid-version=1`, {
      method: "POST",
      headers: buildAuthHeaders(),
      body: formData,
    });

    const raw = await response.text();
    if (!response.ok) {
      return NextResponse.json({ error: `IPFS upload failed (${response.status}): ${raw}` }, { status: 502 });
    }

    return NextResponse.json(extractCid(raw));
  } catch (error) {
    const message = error instanceof Error ? error.message : "IPFS upload error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
