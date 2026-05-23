import nacl from "tweetnacl";
import { hexToU8a, isHex, stringToU8a, u8aToHex } from "@polkadot/util";
import { connectWallet, signMessage } from "./wallet";
import { getEncryptionPublicKey, registerEncryptionPublicKey } from "./chainContract";

type EncryptedKeySlot = {
  walletAddress: string;
  senderPublicKeyHex: string;
  nonceB64: string;
  encryptedDataKeyB64: string;
};

type EncryptedPayload = {
  version: "msce-hybrid-aesgcm-v2";
  algorithm: "AES-GCM";
  ivB64: string;
  ciphertextB64: string;
  payloadHashHex: string;
  encryptedKeys: EncryptedKeySlot[];
};

type EncryptOptions = {
  recipientWallets?: string[];
};

type EncryptOrPlainResult = {
  payload: EncryptedPayload | Record<string, unknown>;
  encrypted: boolean;
  missingRecipientWallets: string[];
};

type WalletKeyPair = {
  walletAddress: string;
  publicKeyHex: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
};

const walletKeyCache = new Map<string, WalletKeyPair>();
const KEY_RATE_LIMIT_MAX_RETRIES = 0;
const KEY_RATE_LIMIT_BASE_DELAY_MS = 900;

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

function normalizeWallet(value: string | null | undefined) {
  return String(value || "").trim();
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error || "");
}

function isRateLimitError(error: unknown): boolean {
  const message = asErrorMessage(error).toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("429")
  );
}

function isStorageDepositError(error: unknown): boolean {
  const message = asErrorMessage(error).toLowerCase();
  return (
    message.includes("storagedepositlimitexhausted") ||
    message.includes("storage deposit limit") ||
    message.includes("storagedepositnotenoughfunds")
  );
}

function isContractUnavailableError(error: unknown): boolean {
  const message = asErrorMessage(error).toLowerCase();
  return (
    message.includes("contracts.contractnotfound") ||
    message.includes("no contract was found at the specified address")
  );
}

async function wait(ms: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRateLimitRetry<T>(operation: string, action: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= KEY_RATE_LIMIT_MAX_RETRIES; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === KEY_RATE_LIMIT_MAX_RETRIES) {
        throw error;
      }

      const delay = KEY_RATE_LIMIT_BASE_DELAY_MS * (attempt + 1);
      console.warn(
        `[MSC] ${operation} rate-limited; retrying in ${delay}ms (${attempt + 1}/${KEY_RATE_LIMIT_MAX_RETRIES})`
      );
      await wait(delay);
    }
  }

  throw lastError;
}

export function isRateLimitLikeError(error: unknown): boolean {
  return isRateLimitError(error) || isStorageDepositError(error);
}

export function extractMissingEncryptionKeyWallet(error: unknown): string | null {
  const marker = "Recipient encryption key not registered on-chain:";
  const message = asErrorMessage(error);
  const index = message.indexOf(marker);
  if (index < 0) {
    return null;
  }

  const wallet = normalizeWallet(message.slice(index + marker.length));
  return wallet || null;
}

function signatureToBytes(signature: string): Uint8Array {
  const value = String(signature || "").trim();
  if (!value) {
    throw new Error("Wallet signature is required for key derivation.");
  }

  if (isHex(value)) {
    return hexToU8a(value);
  }

  return stringToU8a(value);
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", data as unknown as BufferSource);
  return new Uint8Array(digest);
}

async function buildWalletKeyPairFromSignature(walletAddress: string, signature: string): Promise<WalletKeyPair> {
  const signatureBytes = signatureToBytes(signature);
  const seedInput = new Uint8Array([
    ...stringToU8a("msce-wallet-key-seed-v2"),
    ...stringToU8a(walletAddress),
    ...signatureBytes,
  ]);

  const seed = await sha256Bytes(seedInput);
  const keyPair = nacl.box.keyPair.fromSecretKey(seed);
  return {
    walletAddress,
    publicKeyHex: u8aToHex(keyPair.publicKey),
    publicKey: keyPair.publicKey,
    secretKey: keyPair.secretKey,
  };
}

