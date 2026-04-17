# Frontend - Ma Sante en Chaine

Next.js frontend for wallet-first healthcare workflows.

## 1. Features

- wallet login and role-aware dashboard routing
- doctor prescription creation with encrypted IPFS payload support
- pharmacy verification and delivery flow
- patient dashboards for prescriptions, events, claims, and documents
- insurance claim review and reimbursement actions
- admin governance views (roles/institution/approval)

## 2. Prerequisites

- Node.js 20+
- npm 10+
- Polkadot.js wallet extension
- Rust blockchain API running locally/remotely

## 3. Environment

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_BLOCKCHAIN_API_URL=http://localhost:4600
NEXT_PUBLIC_IPFS_API_URL=https://api.pinata.cloud/pinning
NEXT_PUBLIC_IPFS_GATEWAY_URL=https://gateway.pinata.cloud/ipfs
NEXT_PUBLIC_IPFS_API_TOKEN=replace_with_pinata_jwt
NEXT_PUBLIC_ADMIN_WALLETS=wallet1,wallet2
NEXT_PUBLIC_NO_BACKEND=true
```

Optional legacy fallback:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## 4. Run

```bash
npm install
npm run dev
```

Open:
- `http://localhost:3000`

## 5. Main Commands

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## 6. Important Frontend Modules

- `src/lib/api.ts`: API orchestration and role-aware business logic
- `src/lib/ipfsClient.ts`: IPFS upload/download client
- `src/lib/medicalCrypto.ts`: encryption/hash helpers
- `src/lib/wallet.ts`: wallet connect/sign helpers
- `src/lib/session.ts`: local session persistence

## 7. Role Dashboards

- `src/app/dashboard/patient/page.tsx`
- `src/app/dashboard/medecin/page.tsx`
- `src/app/dashboard/pharmacie/page.tsx`
- `src/app/dashboard/hopital/page.tsx`
- `src/app/dashboard/labo/page.tsx`
- `src/app/dashboard/assurance/page.tsx`
- `src/app/dashboard/admin/page.tsx`

## 8. Troubleshooting

### Wallet not detected

- verify Polkadot.js extension installed and unlocked
- refresh browser after installing extension

### IPFS upload/read failure

- verify `NEXT_PUBLIC_IPFS_API_URL`
- verify `NEXT_PUBLIC_IPFS_GATEWAY_URL`
- verify `NEXT_PUBLIC_IPFS_API_TOKEN`

### Rust API unreachable

- verify `NEXT_PUBLIC_BLOCKCHAIN_API_URL`
- run health check:

```bash
curl http://localhost:4600/health
```

## 9. Security Notes

- Do not commit real IPFS tokens.
- Keep encryption passphrases out of persistent browser storage.
- Prefer decryption in-memory only.
