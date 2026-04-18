import { ApiPromise, WsProvider } from "@polkadot/api";
import { ContractPromise } from "@polkadot/api-contract";
import { hexToU8a, isHex, stringToU8a, u8aToHex } from "@polkadot/util";
import { blake2AsU8a, cryptoWaitReady } from "@polkadot/util-crypto";
import { getWalletSignerContext } from "./wallet";

const DEFAULT_CHAIN_WS = "ws://127.0.0.1:9944";
const DEFAULT_METADATA_URL = "/contracts/medical_anchors_contract.json";
const RECORD_PAGE_SIZE = 100;
const CLAIM_PAGE_SIZE = 100;
const RATE_LIMIT_MAX_RETRIES = 0;
const RATE_LIMIT_BASE_DELAY_MS = 900;
const CHAIN_READ_CACHE_TTL_MS = 12_000;
const BI_0 = BigInt(0);
const BI_5 = BigInt(5);
const BI_8 = BigInt(8);
const BI_9 = BigInt(9);
const BI_10 = BigInt(10);
const BI_1K = BigInt(1000);
const BI_1M = BigInt(1000000);
const BI_DEFAULT_REF = BigInt("1000000000000");
const BI_DEFAULT_PROOF = BigInt("10000000");

let apiPromise: Promise<ApiPromise> | null = null;
let contractPromise: Promise<ContractPromise> | null = null;
let metadataCache: Record<string, unknown> | null = null;
type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};
let anchorsListCache: CacheEntry<any[]> | null = null;
let claimsListCache: CacheEntry<any[]> | null = null;
const anchorByIdCache = new Map<string, CacheEntry<any>>();
const claimByIdCache = new Map<string, CacheEntry<any>>();

function cacheEntry<T>(value: T): CacheEntry<T> {
  return {
    value,
    expiresAt: Date.now() + CHAIN_READ_CACHE_TTL_MS,
  };
}

function isCacheValid<T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> {
  return Boolean(entry && entry.expiresAt > Date.now());
}

function invalidateAnchorCaches(recordIdHex?: string) {
  anchorsListCache = null;
  if (recordIdHex) {
    anchorByIdCache.delete(recordIdHex);
    return;
  }
  anchorByIdCache.clear();
}

function invalidateClaimCaches(claimIdHex?: string) {
  claimsListCache = null;
  if (claimIdHex) {
    claimByIdCache.delete(claimIdHex);
    return;
  }
  claimByIdCache.clear();
}

function chainWsUrl() {
  return process.env.NEXT_PUBLIC_CHAIN_WS_URL || DEFAULT_CHAIN_WS;
}

function contractAddress() {
  const address = String(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "").trim();
  if (!address) {
    throw new Error("Missing NEXT_PUBLIC_CONTRACT_ADDRESS for decentralized contract mode.");
  }
  return address;
}

function metadataUrl() {
  return process.env.NEXT_PUBLIC_CONTRACT_METADATA_URL || DEFAULT_METADATA_URL;
}

function assertBrowser() {
  if (typeof window === "undefined") {
    throw new Error("Contract client is browser-only in decentralized mode.");
  }
}

async function getApi() {
  assertBrowser();
  if (!apiPromise) {
    apiPromise = (async () => {
      await cryptoWaitReady();
      const wsUrl = chainWsUrl();
      const provider = new WsProvider(wsUrl);

      provider.on("error", (error) => {
        console.error(
          `[MSC] API-WS error on ${wsUrl}. Ensure a contracts node is running and NEXT_PUBLIC_CHAIN_WS_URL is correct.`,
          error
        );
      });

      provider.on("disconnected", () => {
        console.error(
          `[MSC] API-WS disconnected from ${wsUrl}. Start your chain node (example: substrate-contracts-node --dev --tmp).`
        );
      });

      try {
        return await ApiPromise.create({
          provider,
          noInitWarn: true,
        });
      } catch (error: any) {
        throw new Error(
          `Unable to connect to chain websocket at ${wsUrl}. Start a contracts node and verify NEXT_PUBLIC_CHAIN_WS_URL. ${String(error?.message || error)}`
        );
      }
    })();
  }
  return apiPromise;
}

