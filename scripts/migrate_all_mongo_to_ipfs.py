#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests
from bson import ObjectId
from pymongo import MongoClient

DEFAULT_MONGO_URI = "mongodb://127.0.0.1:27017/ma_sante_en_chaine"
DEFAULT_DB_NAME = "ma_sante_en_chaine"
DEFAULT_PINATA_API = "https://api.pinata.cloud/pinning"
DEFAULT_BLOCKCHAIN_API = "http://localhost:4600"


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_hex(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def normalize_bson(value: Any) -> Any:
    if isinstance(value, dict):
        output: Dict[str, Any] = {}
        for key, item in value.items():
            output[str(key)] = normalize_bson(item)
        return output

    if isinstance(value, list):
        return [normalize_bson(item) for item in value]

    if isinstance(value, ObjectId):
        return str(value)

    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()

    if isinstance(value, bytes):
        return value.hex()

    return value


def pick_wallet(doc: Dict[str, Any], keys: List[str], fallback: str) -> str:
    for key in keys:
        value = str(doc.get(key) or "").strip()
        if value:
            return value
    return fallback


def build_anchor_wallets(collection: str, doc: Dict[str, Any]) -> Tuple[str, str, Optional[str], List[str]]:
    owner = pick_wallet(
        doc,
        [
            "patientWallet",
            "walletAddress",
            "ownerWallet",
            "requesterWallet",
            "actorWallet",
            "authorWallet",
            "doctorWallet",
            "providerWallet",
        ],
        fallback=f"{collection}-owner",
    )

    doctor = pick_wallet(
        doc,
        ["doctorWallet", "authorWallet", "actorWallet", "providerWallet", "walletAddress"],
        fallback=owner,
    )

    pharmacy_raw = str(doc.get("pharmacyWallet") or "").strip()
    pharmacy = pharmacy_raw if pharmacy_raw else None

    authorized = []
    for candidate in [doctor, pharmacy, str(doc.get("providerWallet") or "").strip()]:
        if candidate and candidate not in authorized:
            authorized.append(candidate)

    return owner, doctor, pharmacy, authorized


def to_timestamp(doc: Dict[str, Any]) -> int:
    for key in ["issuedAt", "occurredAt", "createdAt", "updatedAt"]:
        value = doc.get(key)
        if isinstance(value, datetime):
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            return int(value.timestamp())
        if isinstance(value, str):
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                return int(parsed.timestamp())
            except Exception:
                pass
    return int(datetime.now(tz=timezone.utc).timestamp())


def pinata_upload(pinata_api: str, token: str, content: Dict[str, Any], name: str) -> str:
    url = pinata_api.rstrip("/") + "/pinJSONToIPFS"
    response = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "pinataContent": content,
            "pinataMetadata": {"name": name},
        },
        timeout=40,
    )

    if not response.ok:
        raise RuntimeError(f"Pinata upload failed ({response.status_code}): {response.text}")

    payload = response.json()
    cid = str(payload.get("IpfsHash") or "").strip()
    if not cid:
        raise RuntimeError("Pinata response missing IpfsHash")
    return cid


def anchor_exists(blockchain_api: str, record_id: str) -> bool:
    response = requests.get(f"{blockchain_api.rstrip('/')}/anchors/{record_id}", timeout=20)
    if response.status_code == 404:
        return False
    if not response.ok:
        raise RuntimeError(f"Anchor lookup failed ({response.status_code}): {response.text}")
    return True


