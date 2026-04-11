type UploadResult = {
  cid: string;
  size: number;
};

const DEFAULT_IPFS_API = "http://127.0.0.1:5001/api/v0";
const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs";
const DEFAULT_PINATA_API = "https://api.pinata.cloud/pinning";
const DEFAULT_PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";

function getIpfsApiBase(): string {
  return (process.env.NEXT_PUBLIC_IPFS_API_URL || DEFAULT_IPFS_API).replace(/\/$/, "");
}

function getIpfsGatewayBase(): string {
  const configured = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  if (isPinataApi()) {
    return DEFAULT_PINATA_GATEWAY;
  }

  return DEFAULT_IPFS_GATEWAY;
}

function isPinataApi(): boolean {
  const base = getIpfsApiBase().toLowerCase();
  return base.includes("pinata.cloud");
}

function buildHeaders(): Record<string, string> {
  const token = process.env.NEXT_PUBLIC_IPFS_API_TOKEN;
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
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
  const parsed = JSON.parse(raw) as { IpfsHash?: string; PinSize?: number; error?: unknown };
  if (!parsed.IpfsHash) {
    throw new Error("Pinata did not return an IpfsHash.");
  }

  return {
    cid: parsed.IpfsHash,
    size: Number(parsed.PinSize || 0),
  };
}

export function getGatewayUrl(cid: string): string {
  if (!cid || !cid.trim()) {
    throw new Error("CID is required.");
  }
  return `${getIpfsGatewayBase()}/${cid}`;
}

export async function uploadJsonToIpfs(payload: unknown, fileName = "medical-record.json"): Promise<UploadResult> {
  if (isPinataApi()) {
    const response = await fetch(`${getIpfsApiBase()}/pinJSONToIPFS`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...buildHeaders(),
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
      throw new Error(`Pinata upload failed (${response.status}): ${raw}`);
    }

    return extractPinataCid(raw);
  }

  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const formData = new FormData();
  formData.append("file", blob, fileName);

  const response = await fetch(`${getIpfsApiBase()}/add?pin=true&cid-version=1`, {
    method: "POST",
    headers: buildHeaders(),
    body: formData,
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`IPFS upload failed (${response.status}): ${raw}`);
  }

  return extractCid(raw);
}

export async function downloadJsonFromIpfs<T>(cid: string): Promise<T> {
  const response = await fetch(getGatewayUrl(cid));
  if (!response.ok) {
    throw new Error(`IPFS read failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

export async function downloadTextFromIpfs(cid: string): Promise<string> {
  const response = await fetch(getGatewayUrl(cid));
  if (!response.ok) {
    throw new Error(`IPFS read failed (${response.status}).`);
  }
  return await response.text();
}