async function getMetadata() {
  if (metadataCache) {
    return metadataCache;
  }

  const url = metadataUrl();
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `Unable to load contract metadata from ${url} (HTTP ${response.status}). ` +
      `Place the generated metadata at frontend/public/contracts/medical_anchors_contract.json ` +
      `or set NEXT_PUBLIC_CONTRACT_METADATA_URL to a valid path.`
    );
  }

  try {
    metadataCache = (await response.json()) as Record<string, unknown>;
  } catch (error: any) {
    throw new Error(
      `Contract metadata at ${url} is not valid JSON. Regenerate the ink! metadata and copy the JSON file again. ${String(error?.message || error)}`
    );
  }

  return metadataCache;
}

async function getContract() {
  assertBrowser();
  if (!contractPromise) {
    contractPromise = (async () => {
      const [api, metadata] = await Promise.all([getApi(), getMetadata()]);
      return new ContractPromise(api, metadata, contractAddress());
    })();
  }

  return contractPromise;
}

function toCamelCase(value: string) {
  return value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function resolveContractMethod(container: Record<string, unknown>, name: string) {
  const candidates = [name, toCamelCase(name)];
  for (const candidate of candidates) {
    const fn = container[candidate];
    if (typeof fn === "function") {
      return fn as (...args: any[]) => any;
    }
  }

  throw new Error(`Contract method not found: ${name}`);
}

function isResultEnvelope(value: unknown): value is { ok?: unknown; err?: unknown; Ok?: unknown; Err?: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value as Record<string, unknown>);
  if (!keys.length) {
    return false;
  }

  return keys.every((key) => key === "ok" || key === "err" || key === "Ok" || key === "Err");
}

function unwrapResultOutput(value: unknown): unknown {
  if (!isResultEnvelope(value)) {
    return value;
  }

  const envelope = value as { ok?: unknown; err?: unknown; Ok?: unknown; Err?: unknown };
  const err = envelope.err ?? envelope.Err;
  if (err !== undefined) {
    throw new Error(`Contract query returned output error: ${JSON.stringify(err)}`);
  }

  return envelope.ok ?? envelope.Ok;
}

function extractContractLogicError(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const envelope = value as { ok?: unknown; err?: unknown; Ok?: unknown; Err?: unknown };
  const err = envelope.err ?? envelope.Err;
  if (err !== undefined) {
    if (typeof err === "string" && err.trim()) {
      return err;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  const ok = envelope.ok ?? envelope.Ok;
  if (ok !== undefined) {
    return extractContractLogicError(ok);
  }

  return null;
}

function decodeDispatchError(api: ApiPromise, dispatchError: any) {
  if (dispatchError?.isModule) {
    const decoded = api.registry.findMetaError(dispatchError.asModule);
    const docs = decoded.docs.map((line) => line.toString()).join(" ");
    return `${decoded.section}.${decoded.name}${docs ? `: ${docs}` : ""}`;
  }

  return dispatchError?.toString?.() || String(dispatchError || "Unknown dispatch error");
}

class ContractUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractUnavailableError";
  }
}

function isContractMissingMessage(message: string) {
  return String(message || "").toLowerCase().includes("contracts.contractnotfound");
}

function isContractUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === "ContractUnavailableError") {
    return true;
  }

  return isContractMissingMessage(error.message);
}

function withContractMissingHint(message: string) {
  if (!isContractMissingMessage(message)) {
    return withStorageDepositHint(message);
  }

  return (
    `${message}. ` +
    "Le contrat configure n'existe pas sur ce noeud (souvent apres restart --tmp). " +
    "Redeployez le contrat puis mettez a jour NEXT_PUBLIC_CONTRACT_ADDRESS si necessaire."
  );
}

