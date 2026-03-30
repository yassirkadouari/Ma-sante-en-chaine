# Backend - Ma Sante en Chaine (Secure)

Secure backend for immutable encrypted prescriptions with wallet-based authentication and blockchain integrity checks.

## Security Features

- Wallet authentication with nonce challenge + signature verification
- Short-lived JWT sessions (`15m` by default)
- Signed sensitive requests (anti-replay nonce + timestamp window)
- AES-256-GCM encryption for medical payloads
- Immutable prescription records with versioning (no direct updates)
- On-chain style hash anchoring + authorization checks
- Role-based access control (`PATIENT`, `MEDECIN`, `PHARMACIE`, `HOPITAL`, `LABO`, `ASSURANCE`)
- Helmet + API rate limiting
- Append-only audit logs

## Setup

1. Copy environment file:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
npm install
```

3. Run the API:

```bash
npm start
```

## Environment Variables

- `PORT=4000`
- `MONGODB_URI=mongodb://127.0.0.1:27017/ma_sante_en_chaine`
- `JWT_SECRET=...`
- `JWT_TTL=15m`
- `CORS_ORIGIN=http://localhost:3000`
- `ENCRYPTION_KEY=<32-byte hex or base64>`
- `LOGIN_NONCE_TTL_SECONDS=300`
- `REQUEST_SKEW_SECONDS=300`
- `ADMIN_WALLETS=<wallet1,wallet2,...>`

## API Flow

1. Login challenge:
	- `POST /auth/nonce`
2. Login verification:
	- `POST /auth/verify`
3. Prescription create (doctor only, signed request):
	- `POST /prescriptions`
4. Prescription read (signed request + auth + hash verification):
	- `GET /prescriptions/:recordId`
5. Prescription revise (doctor only, immutable versioning):
	- `POST /prescriptions/:recordId/revise`
6. Prescription delivery (pharmacy only, one-time lifecycle):
	- `POST /prescriptions/:recordId/deliver`
7. Access control (patient owner only):
	- `POST /prescriptions/:recordId/grant`
	- `POST /prescriptions/:recordId/revoke`
8. Admin wallet-role governance (admin only):
	- `GET /admin/users`
	- `POST /admin/users`
	- `DELETE /admin/users`

## Signed Request Headers

Sensitive routes require:

- `Authorization: Bearer <jwt>`
- `x-msce-wallet`
- `x-msce-signature`
- `x-msce-timestamp`
- `x-msce-nonce`

The backend reconstructs the canonical message and verifies signature + nonce uniqueness.
