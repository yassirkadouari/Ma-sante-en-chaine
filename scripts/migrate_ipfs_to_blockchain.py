#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests

DEFAULT_PINATA_PINNING_API = "https://api.pinata.cloud/pinning"
DEFAULT_PINATA_DATA_API = "https://api.pinata.cloud/data"
DEFAULT_IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs"
DEFAULT_BLOCKCHAIN_API = "http://localhost:4600"


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_hex(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def to_timestamp(doc: Dict[str, Any]) -> int:
    for key in ["issuedAt", "occurredAt", "createdAt", "updatedAt", "migratedAt"]:
        value = doc.get(key)
        if isinstance(value, (int, float)):
            return int(value)
        if isinstance(value, str):
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                return int(parsed.timestamp())
            except Exception:
                pass
    return int(datetime.now(tz=timezone.utc).timestamp())


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

    authorized: List[str] = []
    for candidate in [doctor, pharmacy, str(doc.get("providerWallet") or "").strip()]:
        if candidate and candidate not in authorized:
            authorized.append(candidate)

    return owner, doctor, pharmacy, authorized


def derive_record_id(pin_row: Dict[str, Any], payload: Dict[str, Any], cid: str) -> str:
    source_collection = str(payload.get("sourceCollection") or "").strip()
    source_id = str(payload.get("sourceId") or "").strip()
    if source_collection and source_id:
        return f"mongo:{source_collection}:{source_id}"

    for key in ["recordId", "eventId", "claimId", "walletAddress", "_id"]:
        value = str(payload.get(key) or "").strip()
        if value:
            return value

    metadata = pin_row.get("metadata") or {}
    if isinstance(metadata, dict):
        name = str(metadata.get("name") or "").strip()
        if name:
            return f"pinata:{name}"

    return f"ipfs:{cid}"


def anchor_exists(blockchain_api: str, record_id: str) -> bool:
    response = requests.get(f"{blockchain_api.rstrip('/')}/anchors/{record_id}", timeout=20)
    if response.status_code == 404:
        return False
    if not response.ok:
        raise RuntimeError(f"Anchor lookup failed ({response.status_code}): {response.text}")
    return True


def store_anchor(blockchain_api: str, payload: Dict[str, Any]) -> None:
    response = requests.post(f"{blockchain_api.rstrip('/')}/anchors/store", json=payload, timeout=30)
    if response.status_code in (200, 201, 409):
        return
    raise RuntimeError(f"Anchor store failed ({response.status_code}): {response.text}")


def list_pinata_rows(pinata_data_api: str, token: str, page_limit: int = 200) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    offset = 0

    while True:
        response = requests.get(
            f"{pinata_data_api.rstrip('/')}/pinList",
            headers={"Authorization": f"Bearer {token}"},
            params={
                "status": "pinned",
                "pageLimit": page_limit,
                "pageOffset": offset,
            },
            timeout=40,
        )
        if not response.ok:
            raise RuntimeError(f"Pinata pinList failed ({response.status_code}): {response.text}")

        payload = response.json()
        page_rows = payload.get("rows") or []
        if not page_rows:
            break

        rows.extend(page_rows)
        if len(page_rows) < page_limit:
            break
        offset += page_limit

    return rows


def fetch_ipfs_json(gateway_base: str, cid: str) -> Dict[str, Any]:
    response = requests.get(f"{gateway_base.rstrip('/')}/{cid}", timeout=40)
    if not response.ok:
        raise RuntimeError(f"IPFS read failed ({response.status_code}) for {cid}")
    return response.json()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate existing IPFS pinned JSON payloads to Rust blockchain anchors.")
    parser.add_argument("--pinata-pinning-api", default=os.getenv("NEXT_PUBLIC_IPFS_API_URL", DEFAULT_PINATA_PINNING_API))
    parser.add_argument("--pinata-data-api", default=os.getenv("PINATA_DATA_API", DEFAULT_PINATA_DATA_API))
    parser.add_argument("--pinata-token", default=os.getenv("NEXT_PUBLIC_IPFS_API_TOKEN", ""))
    parser.add_argument("--ipfs-gateway", default=os.getenv("NEXT_PUBLIC_IPFS_GATEWAY_URL", DEFAULT_IPFS_GATEWAY))
    parser.add_argument("--blockchain-api", default=os.getenv("NEXT_PUBLIC_BLOCKCHAIN_API_URL", DEFAULT_BLOCKCHAIN_API))
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def normalize_pinata_data_api(pinning_api: str, explicit_data_api: str) -> str:
    if explicit_data_api and explicit_data_api != DEFAULT_PINATA_DATA_API:
        return explicit_data_api
    if "pinning" in pinning_api:
        return pinning_api.replace("/pinning", "/data")
    return explicit_data_api


def main() -> int:
    args = parse_args()

    if not args.pinata_token:
        print("Pinata token is required.", file=sys.stderr)
        return 2

    pinata_data_api = normalize_pinata_data_api(args.pinata_pinning_api, args.pinata_data_api)

    try:
        rows = list_pinata_rows(pinata_data_api, args.pinata_token)
    except Exception as exc:
        print(f"Unable to list Pinata pins: {exc}", file=sys.stderr)
        return 2

    if args.limit:
        rows = rows[: args.limit]

    stats: Dict[str, int] = {
        "total_pins": len(rows),
        "processed": 0,
        "migrated": 0,
        "already_anchored": 0,
        "skipped": 0,
        "errors": 0,
    }

    for row in rows:
        stats["processed"] += 1
        cid = str(row.get("ipfs_pin_hash") or "").strip()
        if not cid:
            stats["skipped"] += 1
            continue

        try:
            payload = fetch_ipfs_json(args.ipfs_gateway, cid)
            if not isinstance(payload, dict):
                stats["skipped"] += 1
                continue

            document = payload.get("document") if isinstance(payload.get("document"), dict) else payload
            if not isinstance(document, dict):
                stats["skipped"] += 1
                continue

            record_id = derive_record_id(row, payload, cid)
            if anchor_exists(args.blockchain_api, record_id):
                stats["already_anchored"] += 1
                continue

            collection = str(payload.get("sourceCollection") or "ipfs")
            owner, doctor, pharmacy, authorized = build_anchor_wallets(collection, document)
            timestamp = to_timestamp(document)
            anchor_hash = sha256_hex(payload)

            if args.dry_run:
                print(f"{record_id}: dry-run")
                continue

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
            print(f"{record_id}: migrated")
        except Exception as exc:
            stats["errors"] += 1
            print(f"{cid}: error: {exc}", file=sys.stderr)

    print("\nIPFS -> blockchain migration summary:")
    print(json.dumps(stats, indent=2, ensure_ascii=False))
    return 1 if stats["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
