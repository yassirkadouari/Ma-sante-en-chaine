# IPFS Migration Plan (Branch: ipfs)

## 1. Goal

Prepare and stabilize a production-like decentralized flow based on:
- frontend wallet-first orchestration
- IPFS encrypted storage
- Rust anchor/event layer as integrity source

## 2. Branch Strategy

Use dedicated branch:

```bash
git switch -c ipfs
```

Recommended commit style:
- small, atomic, testable changes
- docs updated in same PR when behavior changes

## 3. Migration Stages

### Stage A - Baseline runtime

1. Start Rust API with persistent state.
2. Start frontend with IPFS + blockchain env.
3. Validate health/debug endpoints.

### Stage B - Prescription flow

1. create prescription with encrypted payload
2. anchor hash + CID
3. read + verify hash
4. deliver prescription

### Stage C - Medical events

1. create visit/hospital/lab event
2. include encrypted document payload (if any)
3. verify patient-side read/decrypt path

### Stage D - Claims

1. patient claim creation
2. assurance review queue
3. reimbursement finalization

## 4. Scripts Available

- `scripts/migrate_mongo_to_ipfs.py`
- `scripts/migrate_all_mongo_to_ipfs.py`
- `scripts/migrate_ipfs_to_blockchain.py`

Install Python dependencies:

```bash
python3 -m pip install --user requests pymongo
```

## 5. Script Usage Examples

### 5.1 Mongo to IPFS (prescriptions)

Dry-run:

```bash
set -a && source frontend/.env.local && set +a
python3 scripts/migrate_mongo_to_ipfs.py --dry-run --limit 10
```

Real run:

```bash
set -a && source frontend/.env.local && set +a
python3 scripts/migrate_mongo_to_ipfs.py --mongo-uri "mongodb://127.0.0.1:27017/ma_sante_en_chaine"
```

### 5.2 All Mongo collections

Dry-run:

```bash
set -a && source frontend/.env.local && set +a
python3 scripts/migrate_all_mongo_to_ipfs.py --dry-run
```

Real run:

```bash
set -a && source frontend/.env.local && set +a
python3 scripts/migrate_all_mongo_to_ipfs.py
```

### 5.3 Existing IPFS pins to blockchain

Dry-run:

```bash
set -a && source frontend/.env.local && set +a
python3 scripts/migrate_ipfs_to_blockchain.py --dry-run --limit 50
```

Real run:

```bash
set -a && source frontend/.env.local && set +a
python3 scripts/migrate_ipfs_to_blockchain.py --limit 500
```

## 6. Validation Checklist

After each stage/script:
1. `GET /debug/state` shows expected anchor/event counts.
2. New CIDs are reachable from configured gateway.
3. Anchor statuses are coherent (`PRESCRIBED/DELIVERED/CANCELLED`).
4. Spot-check hash verification for migrated samples.
5. No secret token appears in committed files.

## 7. Rollback and Safety

Before mass migration:
1. backup MongoDB
2. backup `smart-contracts/data/blockchain_state.json`
3. run dry-run first
4. migrate with small `--limit` batches

If errors occur:
- inspect script output summary
- fix mapping/credentials
- re-run (scripts are designed for safe reruns with already-anchored checks)

## 8. Push Readiness

Before pushing `ipfs` branch:
1. docs updated (`README.md`, `documentation.md`, `ipfs.md`, `migrationipfs.md`, `frontend/README.md`)
2. frontend lint baseline validated
3. core role workflows manually verified
4. no temporary patch/debug files left
