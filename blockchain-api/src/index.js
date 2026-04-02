const express = require("express");
const dotenv = require("dotenv");
const { z } = require("zod");

dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));

const port = Number(process.env.PORT || 4100);

const STATUS = {
  PRESCRIBED: "PRESCRIBED",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED"
};

const anchors = new Map();

function normalizeWallet(value) {
  return String(value || "").trim();
}

function toAnchorResponse(anchor) {
  return {
    recordId: anchor.recordId,
    hash: anchor.hash,
    ownerWallet: anchor.ownerWallet,
    authorizedWallets: [...anchor.authorizedWallets],
    status: anchor.status,
    txHash: anchor.txHash,
    blockNumber: anchor.blockNumber,
    updatedAt: anchor.updatedAt
  };
}

function nextTxHash(recordId) {
  return `tx-${recordId}-${Date.now().toString(36)}`;
}

function nextBlockNumber() {
  return Date.now();
}

const storeSchema = z.object({
  recordId: z.string().min(3),
  hash: z.string().min(8),
  ownerWallet: z.string().min(10),
  authorizedWallets: z.array(z.string().min(10)).optional()
});

const verifySchema = z.object({
  recordId: z.string().min(3),
  candidateHash: z.string().min(8)
});

const accessSchema = z.object({
  recordId: z.string().min(3),
  wallet: z.string().min(10),
  requestedByWallet: z.string().min(10)
});

const isAuthorizedSchema = z.object({
  recordId: z.string().min(3),
  wallet: z.string().min(10)
});

const deliverSchema = z.object({
  recordId: z.string().min(3),
  pharmacyWallet: z.string().min(10)
});

const cancelSchema = z.object({
  recordId: z.string().min(3)
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "blockchain-api", mode: "in-memory" });
});

app.get("/anchors", (req, res) => {
  const items = [...anchors.values()].map((anchor) => toAnchorResponse(anchor));
  res.json({ items, count: items.length });
});

app.get("/anchors/:recordId", (req, res) => {
  const anchor = anchors.get(req.params.recordId);
  if (!anchor) {
    return res.status(404).json({ error: "anchor not found" });
  }
  return res.json({ anchor: toAnchorResponse(anchor) });
});

app.post("/anchors/store", (req, res) => {
  const parsed = storeSchema.parse(req.body || {});
  const recordId = parsed.recordId;
  if (anchors.has(recordId)) {
    return res.status(409).json({ error: "record already anchored" });
  }

  const ownerWallet = normalizeWallet(parsed.ownerWallet);
  const authorizedWallets = [...new Set((parsed.authorizedWallets || []).map(normalizeWallet).filter(Boolean))];

  const anchor = {
    recordId,
    hash: parsed.hash,
    ownerWallet,
    authorizedWallets,
    status: STATUS.PRESCRIBED,
    txHash: nextTxHash(recordId),
    blockNumber: nextBlockNumber(),
    updatedAt: new Date().toISOString()
  };

  anchors.set(recordId, anchor);
  return res.status(201).json({ anchor: toAnchorResponse(anchor) });
});

app.post("/anchors/verify", (req, res) => {
  const parsed = verifySchema.parse(req.body || {});
  const anchor = anchors.get(parsed.recordId);

  if (!anchor) {
    return res.json({ exists: false, valid: false, storedHash: null, status: null });
  }

  return res.json({
    exists: true,
    valid: anchor.hash === parsed.candidateHash,
    storedHash: anchor.hash,
    status: anchor.status
  });
});

app.post("/anchors/grant", (req, res) => {
  const parsed = accessSchema.parse(req.body || {});
  const anchor = anchors.get(parsed.recordId);

  if (!anchor) {
    return res.status(404).json({ error: "anchor not found" });
  }

  const actor = normalizeWallet(parsed.requestedByWallet);
  if (actor !== anchor.ownerWallet) {
    return res.status(403).json({ error: "only owner can grant access" });
  }

  const target = normalizeWallet(parsed.wallet);
  if (!anchor.authorizedWallets.includes(target)) {
    anchor.authorizedWallets.push(target);
  }
  anchor.txHash = nextTxHash(parsed.recordId);
  anchor.blockNumber = nextBlockNumber();
  anchor.updatedAt = new Date().toISOString();

  return res.json({ anchor: toAnchorResponse(anchor) });
});

app.post("/anchors/revoke", (req, res) => {
  const parsed = accessSchema.parse(req.body || {});
  const anchor = anchors.get(parsed.recordId);

  if (!anchor) {
    return res.status(404).json({ error: "anchor not found" });
  }

  const actor = normalizeWallet(parsed.requestedByWallet);
  if (actor !== anchor.ownerWallet) {
    return res.status(403).json({ error: "only owner can revoke access" });
  }

  const target = normalizeWallet(parsed.wallet);
  anchor.authorizedWallets = anchor.authorizedWallets.filter((item) => item !== target);
  anchor.txHash = nextTxHash(parsed.recordId);
  anchor.blockNumber = nextBlockNumber();
  anchor.updatedAt = new Date().toISOString();

  return res.json({ anchor: toAnchorResponse(anchor) });
});

app.post("/anchors/is-authorized", (req, res) => {
  const parsed = isAuthorizedSchema.parse(req.body || {});
  const anchor = anchors.get(parsed.recordId);

  if (!anchor) {
    return res.json({ authorized: false });
  }

  const wallet = normalizeWallet(parsed.wallet);
  const authorized = wallet === anchor.ownerWallet || anchor.authorizedWallets.includes(wallet);
  return res.json({ authorized });
});

app.post("/anchors/deliver", (req, res) => {
  const parsed = deliverSchema.parse(req.body || {});
  const anchor = anchors.get(parsed.recordId);

  if (!anchor) {
    return res.status(404).json({ error: "anchor not found" });
  }

  const actor = normalizeWallet(parsed.pharmacyWallet);
  if (!anchor.authorizedWallets.includes(actor)) {
    return res.status(403).json({ error: "pharmacy not authorized for this prescription" });
  }

  if (anchor.status === STATUS.DELIVERED) {
    return res.status(409).json({ error: "prescription already delivered" });
  }

  if (anchor.status === STATUS.CANCELLED) {
    return res.status(409).json({ error: "prescription is cancelled" });
  }

  anchor.status = STATUS.DELIVERED;
  anchor.txHash = nextTxHash(parsed.recordId);
  anchor.blockNumber = nextBlockNumber();
  anchor.updatedAt = new Date().toISOString();

  return res.json({ anchor: toAnchorResponse(anchor) });
});

app.post("/anchors/cancel", (req, res) => {
  const parsed = cancelSchema.parse(req.body || {});
  const anchor = anchors.get(parsed.recordId);

  if (!anchor) {
    return res.status(404).json({ error: "anchor not found" });
  }

  if (anchor.status === STATUS.DELIVERED) {
    return res.status(409).json({ error: "cannot cancel delivered prescription" });
  }

  anchor.status = STATUS.CANCELLED;
  anchor.txHash = nextTxHash(parsed.recordId);
  anchor.blockNumber = nextBlockNumber();
  anchor.updatedAt = new Date().toISOString();

  return res.json({ anchor: toAnchorResponse(anchor) });
});

app.use((error, req, res, next) => {
  if (error && error.name === "ZodError") {
    return res.status(400).json({ error: "invalid payload", details: error.issues });
  }

  return res.status(500).json({ error: "internal server error" });
});

app.listen(port, () => {
  console.log(`Blockchain API running on http://localhost:${port}`);
});
