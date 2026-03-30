import { connectWallet, signMessage } from "./wallet";
import { loadSession } from "./session";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function createNonce() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `nonce-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type SignedRequestOptions = {
  method?: string;
  path: string;
  body?: unknown;
  signed?: boolean;
  auth?: boolean;
};

function sha256HexFallback(input: Uint8Array) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  const rotr = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

  const bitLength = input.length * 8;
  let paddedLength = input.length + 1;
  while (paddedLength % 64 !== 56) {
    paddedLength += 1;
  }

  const buffer = new Uint8Array(paddedLength + 8);
  buffer.set(input);
  buffer[input.length] = 0x80;

  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  buffer[buffer.length - 8] = (high >>> 24) & 0xff;
  buffer[buffer.length - 7] = (high >>> 16) & 0xff;
  buffer[buffer.length - 6] = (high >>> 8) & 0xff;
  buffer[buffer.length - 5] = high & 0xff;
  buffer[buffer.length - 4] = (low >>> 24) & 0xff;
  buffer[buffer.length - 3] = (low >>> 16) & 0xff;
  buffer[buffer.length - 2] = (low >>> 8) & 0xff;
  buffer[buffer.length - 1] = low & 0xff;

  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const W = new Uint32Array(64);

  for (let offset = 0; offset < buffer.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      W[i] = ((buffer[j] << 24) | (buffer[j + 1] << 16) | (buffer[j + 2] << 8) | buffer[j + 3]) >>> 0;
    }

    for (let i = 16; i < 64; i += 1) {
      const s0 = (rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10)) >>> 0;
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];

    for (let i = 0; i < 64; i += 1) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return H.map((value) => value.toString(16).padStart(8, "0")).join("");
}

function buildSignedMessage({
  method,
  path,
  timestamp,
  nonce,
  bodyHash
}: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
}) {
  return [
    "MaSanteEnChaine Signed Request",
    `method:${method.toUpperCase()}`,
    `path:${path}`,
    `timestamp:${timestamp}`,
    `nonce:${nonce}`,
    `bodyHash:${bodyHash}`
  ].join("\n");
}

async function bodyDigest(body: unknown) {
  const canonicalize = (value: unknown): string => {
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
  };

  const data = new TextEncoder().encode(canonicalize(body || {}));

  if (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof crypto.subtle.digest === "function"
  ) {
    const digest = await crypto.subtle.digest("SHA-256", data);
    const bytes = Array.from(new Uint8Array(digest));
    return bytes.map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  return sha256HexFallback(data);
}

export async function apiRequest<T>(options: SignedRequestOptions): Promise<T> {
  const method = options.method || (options.body ? "POST" : "GET");
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (options.auth !== false) {
    const session = loadSession();
    if (!session?.token) {
      throw new Error("Missing session token");
    }
    headers.authorization = `Bearer ${session.token}`;
  }

  if (options.signed) {
    const { walletAddress } = await connectWallet();
    const timestamp = String(Date.now());
    const nonce = createNonce();
    const bodyHash = await bodyDigest(options.body || {});
    const message = buildSignedMessage({
      method,
      path: options.path,
      timestamp,
      nonce,
      bodyHash
    });

    const signature = await signMessage(walletAddress, message);
    headers["x-msce-wallet"] = walletAddress;
    headers["x-msce-signature"] = signature;
    headers["x-msce-timestamp"] = timestamp;
    headers["x-msce-nonce"] = nonce;
  }

  const response = await fetch(`${API_URL}${options.path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg = (payload as any)?.error || `Request failed: ${response.status}`;
    throw new Error(msg);
  }

  return payload as T;
}
