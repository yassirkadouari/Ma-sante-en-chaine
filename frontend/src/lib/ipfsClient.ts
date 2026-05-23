type UploadResult = {
  cid: string;
  size: number;
};

type ProxyUploadPayload = {
  cid?: string;
  size?: number;
  error?: string;
};

type ProxyReadPayload<T> = {
  payload?: T;
  error?: string;
};

const DEFAULT_IPFS_API = "http://127.0.0.1:5001/api/v0";
const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs";
const DEFAULT_PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";
const UPLOAD_RATE_LIMIT_MAX_RETRIES = 0;
const UPLOAD_RATE_LIMIT_BASE_DELAY_MS = 1200;

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

function asErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || "unknown error");
}

function isRateLimitError(error: unknown): boolean {
  const message = asErrorMessage(error).toLowerCase();
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

function networkError(context: string, url: string, error: unknown): Error {
  return new Error(
    `${context} network failure while calling ${url}. ` +
    `Verify endpoint, CORS policy, internet access, and token configuration. ` +
    `${asErrorMessage(error)}`
  );
}

async function uploadViaBrowserProxy(payload: unknown, fileName: string): Promise<UploadResult> {
  const response = await fetch("/api/ipfs/upload-json", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload, fileName }),
  });

  const data = (await response.json().catch(() => ({}))) as ProxyUploadPayload;
  if (!response.ok || !data.cid) {
    throw new Error(data.error || `IPFS browser proxy failed (${response.status}).`);
  }

  return {
    cid: data.cid,
    size: Number(data.size || 0),
  };
}

async function readJsonViaBrowserProxy<T>(cid: string): Promise<T> {
  const response = await fetch("/api/ipfs/read-json", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cid }),
  });

  const payload = (await response.json().catch(() => ({}))) as ProxyReadPayload<T>;
  if (!response.ok || payload.payload === undefined) {
    throw new Error(payload.error || `IPFS browser proxy read failed (${response.status}).`);
  }

  return payload.payload;
}

export function getGatewayUrl(cid: string): string {
  if (!cid || !cid.trim()) {
    throw new Error("CID is required.");
  }
  return `${getIpfsGatewayBase()}/${cid}`;
}

export async function uploadJsonToIpfs(payload: unknown, fileName = "medical-record.json"): Promise<UploadResult> {
  return withUploadRetry("ipfs-upload", async () => {
    if (isPinataApi()) {
      const url = `${getIpfsApiBase()}/pinJSONToIPFS`;
      let response: Response;
      try {
        response = await fetch(url, {
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
      } catch (error) {
        if (typeof window !== "undefined") {
          try {
            return await uploadViaBrowserProxy(payload, fileName);
          } catch (proxyError) {
            throw new Error(
              `${networkError("Pinata upload", url, error).message} ` +
              `Proxy fallback failed: ${asErrorMessage(proxyError)}`
            );
          }
        }
        throw networkError("Pinata upload", url, error);
      }

      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`Pinata upload failed (${response.status}): ${raw}`);
      }

      return extractPinataCid(raw);
    }

    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const formData = new FormData();
    formData.append("file", blob, fileName);

    const url = `${getIpfsApiBase()}/add?pin=true&cid-version=1`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: buildHeaders(),
        body: formData,
      });
    } catch (error) {
      if (typeof window !== "undefined") {
        try {
          return await uploadViaBrowserProxy(payload, fileName);
        } catch (proxyError) {
          throw new Error(
            `${networkError("IPFS upload", url, error).message} ` +
            `Proxy fallback failed: ${asErrorMessage(proxyError)}`
          );
        }
      }
      throw networkError("IPFS upload", url, error);
    }

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`IPFS upload failed (${response.status}): ${raw}`);
    }

    return extractCid(raw);
  });
}

export async function downloadJsonFromIpfs<T>(cid: string): Promise<T> {
  if (cid.startsWith("pending:")) {
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem(cid);
      if (cached) {
        return JSON.parse(cached) as T;
      }
    }
    throw new Error(`Payload IPFS en attente (rate-limited) et introuvable localement pour le CID: ${cid}`);
  }

  if (typeof window !== "undefined") {
    try {
      return await readJsonViaBrowserProxy<T>(cid);
    } catch (error) {
      console.warn(`[MSC] Browser IPFS proxy read failed for ${cid}; falling back to direct gateway.`, error);
    }
  }

  const url = getGatewayUrl(cid);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw networkError("IPFS JSON read", url, error);
  }

  if (!response.ok) {
    throw new Error(`IPFS read failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

export async function downloadTextFromIpfs(cid: string): Promise<string> {
  if (cid.startsWith("pending:")) {
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem(cid);
      if (cached) {
        return cached;
      }
    }
    throw new Error(`Texte IPFS en attente (rate-limited) et introuvable localement pour le CID: ${cid}`);
  }

  const url = getGatewayUrl(cid);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw networkError("IPFS text read", url, error);
  }

  if (!response.ok) {
    throw new Error(`IPFS read failed (${response.status}).`);
  }
  return await response.text();
}
