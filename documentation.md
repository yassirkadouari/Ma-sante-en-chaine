# Ma Sante en Chaine - Technical Notes (Human Version)

Owners: Yassir Kadouari, Marouane Ismaili, Ahmed Amr, Matine Elkasbiji

This is the practical project documentation I would give to a teammate before touching code.
It is intentionally direct, less "AI-style", and focused on what is actually running now.

## 1) What this project does

Ma Sante en Chaine is a decentralized healthcare workflow platform.

Main goals:
- Track medical actions with integrity checks
- Manage immutable prescription lifecycle
- Use wallet-first identity and auth
- Enforce strict role-based access
- Keep sensitive data encrypted off-chain and only anchor hashes/state

Core rule:
- Medical content is off-chain (encrypted)
- Integrity + lifecycle + access are represented by anchors and status checks

## 2) Repo map

- `frontend/` -> Next.js app (all dashboards)
- `backend/` -> Express API (auth, roles, signed routes, prescriptions, claims, events)
- `smart-contracts/` -> Rust logic models for lifecycle + anchors
- `README.md` -> quick project entry
- `documentation.md` -> this file

## 3) Tech stack

### Backend
- Node.js + Express
- MongoDB + Mongoose
- JWT sessions
- Zod validation
- Security middleware: Helmet, CORS, rate limit
- Wallet signature verification: Polkadot util-crypto
- Crypto:
  - SHA-256 canonical hashing
  - AES-256-GCM encryption for sensitive payloads

### Frontend
- Next.js App Router + React + TypeScript
- Tailwind CSS
- lucide-react icons
- Polkadot browser wallet extension integration
- QR scanner: `qr-scanner`

### Smart-contract layer (in this repo)
- Rust files used as domain reference/model
- Not yet the final live chain integration

## 4) Packages (current)

### Backend dependencies
- @polkadot/util
- @polkadot/util-crypto
- cors
- dotenv
- ethers (present, not primary in current wallet flow)
- express
- express-rate-limit
- helmet
- jsonwebtoken
- mongoose
- zod

Backend scripts:
- `npm run dev` -> `node src/index.js`
- `npm start` -> `node src/index.js`
- `npm test` -> `node --test`

### Frontend dependencies
- next
- react
- react-dom
- lucide-react
- qr-scanner

Frontend scripts:
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`

## 5) Backend architecture overview

### Entry and app factory
- `backend/src/index.js`: server startup
- `backend/src/app.js`: `createApp()` for testable app wiring

### Middleware stack (high level)
- Helmet
- Rate limiter
- CORS (env-driven)
- JSON body parser
- request context (requestId)
- centralized error handler

### Main route groups
- `/auth`
- `/prescriptions`
- `/admin`
- `/medical-events`
- `/claims`

### Important backend modules
- Config:
  - `backend/src/config/env.js`
  - `backend/src/config/roles.js`
- Middleware:
  - `backend/src/middleware/auth.js`
  - `backend/src/middleware/requestSignature.js`
  - `backend/src/middleware/requestContext.js`
  - `backend/src/middleware/errorHandler.js`
- Services:
  - `backend/src/services/roleService.js`
  - `backend/src/services/identityService.js`
  - `backend/src/services/blockchainService.js`
  - `backend/src/services/auditService.js`
- Utils:
  - `backend/src/utils/signature.js`
  - `backend/src/utils/hash.js`
  - `backend/src/utils/encryption.js`
  - `backend/src/utils/jwt.js`

## 6) Mongo data model summary

### Auth and replay protection
- `AuthNonce`
  - login nonce lifecycle (challenge, expiry, usedAt)
- `RequestNonce`
  - signed-route nonce persistence to block replay

### Role and identity
- `WalletRole`
  - assigned role per wallet
- `WalletIdentity`
  - personal identity + role-specific metadata + approval status

### Prescription + anchor domain
- `PrescriptionRecord`
  - immutable versions, encryptedData, dataHash, previousRecordId
- `PrescriptionLifecycleEvent`
  - PRESCRIBED / DELIVERED / CANCELLED transitions
- `BlockchainAnchor`
  - recordId, hash, owner, authorized wallets, status

### Audit and medical events
- `AuditLog`
  - actor/action/metadata/request trace
- `MedicalEvent`
  - profile/visit/operation payload + anchored integrity fields

## 7) API notes

Base URL (local): `http://localhost:4000`

### 7.1 Health
- `GET /health`

### 7.2 Auth/session
- `POST /auth/nonce`
- `POST /auth/verify`
- `GET /auth/roles/:walletAddress`
- `GET /auth/me`

Behavior summary:
- Wallet signs nonce challenge
- Backend verifies signature
- JWT session issued
- Role + identity gates applied

### 7.3 Prescriptions
All `/prescriptions` routes require JWT.
Sensitive writes/reads use signed-request headers.