function withStorageDepositHint(message: string) {
  const lowered = message.toLowerCase();
  if (
    !lowered.includes("contracts.storagedepositlimitexhausted") &&
    !lowered.includes("contracts.storagedepositnotenoughfunds")
  ) {
    return message;
  }

  return (
    `${message}. ` +
    "Le wallet actif n'a pas assez de tokens pour le depot de stockage on-chain. " +
    "Utilisez un wallet dev approvisionne (ex: //Alice) ou transferez des tokens vers ce wallet."
  );
}

function bytesFromValue(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (Array.isArray(value)) {
    return new Uint8Array(value as number[]);
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return new Uint8Array();
    }

    if (isHex(text)) {
      return hexToU8a(text);
    }

    return stringToU8a(text);
  }

  return new Uint8Array();
}

function decodeCidValue(value: unknown): string {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "";
    if (isHex(text)) {
      return new TextDecoder().decode(hexToU8a(text));
    }
    return text;
  }

  return new TextDecoder().decode(bytesFromValue(value));
}

function normalizeHexId(value: unknown): string {
  if (typeof value === "string") {
    const text = value.trim();
    if (text && isHex(text)) {
      return text;
    }
  }

  return u8aToHex(bytesFromValue(value));
}

function toBigIntSafe(value: unknown, fallback: bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return fallback;
    return BigInt(Math.max(0, Math.floor(value)));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      return BigInt(trimmed);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function maxBlockWeight(api: ApiPromise): { refTime: bigint; proofSize: bigint } {
  const fallbackRefTime = BI_DEFAULT_REF;
  const fallbackProofSize = BI_DEFAULT_PROOF;

  const blockWeights = (api.consts.system as any)?.blockWeights;
  const maxBlock = blockWeights?.maxBlock;
  const json = maxBlock?.toJSON?.() as Record<string, unknown> | undefined;

  return {
    refTime: toBigIntSafe(json?.refTime ?? json?.ref_time, fallbackRefTime),
    proofSize: toBigIntSafe(json?.proofSize ?? json?.proof_size, fallbackProofSize),
  };
}

function makeWeight(api: ApiPromise, refTime: bigint, proofSize: bigint) {
  return api.registry.createType("WeightV2", {
    refTime: refTime.toString(),
    proofSize: proofSize.toString(),
  });
}

function weightParts(weight: unknown): { refTime: bigint; proofSize: bigint } {
  const fallback = { refTime: BI_0, proofSize: BI_0 };
  if (!weight) return fallback;

  const json = (weight as any)?.toJSON?.() as Record<string, unknown> | undefined;
  if (!json) return fallback;

  return {
    refTime: toBigIntSafe(json.refTime ?? json.ref_time, BI_0),
    proofSize: toBigIntSafe(json.proofSize ?? json.proof_size, BI_0),
  };
}

function defaultGasLimit(api: ApiPromise) {
  const max = maxBlockWeight(api);
  // Keep margin below max block limits to avoid Invalid Transaction: exhaust block limits.
  const refTime = max.refTime > BI_0 ? (max.refTime * BI_9) / BI_10 : (BI_DEFAULT_REF * BI_9) / BI_10;
  const proofSize = max.proofSize > BI_0 ? (max.proofSize * BI_9) / BI_10 : (BI_DEFAULT_PROOF * BI_9) / BI_10;
  return makeWeight(api, refTime, proofSize);
}

function txGasLimitFromEstimate(api: ApiPromise, estimatedWeight: unknown) {
  const max = maxBlockWeight(api);
  const estimated = weightParts(estimatedWeight);

  // Add 20% buffer over estimated query gas, while keeping strict max block headroom.
  const bufferedRef = estimated.refTime + estimated.refTime / BI_5;
  const bufferedProof = estimated.proofSize + estimated.proofSize / BI_5;

  const maxRef = max.refTime > BI_1M ? max.refTime - BI_1M : max.refTime;
  const maxProof = max.proofSize > BI_1K ? max.proofSize - BI_1K : max.proofSize;

  const refTime = bufferedRef > BI_0 ? (bufferedRef < maxRef ? bufferedRef : maxRef) : (maxRef * BI_8) / BI_10;
  const proofSize = bufferedProof > BI_0 ? (bufferedProof < maxProof ? bufferedProof : maxProof) : (maxProof * BI_8) / BI_10;

  return makeWeight(api, refTime, proofSize);
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
    message.includes("429")
  );
}

