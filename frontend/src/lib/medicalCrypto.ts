type EncryptedPayload = {
  version: "msce-aes-256-gcm-v1";
  algorithm: "AES-GCM";
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
};

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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    output[i] = binary.charCodeAt(i);
  }
  return output;
}

async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  if (!passphrase || passphrase.trim().length < 8) {
    throw new Error("Passphrase must be at least 8 characters long.");
  }

  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: 120_000,
      salt: salt as unknown as BufferSource,
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function sha256HexFromObject(payload: unknown): Promise<string> {
  const canonical = canonicalize(payload);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function encryptMedicalPayload(payload: unknown, passphrase: string): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt);

  const plaintext = new TextEncoder().encode(canonicalize(payload));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as unknown as BufferSource,
    },
    key,
    plaintext
  );

  return {
    version: "msce-aes-256-gcm-v1",
    algorithm: "AES-GCM",
    saltB64: bytesToBase64(salt),
    ivB64: bytesToBase64(iv),
    ciphertextB64: bytesToBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptMedicalPayload<T>(encrypted: EncryptedPayload, passphrase: string): Promise<T> {
  if (!encrypted || encrypted.algorithm !== "AES-GCM") {
    throw new Error("Unsupported encrypted payload format.");
  }

  const salt = base64ToBytes(encrypted.saltB64);
  const iv = base64ToBytes(encrypted.ivB64);
  const ciphertext = base64ToBytes(encrypted.ciphertextB64);
  const key = await deriveAesKey(passphrase, salt);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv as unknown as BufferSource,
    },
    key,
    ciphertext as unknown as BufferSource
  );

  const text = new TextDecoder().decode(decrypted);
  return JSON.parse(text) as T;
}

export type { EncryptedPayload };
