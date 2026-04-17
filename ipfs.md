# IPFS Integration Guide

## 1. Objective

This guide explains how IPFS/Pinata is used in the current architecture:
- encrypted payload storage
- CID anchoring in Rust API
- integrity verification with SHA-256

## 2. Encryption Model

Client-side cryptography:
- algorithm: AES-GCM (256)
- key derivation: PBKDF2 SHA-256
- envelope version: `msce-aes-256-gcm-v1`

Envelope fields:
- `version`
- `algorithm`
- `saltB64`
- `ivB64`
- `ciphertextB64`

Rule:
- never upload plaintext medical content to IPFS

## 3. Hashing and Integrity

Hash strategy:
- canonical JSON serialization
- SHA-256 hex digest

Usage:
1. compute hash before anchor store
2. store hash in Rust anchor
3. verify candidate hash against anchor during reads/actions

## 4. Write Pipeline

1. Build payload in frontend.
2. Encrypt payload.
3. Upload encrypted JSON to IPFS (`pinJSONToIPFS` or local API).
4. Receive CID.
5. Call `/anchors/store` with `recordId/hash/cid/wallet metadata`.

## 5. Read Pipeline

1. Read anchor by `recordId`.
2. Extract CID.
3. Fetch JSON from IPFS.
4. If encrypted, request passphrase and decrypt locally.
5. Recompute hash and compare with anchor hash.
6. Display content only if checks pass.

## 6. Pinata Configuration

Frontend env keys:

```env
NEXT_PUBLIC_IPFS_API_URL=https://api.pinata.cloud/pinning
NEXT_PUBLIC_IPFS_GATEWAY_URL=https://gateway.pinata.cloud/ipfs
NEXT_PUBLIC_IPFS_API_TOKEN=replace_with_pinata_jwt
```

Notes:
- Do not commit real tokens.
- Rotate token if it was exposed.

## 7. Rust Anchor Data for IPFS

Minimum expected fields:
- `recordId`
- `hash`
- `cid`
- `ownerWallet`
- `doctorWallet`
- `authorizedWallets`
- `timestamp`

Optional:
- `pharmacyWallet`

## 8. Troubleshooting

### Upload fails

Check:
1. token validity
2. Pinata API URL
3. network reachability

### Read fails

Check:
1. CID exists on gateway
2. gateway URL value
3. payload format (encrypted vs plain)

### Decrypt fails

Check:
1. passphrase correctness
2. envelope fields present
3. payload not corrupted

### Hash mismatch

Check:
1. canonicalization consistency
2. exact payload used for hash
3. anchor points to correct CID

## 9. Security Recommendations

1. Keep encryption/decryption in client runtime only.
2. Avoid storing passphrases in localStorage.
3. Avoid logging sensitive payloads in browser console.
4. Keep strict ownership/access checks before exposing payload content.