async function wait(ms: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRateLimitRetry<T>(operation: string, action: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === RATE_LIMIT_MAX_RETRIES) {
        throw error;
      }

      const delay = RATE_LIMIT_BASE_DELAY_MS * (attempt + 1);
      console.warn(
        `[MSC] ${operation} rate-limited; retrying in ${delay}ms (${attempt + 1}/${RATE_LIMIT_MAX_RETRIES})`
      );
      await wait(delay);
    }
  }

  throw lastError;
}

async function queryContract(messageName: string, args: unknown[], caller?: string) {
  const [api, contract] = await Promise.all([getApi(), getContract()]);
  const from = caller || contractAddress();
  const method = resolveContractMethod(contract.query as unknown as Record<string, unknown>, messageName);

  const result = await withRateLimitRetry(`query:${messageName}`, async () =>
    method(from, {
      gasLimit: defaultGasLimit(api),
      storageDepositLimit: null,
      value: 0,
    }, ...args)
  );

  if (result.result?.isErr) {
    const decodedError = withContractMissingHint(decodeDispatchError(api, result.result.asErr));
    const message = `Contract query failed for ${messageName}: ${decodedError}`;
    if (isContractMissingMessage(decodedError)) {
      throw new ContractUnavailableError(message);
    }
    throw new Error(message);
  }

  const rawOutput = result.output?.toJSON();
  return unwrapResultOutput(rawOutput);
}

async function txContract(messageName: string, args: unknown[]) {
  const [api, contract, signerContext] = await Promise.all([getApi(), getContract(), getWalletSignerContext()]);
  const method = resolveContractMethod(contract.tx as unknown as Record<string, unknown>, messageName);

  const queryMethod = resolveContractMethod(contract.query as unknown as Record<string, unknown>, messageName);
  const estimate = await withRateLimitRetry(`estimate:${messageName}`, async () =>
    queryMethod(
      signerContext.walletAddress,
      {
        gasLimit: defaultGasLimit(api),
        storageDepositLimit: null,
        value: 0,
      },
      ...args
    )
  );

  if (estimate.result?.isErr) {
    const decodedError = withContractMissingHint(decodeDispatchError(api, estimate.result.asErr));
    throw new Error(`Contract estimate failed for ${messageName}: ${decodedError}`);
  }

  const estimateOutput = estimate.output?.toJSON();
  const contractLogicError = extractContractLogicError(estimateOutput);
  if (contractLogicError) {
    throw new Error(`Contract call rejected for ${messageName}: ${contractLogicError}`);
  }

  const dynamicGasLimit = txGasLimitFromEstimate(api, estimate.gasRequired);

  const tx = method(
    {
      gasLimit: dynamicGasLimit,
      storageDepositLimit: null,
      value: 0,
    },
    ...args
  );

  const signAndSendOnce = () =>
    new Promise<void>((resolve, reject) => {
      tx.signAndSend(
        signerContext.walletAddress,
        { signer: signerContext.signer as any },
        ({ dispatchError, status }: any) => {
          if (dispatchError) {
            reject(new Error(decodeDispatchError(api, dispatchError)));
            return;
          }

          if (status?.isInBlock || status?.isFinalized) {
            resolve();
          }
        }
      ).catch(reject);
    });

  await signAndSendOnce();
}

export type RecordKind = "PRESCRIPTION" | "VISIT" | "LAB_RESULT" | "OPERATION" | "OTHER";

function mapRecordKind(value: RecordKind) {
  if (value === "PRESCRIPTION") return { Prescription: null };
  if (value === "VISIT") return { Visit: null };
  if (value === "LAB_RESULT") return { LabResult: null };
  if (value === "OPERATION") return { Operation: null };
  return { Other: null };
}