def store_anchor(blockchain_api: str, payload: Dict[str, Any]) -> None:
    response = requests.post(
        f"{blockchain_api.rstrip('/')}/anchors/store",
        json=payload,
        timeout=30,
    )
    if response.status_code in (200, 201, 409):
        return
    raise RuntimeError(f"Anchor store failed ({response.status_code}): {response.text}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate ALL MongoDB collections to Pinata + Rust blockchain anchors.")
    parser.add_argument("--mongo-uri", default=os.getenv("MONGO_URI", DEFAULT_MONGO_URI))
    parser.add_argument("--db-name", default=os.getenv("MONGO_DB", DEFAULT_DB_NAME))
    parser.add_argument("--pinata-api", default=os.getenv("NEXT_PUBLIC_IPFS_API_URL", DEFAULT_PINATA_API))
    parser.add_argument("--pinata-token", default=os.getenv("NEXT_PUBLIC_IPFS_API_TOKEN", ""))
    parser.add_argument("--blockchain-api", default=os.getenv("NEXT_PUBLIC_BLOCKCHAIN_API_URL", DEFAULT_BLOCKCHAIN_API))
    parser.add_argument("--include", default="", help="Comma-separated collection names. Empty means all.")
    parser.add_argument("--exclude", default="", help="Comma-separated collection names to exclude.")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def should_include(name: str, include: List[str], exclude: List[str]) -> bool:
    if name.startswith("system."):
        return False
    if include and name not in include:
        return False
    if exclude and name in exclude:
        return False
    return True


def main() -> int:
    args = parse_args()

    if not args.dry_run and not args.pinata_token:
        print("Pinata token is required for real migration.", file=sys.stderr)
        return 2

    include = [item.strip() for item in args.include.split(",") if item.strip()]
    exclude = [item.strip() for item in args.exclude.split(",") if item.strip()]

    client = MongoClient(args.mongo_uri, serverSelectionTimeoutMS=5000)
    try:
        client.admin.command("ping")
    except Exception as exc:
        print(f"MongoDB connection failed: {exc}", file=sys.stderr)
        return 2

    db = client[args.db_name]
    collections = sorted([name for name in db.list_collection_names() if should_include(name, include, exclude)])

    if not collections:
        print("No collections selected for migration.")
        return 0

    stats: Dict[str, Any] = {
        "collections": {},
        "total": 0,
        "migrated": 0,
        "already_anchored": 0,
        "dry_run": 0,
        "errors": 0,
    }

    for collection in collections:
        coll = db[collection]
        total = coll.count_documents({})
        stats["collections"][collection] = {
            "total": total,
            "migrated": 0,
            "already_anchored": 0,
            "dry_run": 0,
            "errors": 0,
        }

        print(f"\n== Collection: {collection} ({total}) ==")
        docs = list(coll.find({}).sort("_id", 1))
        for raw_doc in docs:
            stats["total"] += 1
            normalized = normalize_bson(raw_doc)
            source_id = str(normalized.get("_id") or normalized.get("recordId") or normalized.get("walletAddress") or normalized.get("claimId") or normalized.get("eventId") or f"idx-{stats['total']}")
            record_id = f"mongo:{collection}:{source_id}"

            try:
                payload = {
                    "source": "mongo-full-migration",
                    "sourceCollection": collection,
                    "sourceId": source_id,
                    "migratedAt": datetime.now(tz=timezone.utc).isoformat(),
                    "document": normalized,
                }

                anchor_hash = sha256_hex(payload)

                if args.dry_run:
                    stats["dry_run"] += 1
                    stats["collections"][collection]["dry_run"] += 1
                    print(f"{record_id}: dry-run")
                    continue

                if anchor_exists(args.blockchain_api, record_id):
                    stats["already_anchored"] += 1
                    stats["collections"][collection]["already_anchored"] += 1
                    print(f"{record_id}: already-anchored")
                    continue

                cid = pinata_upload(args.pinata_api, args.pinata_token, payload, f"{collection}-{source_id}")

                owner, doctor, pharmacy, authorized = build_anchor_wallets(collection, normalized)
                timestamp = to_timestamp(normalized)

                store_anchor(
                    args.blockchain_api,
                    {
                        "recordId": record_id,
                        "hash": anchor_hash,
                        "cid": cid,
                        "ownerWallet": owner,
                        "doctorWallet": doctor,
                        "pharmacyWallet": pharmacy,
                        "authorizedWallets": authorized,
                        "timestamp": timestamp,
                    },
                )

                stats["migrated"] += 1
                stats["collections"][collection]["migrated"] += 1
                print(f"{record_id}: migrated")
            except Exception as exc:
                stats["errors"] += 1
                stats["collections"][collection]["errors"] += 1
                print(f"{record_id}: error: {exc}", file=sys.stderr)

    print("\n=== Migration summary ===")
    print(json.dumps(stats, indent=2, ensure_ascii=False))
    return 1 if stats["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
