# Blockchain API Bridge

Minimal blockchain bridge API for the backend `BLOCKCHAIN_MODE=remote` mode.

This service currently runs in memory and exposes a stable `/anchors/*` contract.
Your  can replace internals with real chain extrinsics/events while keeping the same HTTP API.

## Setup

1. Install dependencies:

```bash
cd blockchain-api
npm install
```

2. Configure env:

```bash
cp .env.example .env
```
urgence
3. Run:

```bash
npm run dev
```

## Health

- `GET /health`
- `GET /anchors`
- `GET /anchors/:recordId`

## Anchor API

- `POST /anchors/store`
- `POST /anchors/verify`
- `POST /anchors/grant`
- `POST /anchors/revoke`
- `POST /anchors/is-authorized`
- `POST /anchors/deliver`
- `POST /anchors/cancel`

## Backend Wiring

In `backend/.env`:

```bash
BLOCKCHAIN_MODE=remote
BLOCKCHAIN_API_URL=http://localhost:4500
BLOCKCHAIN_TIMEOUT_MS=8000
```

Then restart backend.

## Migration Notes for Real Blockchain

- Keep response shapes stable to avoid backend route rewrites.
- Map chain errors to equivalent HTTP errors:
  - `404` anchor not found
  - `403` forbidden action
  - `409` invalid transition / hash mismatch
- Ensure finality before returning success for write operations.