function mapRecordKindFromChain(value: any): RecordKind {
  if (typeof value === "string") {
    if (value === "Prescription") return "PRESCRIPTION";
    if (value === "Visit") return "VISIT";
    if (value === "LabResult") return "LAB_RESULT";
    if (value === "Operation") return "OPERATION";
    return "OTHER";
  }

  const key = Object.keys(value || {})[0] || "Other";
  if (key === "Prescription") return "PRESCRIPTION";
  if (key === "Visit") return "VISIT";
  if (key === "LabResult") return "LAB_RESULT";
  if (key === "Operation") return "OPERATION";
  return "OTHER";
}

function mapRecordStatusFromChain(value: any): "PRESCRIBED" | "DELIVERED" | "CANCELLED" {
  if (typeof value === "string") {
    if (value === "Delivered") return "DELIVERED";
    if (value === "Cancelled") return "CANCELLED";
    return "PRESCRIBED";
  }

  const key = Object.keys(value || {})[0] || "Prescribed";
  if (key === "Delivered") return "DELIVERED";
  if (key === "Cancelled") return "CANCELLED";
  return "PRESCRIBED";
}

function mapClaimStatusFromChain(value: any): "PENDING" | "APPROVED" | "REJECTED" | "REIMBURSED" {
  if (typeof value === "string") {
    if (value === "Approved") return "APPROVED";
    if (value === "Rejected") return "REJECTED";
    if (value === "Reimbursed") return "REIMBURSED";
    return "PENDING";
  }

  const key = Object.keys(value || {})[0] || "Pending";
  if (key === "Approved") return "APPROVED";
  if (key === "Rejected") return "REJECTED";
  if (key === "Reimbursed") return "REIMBURSED";
  return "PENDING";
}

function parseHash32(value: string | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) {
    if (value.length !== 32) throw new Error("Expected 32-byte hash.");
    return value;
  }

  const text = String(value || "").trim();
  if (!text) {
    throw new Error("Missing hash value.");
  }

  if (isHex(text)) {
    const bytes = hexToU8a(text);
    if (bytes.length !== 32) {
      throw new Error("Expected 32-byte hash.");
    }
    return bytes;
  }

  throw new Error("Hash must be a 0x-prefixed 32-byte hex value.");
}

export function hashRecordId(recordKey: string): string {
  const bytes = blake2AsU8a(stringToU8a(String(recordKey || "")), 256);
  return u8aToHex(bytes);
}

function recordIdArg(recordKeyOrHash: string): Uint8Array {
  const value = String(recordKeyOrHash || "").trim();
  if (isHex(value) && hexToU8a(value).length === 32) {
    return hexToU8a(value);
  }
  return blake2AsU8a(stringToU8a(value), 256);
}

function hashArg(hashHex: string): Uint8Array {
  return parseHash32(hashHex);
}

function cidArg(cid: string): number[] {
  return Array.from(stringToU8a(String(cid || "").trim()));
}

function mapAnchorOutput(recordIdHex: string, output: any) {
  if (!output) return null;

  return {
    recordId: recordIdHex,
    kind: mapRecordKindFromChain(output.kind),
    cid: decodeCidValue(output.cid),
    hash: normalizeHexId(output.dataHash),
    ownerWallet: String(output.owner || ""),
    doctorWallet: String(output.doctor || ""),
    pharmacyWallet: output.pharmacy ? String(output.pharmacy) : null,
    insurerWallet: output.insurer ? String(output.insurer) : null,
    status: mapRecordStatusFromChain(output.status),
    createdAt: Number(output.createdAt || 0),
    updatedAt: Number(output.updatedAt || 0),
  };
}

function mapClaimOutput(claimIdHex: string, output: any) {
  if (!output) return null;

  return {
    claimId: claimIdHex,
    sourceRecordId: normalizeHexId(output.sourceRecordId),
    claimantWallet: String(output.claimant || ""),
    insurerWallet: String(output.insurer || ""),
    amountRequested: Number(output.amountRequested || 0),
    amountApproved: output.amountApproved ? Number(output.amountApproved) : undefined,
    status: mapClaimStatusFromChain(output.status),
    reasonHash: output.reasonHash ? normalizeHexId(output.reasonHash) : undefined,
    paymentRefHash: output.paymentRefHash ? normalizeHexId(output.paymentRefHash) : undefined,
    createdAt: Number(output.createdAt || 0),
    updatedAt: Number(output.updatedAt || 0),
  };
}

