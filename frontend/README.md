# Frontend - Ma Sante en Chaine

Next.js frontend for wallet-first, decentralized healthcare workflows.

## 1. Architecture Prerequisites

Required runtime services:
1. Substrate contracts node (WebSocket, default `ws://127.0.0.1:9944`)
2. Deployed ink! contract address
3. Contract metadata JSON served by Next static assets
4. IPFS/Pinata API and gateway
5. Polkadot.js wallet extension in browser

## 2. Frontend Environment

Create `frontend/.env.local`:

```env
# Chain / contract
NEXT_PUBLIC_CHAIN_WS_URL=ws://127.0.0.1:9944
NEXT_PUBLIC_CONTRACT_ADDRESS=5xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_CONTRACT_METADATA_URL=/contracts/medical_anchors_contract.json

# IPFS
NEXT_PUBLIC_IPFS_API_URL=https://api.pinata.cloud/pinning
NEXT_PUBLIC_IPFS_GATEWAY_URL=https://gateway.pinata.cloud/ipfs
NEXT_PUBLIC_IPFS_API_TOKEN=replace_with_pinata_jwt

# Optional admin bootstrap wallets
NEXT_PUBLIC_ADMIN_WALLETS=wallet1,wallet2
```

## 3. Contract Metadata Placement (Critical)

The frontend loads metadata from:
`frontend/public/contracts/medical_anchors_contract.json`

If this file is missing, you will get:
1. `GET /contracts/medical_anchors_contract.json 404`
2. contract initialization failures in the browser

## 4. Launch Sequence

1. Start contracts node:

```bash
substrate-contracts-node --dev --tmp
```

2. Build and deploy ink! contract (outside this frontend folder), then copy:
	- deployed address into `NEXT_PUBLIC_CONTRACT_ADDRESS`
	- generated metadata JSON into `frontend/public/contracts/medical_anchors_contract.json`

3. Start frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## 5. Main Commands

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## 6. Troubleshooting

### `API-WS disconnected ... 1006`

Cause:
1. chain node not running
2. wrong `NEXT_PUBLIC_CHAIN_WS_URL`
3. node crashes or restarts

Fix:
1. start `substrate-contracts-node --dev --tmp`
2. verify websocket URL in `.env.local`
3. refresh frontend after node is ready

### `GET /contracts/medical_anchors_contract.json 404`

Cause:
1. metadata file not copied to `frontend/public/contracts/`

Fix:
1. create folder if needed
2. copy generated metadata JSON exactly as `medical_anchors_contract.json`
3. restart `npm run dev`

### Wallet not detected

1. ensure Polkadot.js extension is installed/unlocked
2. refresh browser

### IPFS upload/read failure

1. verify `NEXT_PUBLIC_IPFS_API_URL`
2. verify `NEXT_PUBLIC_IPFS_GATEWAY_URL`
3. verify `NEXT_PUBLIC_IPFS_API_TOKEN`

## 7. Security Notes

1. never commit real IPFS tokens
2. keep decryption material in-memory only