export async function primeWalletKeyPairFromSignature(walletAddress: string, signature: string) {
  const normalizedWallet = normalizeWallet(walletAddress);
  if (!normalizedWallet || !String(signature || "").trim()) {
    return;
  }

  const pair = await buildWalletKeyPairFromSignature(normalizedWallet, signature);
  walletKeyCache.set(normalizedWallet, pair);
}

async function deriveWalletKeyPair(): Promise<WalletKeyPair> {
  const { walletAddress } = await connectWallet();
  const cached = walletKeyCache.get(walletAddress);
  if (cached) {
    return cached;
  }

  const challenge = [
    "MaSanteEnChaine Encryption Key Derivation v2",
    `wallet:${walletAddress}`,
    "scope:ipfs-medical-data",
  ].join("\n");

  const signature = await withRateLimitRetry("wallet-signature-derivation", async () =>
    signMessage(walletAddress, challenge)
  );
  const pair = await buildWalletKeyPairFromSignature(walletAddress, signature);

  walletKeyCache.set(walletAddress, pair);
  return pair;
}

async function importAesKey(rawKey: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawKey as unknown as BufferSource, { name: "AES-GCM" }, false, usage);
}

export async function ensureWalletEncryptionKeyRegistered() {
  const keyPair = await deriveWalletKeyPair();
  const current = await withRateLimitRetry("query-wallet-encryption-key", async () =>
    getEncryptionPublicKey(keyPair.walletAddress)
  );
  if (current === keyPair.publicKeyHex) {
    return keyPair.publicKeyHex;
  }

  await withRateLimitRetry("register-wallet-encryption-key", async () =>
    registerEncryptionPublicKey(keyPair.publicKeyHex)
  );
  return keyPair.publicKeyHex;
}

export async function sha256HexFromObject(payload: unknown): Promise<string> {
  const canonical = canonicalize(payload);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function encryptMedicalPayload(
  payload: unknown,
  _legacyPassphraseOrOptions?: string | EncryptOptions,
  maybeOptions?: EncryptOptions
): Promise<EncryptedPayload> {
  const options =
    typeof _legacyPassphraseOrOptions === "string"
      ? maybeOptions || {}
      : (_legacyPassphraseOrOptions || {});

  const sender = await deriveWalletKeyPair();
  await ensureWalletEncryptionKeyRegistered();

  const recipients = new Set<string>([sender.walletAddress]);
  for (const wallet of options.recipientWallets || []) {
    const normalized = normalizeWallet(wallet);
    if (normalized) recipients.add(normalized);
  }

  const dataKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const canonical = canonicalize(payload);
  const plaintext = new TextEncoder().encode(canonical);
  const hashBytes = await sha256Bytes(plaintext);
  const payloadHashHex = u8aToHex(hashBytes);

  const aesKey = await importAesKey(dataKey, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as unknown as BufferSource,
      additionalData: hashBytes as unknown as BufferSource,
    },
    aesKey,
    plaintext
  );

  const encryptedKeys: EncryptedKeySlot[] = [];

  for (const walletAddress of recipients) {
    let recipientPublicKeyHex: string | null;
    if (walletAddress.toLowerCase() === sender.walletAddress.toLowerCase()) {
      recipientPublicKeyHex = sender.publicKeyHex;
    } else {
      recipientPublicKeyHex = await getEncryptionPublicKey(walletAddress);
    }

    if (!recipientPublicKeyHex) {
      throw new Error(`Recipient encryption key not registered on-chain: ${walletAddress}`);
    }

    const recipientPublicKey = hexToU8a(recipientPublicKeyHex);
    const nonce = crypto.getRandomValues(new Uint8Array(24));
    const encryptedDataKey = nacl.box(dataKey, nonce, recipientPublicKey, sender.secretKey);

    encryptedKeys.push({
      walletAddress,
      senderPublicKeyHex: sender.publicKeyHex,
      nonceB64: bytesToBase64(nonce),
      encryptedDataKeyB64: bytesToBase64(encryptedDataKey),
    });
  }

  return {
    version: "msce-hybrid-aesgcm-v2",
    algorithm: "AES-GCM",
    ivB64: bytesToBase64(iv),
    ciphertextB64: bytesToBase64(new Uint8Array(ciphertext)),
    payloadHashHex,
    encryptedKeys,
  };
}