export async function registerEncryptionPublicKey(publicKeyHex: string) {
  const key = parseHash32(publicKeyHex);
  await txContract("register_encryption_key", [key]);
}

export async function getEncryptionPublicKey(walletAddress: string): Promise<string | null> {
  const output = await queryContract("encryption_key_of", [walletAddress], walletAddress);
  if (!output) return null;
  const keyHex = normalizeHexId(output);
  return keyHex === "0x" ? null : keyHex;
}

export async function storeAnchorOnChain(input: {
  recordKey: string;
  kind: RecordKind;
  cid: string;
  hashHex: string;
  ownerWallet: string;
  doctorWallet: string;
  pharmacyWallet?: string | null;
  insurerWallet?: string | null;
}) {
  const recordId = recordIdArg(input.recordKey);

  await txContract("store_anchor", [
    recordId,
    mapRecordKind(input.kind),
    cidArg(input.cid),
    hashArg(input.hashHex),
    input.ownerWallet,
    input.doctorWallet,
    input.pharmacyWallet || null,
    input.insurerWallet || null,
  ]);

  const recordIdHex = u8aToHex(recordId);
  invalidateAnchorCaches(recordIdHex);
  return recordIdHex;
}

export async function getAnchorFromChain(recordKeyOrHash: string) {
  const id = recordIdArg(recordKeyOrHash);
  const idHex = u8aToHex(id);

  const cached = anchorByIdCache.get(idHex);
  if (isCacheValid(cached)) {
    return cached.value;
  }

  const output = await queryContract("get_anchor", [id]);
  const mapped = mapAnchorOutput(idHex, output);
  if (mapped) {
    anchorByIdCache.set(idHex, cacheEntry(mapped));
  }
  return mapped;
}

export async function listAnchorsFromChain() {
  if (isCacheValid(anchorsListCache)) {
    return anchorsListCache.value;
  }

  const ids: string[] = [];
  let offset = 0;

  while (true) {
    let chunk: Array<string | number[]>;
    try {
      chunk = (await queryContract("list_record_ids", [offset, RECORD_PAGE_SIZE])) as Array<string | number[]>;
    } catch (error) {
      if (isContractUnavailableError(error)) {
        console.warn("[MSC] listAnchorsFromChain: contract unavailable; returning empty list.");
        anchorsListCache = cacheEntry([]);
        return [];
      }
      throw error;
    }

    if (!chunk?.length) break;

    ids.push(...chunk.map((item) => normalizeHexId(item)));
    if (chunk.length < RECORD_PAGE_SIZE) break;
    offset += chunk.length;
  }

  const anchors = await Promise.all(ids.map((recordId) => getAnchorFromChain(recordId)));
  const filtered = anchors.filter(Boolean);
  anchorsListCache = cacheEntry(filtered);
  for (const anchor of filtered) {
    const recordIdHex = String((anchor as any)?.recordId || "").trim();
    if (!recordIdHex) continue;
    anchorByIdCache.set(recordIdHex, cacheEntry(anchor));
  }
  return filtered;
}

export async function grantAccessOnChain(recordKeyOrHash: string, walletAddress: string) {
  const recordId = recordIdArg(recordKeyOrHash);
  await txContract("grant_access", [recordId, walletAddress]);
  invalidateAnchorCaches(u8aToHex(recordId));
}

export async function revokeAccessOnChain(recordKeyOrHash: string, walletAddress: string) {
  const recordId = recordIdArg(recordKeyOrHash);
  await txContract("revoke_access", [recordId, walletAddress]);
  invalidateAnchorCaches(u8aToHex(recordId));
}

export async function canReadOnChain(recordKeyOrHash: string, walletAddress: string) {
  const output = await queryContract("can_read", [recordIdArg(recordKeyOrHash), walletAddress], walletAddress);
  return Boolean(output);
}