Core endpoints:
- `POST /prescriptions` (MEDECIN, signed)
- `GET /prescriptions`
- `GET /prescriptions/:recordId` (signed)
- `POST /prescriptions/:recordId/revise` (MEDECIN, signed)
- `POST /prescriptions/:recordId/deliver` (PHARMACIE, signed)
- `POST /prescriptions/:recordId/grant` (PATIENT, signed)
- `POST /prescriptions/:recordId/revoke` (PATIENT, signed)

Current prescription payload approach:
- Text-first (no PDF required)
- Typical fields: `ordonnanceText`, `medications`, `instructions`
- Payload is encrypted off-chain and anchored by hash

### 7.4 Admin
All `/admin` routes require JWT + ADMIN.
Write actions are signed.

Key routes:
- `GET /admin/users`
- `POST /admin/users`
- `DELETE /admin/users`
- `PATCH /admin/users/institution`
- `PATCH /admin/users/doctor-approval`

### 7.5 Medical events (secure)
All `/medical-events` routes require JWT.
Write routes also require signed requests.

- `POST /medical-events/profile` (HOPITAL)
- `POST /medical-events/visit` (MEDECIN)
- `POST /medical-events/operation` (HOPITAL)
- `GET /medical-events/mine` (PATIENT)

Notes:
- Visit/operation can auto-create claims
- Event hash integrity is checked before downstream claim logic

### 7.6 Claims
All `/claims` routes require JWT.
Write routes are signed.

- `GET /claims`
- `POST /claims/prescriptions/:recordId` (PATIENT)
- `PATCH /claims/:claimId/review` (ASSURANCE)

Review decision checks anchored source integrity before approval/rejection.

## 8) Frontend architecture

Main app routes under `frontend/src/app`:
- `/`
- `/login`
- `/dashboard/patient`
- `/dashboard/medecin`
- `/dashboard/pharmacie`
- `/dashboard/hopital`
- `/dashboard/assurance`
- `/dashboard/admin`

### Session + guard behavior
- `frontend/src/app/dashboard/layout.tsx`
  - requires active session
  - checks role-route match
  - redirects unauthorized users to `/login`

### Frontend libs to know first
- `frontend/src/lib/wallet.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/session.ts`

## 9) Business rules (important)

### Identity
User fills:
- fullName
- nickname
- dateOfBirth
- cabinetName (doctor-specific)

Admin fills operational org details:
- institutionName
- departmentName

### Access gates
- MEDECIN must be APPROVED
- ASSURANCE/HOPITAL/PHARMACIE must have institution + department configured
- Everyone still needs valid role assignment + identity checks

## 10) Security model (short)

### Auth
- challenge nonce
- wallet signature verification
- short JWT session

### Signed routes
Sensitive requests bind:
- method
- path
- timestamp
- nonce
- canonical body hash

Defenses:
- timestamp skew check
- nonce uniqueness check

### Data integrity/confidentiality
- payload encryption: AES-256-GCM
- deterministic canonical hashing for anchor verification

### Auditing
- traceable action logs with requestId and metadata

## 11) Smart-contract reference files

- `smart-contracts/medical_event.rs`
- `smart-contracts/ordonnance.rs`

These files model expected lifecycle behavior and are used as logic references.

## 12) Environment variables

Backend expected values (`backend/.env`):
- `PORT=4000`
- `MONGODB_URI=mongodb://127.0.0.1:27017/ma_sante_en_chaine`
- `JWT_SECRET=...`
- `JWT_TTL=15m`
- `CORS_ORIGIN=http://localhost:3000`
- `ENCRYPTION_KEY=...` (32-byte material)
- `LOGIN_NONCE_TTL_SECONDS=300`
- `REQUEST_SKEW_SECONDS=300`
- `ADMIN_WALLETS=`
- `BLOCKCHAIN_MODE=mock`
- `BLOCKCHAIN_API_URL=`
- `BLOCKCHAIN_TIMEOUT_MS=8000`

Frontend expected values (`frontend/.env.local`):
- `NEXT_PUBLIC_API_URL=http://localhost:4000`

## 13) Local setup

### Backend
1. `cd backend`
2. `npm install`
3. `cp .env.example .env`
4. set secure `JWT_SECRET` + `ENCRYPTION_KEY`
5. start MongoDB
6. `npm start`

### Frontend
1. `cd frontend`
2. `npm install`
3. create `.env.local`
4. `npm run dev`

### Wallet
- Install Polkadot.js extension
- Import an account
- Login through unified `/login` page

## 14) Operational notes

- Backend requires healthy MongoDB; if Mongo is down, API boot fails.
- `ripgrep` (`rg`) is a dev tool for search in terminal/editor workflows, not app runtime logic.
- If camera scanning has browser issues, manual `recordId` flow still exists.

## 15) Signed headers reference

