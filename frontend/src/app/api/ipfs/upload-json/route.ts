import { NextResponse } from "next/server";

type UploadResult = {
  cid: string;
  size: number;
};

const DEFAULT_IPFS_API = "http://127.0.0.1:5001/api/v0";
const UPLOAD_RATE_LIMIT_MAX_RETRIES = 4;
const UPLOAD_RATE_LIMIT_BASE_DELAY_MS = 1200;

function getIpfsApiBase(): string {
  return (
    process.env.IPFS_API_URL ||
    process.env.NEXT_PUBLIC_IPFS_API_URL ||
    DEFAULT_IPFS_API
  ).replace(/\/$/, "");
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

function asErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || "unknown error");
}

function isRateLimitMessage(input: string): boolean {
  const message = String(input || "").toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("429")
  );
}

function isRateLimitError(error: unknown): boolean {
  return isRateLimitMessage(asErrorMessage(error));
}

async function wait(ms: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withUploadRetry<T>(operation: string, action: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= UPLOAD_RATE_LIMIT_MAX_RETRIES; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === UPLOAD_RATE_LIMIT_MAX_RETRIES) {
        throw error;
      }

      const delay = UPLOAD_RATE_LIMIT_BASE_DELAY_MS * (attempt + 1);
      console.warn(
        `[MSC] ${operation} rate-limited; retrying in ${delay}ms (${attempt + 1}/${UPLOAD_RATE_LIMIT_MAX_RETRIES})`
      );
      await wait(delay);
    }
  }

  throw lastError;
}

async function pinataUpload(apiBase: string, payload: unknown, fileName: string): Promise<UploadResult> {
  return withUploadRetry("proxy-pinata-upload", async () => {
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
      if (response.status === 429 || isRateLimitMessage(raw)) {
        throw new Error(`Pinata upload rate-limited (${response.status}): ${raw}`);
      }
      throw new Error(`Pinata upload failed (${response.status}): ${raw}`);
    }

    return extractPinataCid(raw);
  });
}

async function ipfsUpload(apiBase: string, payload: unknown, fileName: string): Promise<UploadResult> {
  return withUploadRetry("proxy-ipfs-upload", async () => {
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
      if (response.status === 429 || isRateLimitMessage(raw)) {
        throw new Error(`IPFS upload rate-limited (${response.status}): ${raw}`);
      }
      throw new Error(`IPFS upload failed (${response.status}): ${raw}`);
    }

    return extractCid(raw);
  });
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
      const uploaded = await pinataUpload(apiBase, payload, fileName);
      return NextResponse.json(uploaded);
    }

    const uploaded = await ipfsUpload(apiBase, payload, fileName);
    return NextResponse.json(uploaded);
  } catch (error) {
    const message = error instanceof Error ? error.message : "IPFS upload proxy error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
