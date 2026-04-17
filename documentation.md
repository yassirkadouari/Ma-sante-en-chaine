# Ma Sante en Chaine - Technical Documentation

## 1. Scope

This document describes the current state of the project on the IPFS-focused branch.

Active runtime layers:
1. frontend (Next.js)
2. smart-contracts (Rust blockchain-style API)
3. IPFS/Pinata (off-chain encrypted payload storage)

Node.js backend business routes are not part of the active runtime in this repository.

## 2. Repository Layout

- `README.md`: quick start and release checklist
- `documentation.md`: full technical reference
- `ipfs.md`: IPFS + encryption + integrity details
- `migrationipfs.md`: migration strategy and scripts
- `frontend/`: wallet-first web app by role
- `smart-contracts/`: Rust models and blockchain API bridge
- `scripts/`: migration utilities (Mongo/IPFS/blockchain)

## 3. Runtime Architecture

### 3.1 End-to-end flow

1. User connects wallet in frontend.
2. Frontend builds canonical JSON payload.
3. Frontend encrypts payload locally (AES-GCM envelope).
4. Frontend computes SHA-256 hash.
5. Frontend uploads encrypted JSON to IPFS/Pinata and gets CID.
6. Frontend calls Rust API `/anchors/store` with record metadata.
7. Rust API writes anchor + event and persists local state file.

### 3.2 On-chain style vs off-chain

Off-chain (IPFS):
- encrypted medical payloads
- encrypted event/PDF payloads

Rust anchor layer:
- `recordId`
- `hash`
- `cid`
- `ownerWallet`
- `doctorWallet`
- `pharmacyWallet` (optional)
- `authorizedWallets`
- `status`
- event history

## 4. Rust State and Persistence

The Rust API keeps runtime state in memory and snapshots it to disk.

State file:
- env var: `BLOCKCHAIN_STATE_FILE`
- default: `smart-contracts/data/blockchain_state.json`

Persisted collections inside snapshot:
- `anchors`
- `meta` (tx_hash, block_number)
- `events`

Health mode exposed by API:
- `persistent-rust`

## 5. API Endpoints (Rust)

Base URL default: `http://localhost:4600`

System:
- `GET /health`
- `GET /debug/state`
- `GET /resolve-role/:wallet`

Anchors:
- `GET /anchors`
- `GET /anchors/:recordId`
- `POST /anchors/store`
- `POST /anchors/verify`
- `POST /anchors/grant`
- `POST /anchors/revoke`
- `POST /anchors/is-authorized`
- `POST /anchors/deliver`
- `POST /anchors/cancel`

Events:
- `GET /events`
- `GET /events/:recordId`

## 6. Domain Workflows

### 6.1 Prescription workflow

1. Doctor creates prescription.
2. Frontend encrypts + hashes + uploads payload to IPFS.
3. Frontend anchors `recordId/hash/cid`.
4. Patient reads and verifies integrity.
5. Pharmacy delivers and status becomes `DELIVERED`.
6. Patient can claim reimbursement after delivered/used state.

### 6.2 Medical events workflow

Supported event domains:
- visit
- hospital act
- lab result

Each event can include document metadata anchored with CID.

### 6.3 Insurance workflow

1. Patient creates claim.
2. Insurance reviews pending claims.
3. Insurance approves/rejects.
4. Approved claim can be reimbursed with payment reference.

## 7. Security Model

Wallet/security:
- wallet signature for login/request signing
- role resolution from anchored identity/role records

Data security:
- AES-GCM encryption envelope on client side
- passphrase-based key derivation
- no plaintext medical payload on IPFS

Integrity:
- deterministic canonical hashing (SHA-256)
- hash verification against anchor before critical reads/actions

Access control:
- owner/doctor/pharmacy/authorized wallets on anchor
- lifecycle guardrails for deliver/cancel transitions

## 8. Environment Variables

Frontend (`frontend/.env.local`):

Required:
- `NEXT_PUBLIC_BLOCKCHAIN_API_URL`
- `NEXT_PUBLIC_IPFS_API_URL`
- `NEXT_PUBLIC_IPFS_GATEWAY_URL`
- `NEXT_PUBLIC_IPFS_API_TOKEN`

Optional:
- `NEXT_PUBLIC_ADMIN_WALLETS`
- `NEXT_PUBLIC_NO_BACKEND=true`
- `NEXT_PUBLIC_API_URL` (legacy fallback for some file routes)

Rust API process:
- `PORT` (default `4600`)
- `BLOCKCHAIN_STATE_FILE` (default `data/blockchain_state.json`)

## 9. Local Setup

### 9.1 Start Rust API

```bash
cd smart-contracts
BLOCKCHAIN_STATE_FILE=data/blockchain_state.json PORT=4600 cargo run --bin blockchain_api
```

### 9.2 Start frontend

```bash
cd frontend
npm install
npm run dev
```

### 9.3 Sanity checks

```bash
curl http://localhost:4600/health
curl http://localhost:4600/debug/state
curl http://localhost:4600/anchors
curl http://localhost:4600/events
```

## 10. Migration Scripts

Available scripts in `scripts/`:
- `migrate_mongo_to_ipfs.py`
- `migrate_all_mongo_to_ipfs.py`
- `migrate_ipfs_to_blockchain.py`

Typical dependencies:

```bash
python3 -m pip install --user requests pymongo
```

Example dry-run:

```bash
set -a && source frontend/.env.local && set +a
python3 scripts/migrate_all_mongo_to_ipfs.py --dry-run
```

## 11. Validation Checklist Before Push

1. Rust API starts and persists state.
2. Frontend login works with wallet.
3. Prescription create/read/deliver flow works.
4. Medical event document read/decrypt flow works.
5. Claims patient/insurance flow is visible and consistent.
6. Frontend lint is clean enough for release baseline.
7. No secrets committed in docs or tracked env files.

## 12. Known Limitations

- Rust layer is local and not a distributed public chain.
- `tx_hash`/`block_number` are local metadata emulation values.
- Some legacy fallback code paths may still exist for compatibility.

## 13. Short Roadmap

1. Harden payload validation on all write routes.
2. Add stronger automated E2E tests by role.
3. Add event indexer for faster dashboards.
4. Improve deployment documentation for staging/production.