For signed endpoints:
- `Authorization: Bearer <jwt>`
- `x-msce-wallet: <wallet>`
- `x-msce-signature: <signature>`
- `x-msce-timestamp: <epoch_ms>`
- `x-msce-nonce: <unique_nonce>`

## 16) Quick implementation checklist

Before touching code, read:
1. `backend/src/routes/auth.js`
2. `backend/src/routes/admin.js`
3. `backend/src/routes/prescriptions.js`
4. `backend/src/services/identityService.js`
5. `frontend/src/lib/api.ts`
6. `frontend/src/app/dashboard/admin/page.tsx`

Before release, verify:
1. role gates end-to-end
2. doctor approval flow
3. institution/department gating
4. revise immutability behavior
5. signed request replay protection
6. encryption/decryption integrity

## 17) Current roadmap

### Security hardening
1. Add stricter schema validation where still partial.
2. Expand security tests for replay/skew/signature mismatch.
3. Move production secrets to proper secret manager.
4. Add route-specific rate limits.

### Identity/governance
1. Add explicit approval flow for ASSURANCE/HOPITAL/PHARMACIE (separate from profile completeness).
2. Add identity update history.
3. Add admin comments/reason on approvals/rejections.
4. Add user-facing status explanation UI.

### Domain features
1. Extend reimbursement pipeline traceability.
2. Add richer hospital/lab workflows.
3. Add encrypted attachment metadata support.
4. Add transition notifications.

### Blockchain integration
1. Replace mock anchor persistence with real chain integration.
2. Add finality-aware confirmation handling.
3. Add reconciliation job (DB vs chain state).
4. Add chain event listener for status sync.

### Quality/testing
1. Add service unit tests.
2. Add API integration tests.
3. Add frontend E2E tests.
4. Add load tests for signed routes.

### DevOps
1. Add Docker Compose for full local parity.
2. Add CI (lint, type-check, unit, integration).
3. Add structured observability.
4. Add backup/restore plan.

## 18) One-page status summary

Implemented and working:
- wallet nonce/signature login + JWT
- signed sensitive requests with anti-replay checks
- encrypted immutable prescription lifecycle
- patient/doctor/pharmacy/hospital/insurance/admin role governance
- secure medical events + claims linkage
- text-first prescriptions (no PDF requirement)

Next big milestone:
- switch from mock anchor persistence to real blockchain adapter while keeping API behavior stable.

## 19) Blockchain implementation pack

Goal:
- Replace mock anchor storage with real blockchain backend.

Current adapter interface to preserve (`backend/src/services/blockchainService.js`):
- `storeHash({ recordId, hash, ownerWallet, authorizedWallets })`
- `verifyHash(recordId, candidateHash)`
- `grantAccess(recordId, wallet, requestedByWallet)`
- `revokeAccess(recordId, wallet, requestedByWallet)`
- `isAuthorized(recordId, wallet)`
- `deliverPrescription(recordId, pharmacyWallet)`
- `cancelPrescription(recordId)`

Compatibility requirement:
- Keep return shapes and error semantics stable for existing routes.

Remote API contract expected by current adapter (if using remote mode):
- `POST /anchors/store`
- `POST /anchors/verify`
- `POST /anchors/grant`
- `POST /anchors/revoke`
- `POST /anchors/is-authorized`
- `POST /anchors/deliver`
- `POST /anchors/cancel`

Where chain checks are critical:
- `backend/src/routes/prescriptions.js`
- `backend/src/routes/claims.js`
- `backend/src/routes/medicalEventsSecure.js`

Record IDs to keep consistent:
- prescriptions: `recordId`
- medical events: `event:<mongoObjectId>`

Expected error semantics:
- `404` anchor not found
- `403` forbidden actor/action
- `409` invalid transition or hash mismatch

Acceptance before merge:
1. Full prescription lifecycle works through chain adapter.
2. Claims enforce delivered + valid source checks.
3. Insurance review rejects invalid/tampered sources.
4. Existing tests still pass + new chain adapter tests added.

## 20) March 2026 overhaul snapshot

### Regional governance
- Global Admin + Sub-Admin (regional scope)
- `WalletIdentity.region` used for scoped administration

### Unified approval
- Professional roles go through `PENDING -> APPROVED` before dashboard access

### Text prescription flow
- Doctor creates structured text prescription
- Payload hash anchored with `PRESCRIBED`
- Pharmacy verifies then marks `DELIVERED` (single-use flow)

### Reimbursement simulation
- Insurance can approve/reject
- Approved claims can generate `paymentReference` for simulated transfer traceability

### Patient-doctor relinking
- Patient can update primary doctor using `PATCH /auth/relink-doctor`

### Dashboard direction
- Admin: regional controls + approvals
- Doctor: medical visit + text prescription
- Patient: timeline + doctor relink
- Pharmacy: QR validation terminal
- Insurance: claims engine + reimbursement trace

