#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

try:
    import requests
    from pymongo import MongoClient
except Exception as exc:  # pragma: no cover
    print("Missing dependencies. Install with: pip install pymongo requests", file=sys.stderr)
    raise


DEFAULT_MONGO_URI = "mongodb://127.0.0.1:27017/ma_sante_en_chaine"
DEFAULT_BLOCKCHAIN_API = "http://localhost:4600"
DEFAULT_PINATA_API = "https://api.pinata.cloud/pinning"
DEFAULT_COLLECTION = "prescriptionrecords"


@dataclass
class Config:
    mongo_uri: str
    db_name: str
    collection: str
    pinata_api: str
    pinata_token: str
    blockchain_api: str
    limit: Optional[int]
    dry_run: bool


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_hex(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def to_unix_seconds(value: Any) -> int:
    if value is None:
        return int(datetime.now(tz=timezone.utc).timestamp())
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return int(value.timestamp())
    try:
        return int(value)
    except Exception:
        return int(datetime.now(tz=timezone.utc).timestamp())


def normalize_wallet(value: Any, fallback: str = "unknown-wallet") -> str:
    wallet = str(value or "").strip()
    return wallet if wallet else fallback


def upload_to_pinata(cfg: Config, payload: Dict[str, Any], name: str) -> Dict[str, Any]:
    endpoint = cfg.pinata_api.rstrip("/") + "/pinJSONToIPFS"
    headers = {
        "Authorization": f"Bearer {cfg.pinata_token}",
        "Content-Type": "application/json",
    }
    body = {
        "pinataContent": payload,
        "pinataMetadata": {"name": name},
    }
    response = requests.post(endpoint, headers=headers, json=body, timeout=30)
    if not response.ok:
        raise RuntimeError(f"Pinata upload failed ({response.status_code}): {response.text}")
    return response.json()


def anchor_exists(cfg: Config, record_id: str) -> bool:
    endpoint = cfg.blockchain_api.rstrip("/") + f"/anchors/{record_id}"
    response = requests.get(endpoint, timeout=15)
    if response.status_code == 404:
        return False
    if not response.ok:
        raise RuntimeError(f"Anchor lookup failed ({response.status_code}): {response.text}")
    return True


def store_anchor(cfg: Config, payload: Dict[str, Any]) -> None:
    endpoint = cfg.blockchain_api.rstrip("/") + "/anchors/store"
    response = requests.post(endpoint, json=payload, timeout=20)
    if response.status_code in (200, 201):
        return
    if response.status_code == 409:
        return
    raise RuntimeError(f"Anchor store failed ({response.status_code}): {response.text}")


def migrate_record(cfg: Config, raw: Dict[str, Any]) -> str:
    record_id = str(raw.get("recordId") or "").strip()
    if not record_id:
        return "skipped:no-record-id"

    owner_wallet = normalize_wallet(raw.get("patientWallet"), fallback="patient-unknown")
    doctor_wallet = normalize_wallet(raw.get("doctorWallet"), fallback=owner_wallet)
    pharmacy_wallet = str(raw.get("pharmacyWallet") or "").strip() or None

    payload_for_ipfs = {
        "recordId": record_id,
        "patientWallet": raw.get("patientWallet"),
        "doctorWallet": raw.get("doctorWallet"),
        "pharmacyWallet": raw.get("pharmacyWallet"),
        "version": raw.get("version"),
        "previousRecordId": raw.get("previousRecordId"),
        "issuedAt": raw.get("issuedAt").isoformat() if isinstance(raw.get("issuedAt"), datetime) else raw.get("issuedAt"),
        "dataHash": raw.get("dataHash"),
        "hashVersion": raw.get("hashVersion"),
        "status": raw.get("status"),
        "encryptedData": raw.get("encryptedData"),
        "signedRequest": raw.get("signedRequest"),
        "source": "mongo-migration",
        "migratedAt": datetime.now(tz=timezone.utc).isoformat(),
    }

    anchor_hash = str(raw.get("dataHash") or "").strip() or sha256_hex(payload_for_ipfs)

    if cfg.dry_run:
        return "dry-run"

    pinata_result = upload_to_pinata(cfg, payload_for_ipfs, f"prescription-{record_id}")
    cid = str(pinata_result.get("IpfsHash") or "").strip()
    if not cid:
        raise RuntimeError("Pinata response missing IpfsHash")

    if anchor_exists(cfg, record_id):
        return "already-anchored"

    authorized_wallets = [doctor_wallet]
    if pharmacy_wallet:
        authorized_wallets.append(pharmacy_wallet)

    store_anchor(
        cfg,
        {
            "recordId": record_id,
            "hash": anchor_hash,
            "cid": cid,
            "ownerWallet": owner_wallet,
            "doctorWallet": doctor_wallet,
            "pharmacyWallet": pharmacy_wallet,
            "authorizedWallets": authorized_wallets,
            "timestamp": to_unix_seconds(raw.get("issuedAt")),
        },
    )

    return "migrated"


def parse_args() -> Config:
    parser = argparse.ArgumentParser(description="Migrate prescription records from MongoDB to Pinata + Rust blockchain API.")
    parser.add_argument("--mongo-uri", default=os.getenv("MONGO_URI", DEFAULT_MONGO_URI))
    parser.add_argument("--db-name", default=os.getenv("MONGO_DB", "ma_sante_en_chaine"))
    parser.add_argument("--collection", default=os.getenv("MONGO_COLLECTION", DEFAULT_COLLECTION))
    parser.add_argument("--pinata-api", default=os.getenv("NEXT_PUBLIC_IPFS_API_URL", DEFAULT_PINATA_API))
    parser.add_argument("--pinata-token", default=os.getenv("NEXT_PUBLIC_IPFS_API_TOKEN", ""))
    parser.add_argument("--blockchain-api", default=os.getenv("NEXT_PUBLIC_BLOCKCHAIN_API_URL", DEFAULT_BLOCKCHAIN_API))
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.dry_run and not args.pinata_token:
        parser.error("Pinata token is required unless --dry-run is used.")

    return Config(
        mongo_uri=args.mongo_uri,
        db_name=args.db_name,
        collection=args.collection,
        pinata_api=args.pinata_api,
        pinata_token=args.pinata_token,
        blockchain_api=args.blockchain_api,
        limit=args.limit,
        dry_run=args.dry_run,
    )


def main() -> int:
    cfg = parse_args()

    client = MongoClient(cfg.mongo_uri, serverSelectionTimeoutMS=4000)
    try:
        client.admin.command("ping")
    except Exception as exc:
        print(f"MongoDB connection failed: {exc}", file=sys.stderr)
        return 2

    coll = client[cfg.db_name][cfg.collection]
    cursor = coll.find({}).sort("createdAt", 1)
    if cfg.limit:
        cursor = cursor.limit(cfg.limit)

    stats = {
        "total": 0,
        "migrated": 0,
        "already-anchored": 0,
        "dry-run": 0,
        "skipped": 0,
        "errors": 0,
    }

    for raw in cursor:
        stats["total"] += 1
        try:
            result = migrate_record(cfg, raw)
            if result in stats:
                stats[result] += 1
            elif result.startswith("skipped"):
                stats["skipped"] += 1
            else:
                stats["migrated"] += 1
            print(f"[{stats['total']}] {raw.get('recordId', '<missing>')}: {result}")
        except Exception as exc:
            stats["errors"] += 1
            print(f"[{stats['total']}] {raw.get('recordId', '<missing>')}: error: {exc}", file=sys.stderr)

    print("\nMigration summary:")
    print(json.dumps(stats, indent=2))
    return 1 if stats["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