export async function encryptMedicalPayloadOrPlain(
  payload: Record<string, unknown>,
  options?: EncryptOptions
): Promise<EncryptOrPlainResult> {
  try {
    const encrypted = await encryptMedicalPayload(payload, options || {});
    return {
      payload: encrypted,
      encrypted: true,
      missingRecipientWallets: [],
    };
  } catch (error) {
    const missingWallet = extractMissingEncryptionKeyWallet(error);
    if (missingWallet) {
      console.warn(
        `[MSC] Encryption key not yet registered for ${missingWallet}; ` +
        "uploading plain JSON payload. The recipient should register their " +
        "encryption key on-chain at next login to enable end-to-end encryption."
      );
      return {
        payload: payload as Record<string, unknown>,
        encrypted: false,
        missingRecipientWallets: [missingWallet],
      };
    }

    if (isContractUnavailableError(error)) {
      console.warn(
        "[MSC] Contract unavailable for encryption key resolution; " +
        "uploading plain JSON payload. Redeploy the contract to restore encryption."
      );
      return {
        payload: payload as Record<string, unknown>,
        encrypted: false,
        missingRecipientWallets: (options?.recipientWallets || []),
      };
    }

    if (isRateLimitError(error)) {
      console.warn("[MSC] Rate-limited during encryption; falling back to plain payload.");
      return {
        payload: payload as Record<string, unknown>,
        encrypted: false,
        missingRecipientWallets: (options?.recipientWallets || []),
      };
    }

    if (isStorageDepositError(error)) {
      console.warn("[MSC] Storage deposit insufficient for encryption; falling back to plain payload.");
      return {
        payload: payload as Record<string, unknown>,
        encrypted: false,
        missingRecipientWallets: (options?.recipientWallets || []),
      };
    }

    throw error;
  }
}

export async function decryptMedicalPayload<T>(encrypted: EncryptedPayload, _legacyPassphrase?: string): Promise<T> {
  // Legacy passphrase arg kept for backward call compatibility.
  void _legacyPassphrase;
  if (!encrypted || encrypted.algorithm !== "AES-GCM" || encrypted.version !== "msce-hybrid-aesgcm-v2") {
    throw new Error("Unsupported encrypted payload format.");
  }

  const receiver = await deriveWalletKeyPair();
  const slot = (encrypted.encryptedKeys || []).find(
    (item) => normalizeWallet(item.walletAddress).toLowerCase() === normalizeWallet(receiver.walletAddress).toLowerCase()
  );

  if (!slot) {
    throw new Error("No encrypted data key for the connected wallet.");
  }

  const senderPublicKey = hexToU8a(slot.senderPublicKeyHex);
  const nonce = base64ToBytes(slot.nonceB64);
  const encryptedDataKey = base64ToBytes(slot.encryptedDataKeyB64);
  const dataKey = nacl.box.open(encryptedDataKey, nonce, senderPublicKey, receiver.secretKey);

  if (!dataKey) {
    throw new Error("Unable to decrypt data key for this wallet.");
  }

  const iv = base64ToBytes(encrypted.ivB64);
  const ciphertext = base64ToBytes(encrypted.ciphertextB64);
  const payloadHashBytes = hexToU8a(encrypted.payloadHashHex);
  const aesKey = await importAesKey(dataKey, ["decrypt"]);

  const plaintextBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv as unknown as BufferSource,
      additionalData: payloadHashBytes as unknown as BufferSource,
    },
    aesKey,
    ciphertext as unknown as BufferSource
  );

  const text = new TextDecoder().decode(plaintextBuffer);
  const payload = JSON.parse(text) as T;
  const verifiedHash = await sha256HexFromObject(payload);

  if (verifiedHash !== encrypted.payloadHashHex) {
    throw new Error("Integrity mismatch: payload hash differs from on-envelope hash.");
  }

  return payload;
}

export type { EncryptedPayload };