export async function verifyHashOnChain(recordKeyOrHash: string, hashHex: string) {
  const output = await queryContract("verify_hash", [recordIdArg(recordKeyOrHash), hashArg(hashHex)]);
  return Boolean(output);
}

export async function markDeliveredOnChain(recordKeyOrHash: string) {
  const recordId = recordIdArg(recordKeyOrHash);
  await txContract("mark_delivered", [recordId]);
  invalidateAnchorCaches(u8aToHex(recordId));
}

export async function cancelRecordOnChain(recordKeyOrHash: string) {
  const recordId = recordIdArg(recordKeyOrHash);
  await txContract("cancel_record", [recordId]);
  invalidateAnchorCaches(u8aToHex(recordId));
}

export async function submitClaimOnChain(input: {
  claimKey: string;
  sourceRecordKeyOrHash: string;
  insurerWallet: string;
  amountRequested: number;
}) {
  const claimId = recordIdArg(input.claimKey);
  await txContract("submit_claim", [
    claimId,
    recordIdArg(input.sourceRecordKeyOrHash),
    input.insurerWallet,
    String(Math.max(0, Math.floor(input.amountRequested || 0))),
  ]);
  const claimIdHex = u8aToHex(claimId);
  invalidateClaimCaches(claimIdHex);
  return claimIdHex;
}

export async function reviewClaimOnChain(input: {
  claimKeyOrHash: string;
  approve: boolean;
  amountApproved?: number;
  reasonHashHex?: string;
}) {
  const claimId = recordIdArg(input.claimKeyOrHash);
  await txContract("review_claim", [
    claimId,
    input.approve,
    input.approve ? String(Math.max(0, Math.floor(input.amountApproved || 0))) : null,
    input.reasonHashHex ? hashArg(input.reasonHashHex) : null,
  ]);
  invalidateClaimCaches(u8aToHex(claimId));
}

export async function markClaimReimbursedOnChain(claimKeyOrHash: string, paymentRefHashHex: string) {
  const claimId = recordIdArg(claimKeyOrHash);
  await txContract("mark_claim_reimbursed", [claimId, hashArg(paymentRefHashHex)]);
  invalidateClaimCaches(u8aToHex(claimId));
}

export async function getClaimFromChain(claimKeyOrHash: string) {
  const id = recordIdArg(claimKeyOrHash);
  const idHex = u8aToHex(id);

  const cached = claimByIdCache.get(idHex);
  if (isCacheValid(cached)) {
    return cached.value;
  }

  const output = await queryContract("get_claim", [id]);
  const mapped = mapClaimOutput(idHex, output);
  if (mapped) {
    claimByIdCache.set(idHex, cacheEntry(mapped));
  }
  return mapped;
}

export async function listClaimsFromChain() {
  if (isCacheValid(claimsListCache)) {
    return claimsListCache.value;
  }

  const ids: string[] = [];
  let offset = 0;

  while (true) {
    let chunk: Array<string | number[]>;
    try {
      chunk = (await queryContract("list_claim_ids", [offset, CLAIM_PAGE_SIZE])) as Array<string | number[]>;
    } catch (error) {
      if (isContractUnavailableError(error)) {
        console.warn("[MSC] listClaimsFromChain: contract unavailable; returning empty list.");
        claimsListCache = cacheEntry([]);
        return [];
      }
      throw error;
    }

    if (!chunk?.length) break;

    ids.push(...chunk.map((item) => normalizeHexId(item)));
    if (chunk.length < CLAIM_PAGE_SIZE) break;
    offset += chunk.length;
  }

  const claims = await Promise.all(ids.map((claimId) => getClaimFromChain(claimId)));
  const filtered = claims.filter(Boolean);
  claimsListCache = cacheEntry(filtered);
  for (const claim of filtered) {
    const claimIdHex = String((claim as any)?.claimId || "").trim();
    if (!claimIdHex) continue;
    claimByIdCache.set(claimIdHex, cacheEntry(claim));
  }
  return filtered;
}
