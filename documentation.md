# Ma Sante en Chaine - Complete Technical Documentation

Project owners: Yassir Kadouari, Marouane Ismaili, Ahmed Amr, Matine Elkasbiji

This document is a full handoff reference for engineers and AI agents.
It covers architecture, security model, package inventory, data model, API contracts, role flows, deployment notes, and next steps.

## 1. Project Purpose

Ma Sante en Chaine is a decentralized-health workflow platform focused on:
- Medical traceability
- Immutable prescription lifecycle
- Wallet-first identity and authentication
- Role-governed access (patient, doctor, pharmacy, hospital, insurance, admin)
- Integrity verification via on-chain style hash anchors

Design principle:
- Sensitive medical payload lives off-chain (encrypted)
- Integrity and access state are represented by anchored hashes and authorization sets

## 2. Repository Structure

- frontend: Next.js application (role dashboards + wallet auth UX)
- backend: Express API (auth, RBAC, signed requests, encrypted prescription domain)
- smart-contracts: Rust domain contracts/pseudocontracts for anchor and prescription state logic
- README.md: high-level project entry
- documentation.md: this complete technical reference

## 3. Technology Stack

### 3.1 Backend

- Runtime: Node.js
- Framework: Express
- Database: MongoDB (Mongoose ODM)
- Validation: Zod
- Security middleware: Helmet, express-rate-limit, CORS
- Session auth: JWT
- Wallet verification: Polkadot util-crypto
- Crypto:
  - SHA-256 canonical hashing
  - AES-256-GCM encryption for medical payloads

### 3.2 Frontend

- Framework: Next.js App Router
- Language: TypeScript + React
- Styling: Tailwind CSS
- Icons: lucide-react
- Wallet integration: Polkadot injected extension APIs
- QR utilities: qr-scanner

### 3.3 Smart Contracts Layer

- Language: Rust
- Scope in this repository: contract domain logic and state transition models

## 4. Package Inventory (Exact Dependencies)

### 4.1 Backend package.json dependencies

- @polkadot/util: ^13.5.9
- @polkadot/util-crypto: ^13.5.9
- cors: ^2.8.5
- dotenv: ^16.4.5
- ethers: ^6.15.0
- express: ^4.19.2
- express-rate-limit: ^7.4.0
- helmet: ^8.0.0
- jsonwebtoken: ^9.0.2
- mongoose: ^8.4.1
- zod: ^3.23.8

Backend scripts:
- dev: node src/index.js
- start: node src/index.js

Note:
- ethers is currently installed but wallet verification is implemented with Polkadot util-crypto.

### 4.2 Frontend package.json dependencies

Dependencies:
- lucide-react: ^0.577.0
- next: 16.1.6
- qr-scanner: ^1.4.2
- react: 19.2.3
- react-dom: 19.2.3

Dev dependencies:
- @tailwindcss/postcss: ^4
- @types/node: ^20
- @types/react: ^19
- @types/react-dom: ^19
- autoprefixer: ^10.4.27
- eslint: ^9
- eslint-config-next: 16.1.6
- postcss: ^8.5.8
- tailwindcss: ^4.2.1
- typescript: ^5

Frontend scripts:
- dev: next dev
- build: next build
- start: next start
- lint: eslint

## 5. Backend Architecture

Entry point:
- backend/src/index.js

Wiring:
- Loads environment via dotenv
- Connects MongoDB
- Applies middleware:
  - helmet
  - rate limiter (120 req/min default window)
  - CORS with env-driven origins
  - JSON body parser (2mb)
  - request context attachment
- Mounts routes:
  - /auth
  - /prescriptions
  - /admin
- Adds notFound and centralized error handler

### 5.1 Config modules

- backend/src/config/env.js
  - Parses environment and exposes typed config values
- backend/src/config/roles.js
  - Canonical role constants and role normalization
- backend/src/config/events.js
  - Event taxonomy used by legacy medical event route

### 5.2 Middleware modules

- backend/src/middleware/auth.js
  - Validates Bearer JWT and sets req.auth
  - requireRole helper for role-gated handlers

- backend/src/middleware/requestSignature.js
  - Enforces signed request headers:
    - x-msce-wallet
    - x-msce-signature
    - x-msce-timestamp
    - x-msce-nonce
  - Verifies timestamp skew window
  - Rebuilds canonical signed message
  - Verifies wallet signature
  - Stores nonce (replay protection, unique constraint)

- backend/src/middleware/requestContext.js
  - Adds requestId for traceability

- backend/src/middleware/errorHandler.js
  - Normalized HTTP error output

### 5.3 Service modules

- backend/src/services/roleService.js
  - Wallet-role assignment and revocation
  - Admin wallets bootstrap via ADMIN_WALLETS env

- backend/src/services/identityService.js
  - Wallet identity profile lifecycle
  - Self-profile creation by wallet owner
  - Admin role details update:
    - institutionName
    - departmentName
  - Doctor admin approval workflow
  - Access gating logic by role

- backend/src/services/blockchainService.js
  - Anchor persistence abstraction over Mongo model
  - Hash store/verify
  - Authorization grant/revoke
  - Delivery/cancel lifecycle transitions

- backend/src/services/auditService.js
  - Append-only audit events

### 5.4 Utility modules

- backend/src/utils/signature.js
  - Wallet normalization
  - Signed message builders
  - Signature verification helpers

- backend/src/utils/hash.js
  - Canonical JSON serialization
  - SHA-256 hashing

- backend/src/utils/encryption.js
  - AES-256-GCM encrypt/decrypt JSON payloads

- backend/src/utils/jwt.js
  - Sign/verify JWT sessions

## 6. Backend Data Model (MongoDB)

### 6.1 Auth and request security

- AuthNonce
  - walletAddress, role, nonce, message, expiresAt, usedAt

- RequestNonce
  - walletAddress, nonce, requestPath
  - unique nonce behavior to block replays

### 6.2 RBAC and identity

- WalletRole
  - walletAddress, role, createdByWallet, updatedByWallet

- WalletIdentity
  - walletAddress (unique)
  - role
  - fullName
  - nickname
  - dateOfBirth
  - cabinetName (doctor self-provided)
  - institutionName (admin provided depending role)
  - departmentName (admin provided depending role)
  - doctorApprovalStatus: PENDING | APPROVED | REJECTED
  - approvedByWallet
  - approvedAt
  - createdByWallet, updatedByWallet

### 6.3 Prescription and chain anchor domain

- PrescriptionRecord
  - immutable versioned records
  - encryptedData
  - dataHash
  - previousRecordId for revision chain

- PrescriptionLifecycleEvent
  - status transitions (PRESCRIBED, DELIVERED, CANCELLED)

- BlockchainAnchor
  - recordId
  - hash
  - ownerWallet
  - authorizedWallets
  - status

- AuditLog
  - action, actor, metadata, requestId, ip, timestamps

### 6.4 Legacy event model

- MedicalEvent
  - event payload + hash + chainProof state
  - used by legacy /events route

## 7. API Documentation

Base URL (local default):
- http://localhost:4000

### 7.1 Health

- GET /health
  - Returns status and requestId

### 7.2 Authentication and session

- POST /auth/nonce
  - Input:
    - walletAddress
    - role (optional)
  - Behavior:
    - Validates wallet has assigned role(s)
    - Creates nonce challenge
    - Returns identity and requiresProfile

- POST /auth/verify
  - Input:
    - walletAddress
    - role
    - nonce
    - signature
    - profile (optional for first wallet profile creation)
      - fullName, nickname, dateOfBirth
      - cabinetName required if role is MEDECIN
  - Behavior:
    - Validates nonce and signature
    - Creates identity if absent
    - Applies role access gates
    - Returns JWT token + identity

- GET /auth/roles/:walletAddress
  - Returns role list for wallet

- GET /auth/me
  - Requires JWT
  - Returns wallet, active role, all roles, identity

### 7.3 Prescription domain

All routes under /prescriptions require JWT.
Sensitive routes additionally require request signature.

- POST /prescriptions
  - Role: MEDECIN
  - Signed: yes
  - Creates immutable prescription v1
  - Encrypts data
  - Anchors hash

- GET /prescriptions
  - Role-scoped listing (patient, doctor, pharmacy)

- GET /prescriptions/:recordId
  - Signed: yes
  - Verifies read authorization via anchor
  - Verifies off-chain hash equals on-chain hash
  - Returns decrypted payload

- POST /prescriptions/:recordId/revise
  - Role: MEDECIN (issuing doctor only)
  - Signed: yes
  - Cancels previous and creates new immutable version

- POST /prescriptions/:recordId/deliver
  - Role: PHARMACIE
  - Signed: yes
  - One-time delivery transition

- POST /prescriptions/:recordId/grant
  - Role: PATIENT (owner only)
  - Signed: yes
  - Adds wallet authorization

- POST /prescriptions/:recordId/revoke
  - Role: PATIENT (owner only)
  - Signed: yes
  - Removes wallet authorization

### 7.4 Admin governance

All routes under /admin require:
- JWT auth
- ADMIN role

Signed routes require signed headers.

- GET /admin/users
  - Lists wallets + roles + identity profile

- POST /admin/users
  - Signed: yes
  - Assign role to wallet

- DELETE /admin/users
  - Signed: yes
  - Revoke role from wallet

- PATCH /admin/users/institution
  - Signed: yes
  - Updates admin-managed role details:
    - role in {ASSURANCE, HOPITAL, PHARMACIE, MEDECIN}
    - departmentName required
    - institutionName required for non-doctor roles

- PATCH /admin/users/doctor-approval
  - Signed: yes
  - Approves or rejects doctor account

### 7.5 Legacy events API (current state)

- /events routes exist in backend source but are not mounted in backend/src/index.js.
- They still use x-user-role header style authorization and represent legacy behavior.
- Recommendation: either remove or migrate to JWT + signed requests before re-enabling.

## 8. Frontend Architecture

### 8.1 App routing

Main app routes are in frontend/src/app:
- / (role selection landing)
- /login
- /dashboard/patient
- /dashboard/medecin
- /dashboard/pharmacie
- /dashboard/hopital
- /dashboard/assurance
- /dashboard/admin

Global dashboard guard:
- frontend/src/app/dashboard/layout.tsx
  - Ensures session exists
  - Ensures route role matches session role
  - Shows identity label in header

### 8.2 Frontend libraries

- frontend/src/lib/wallet.ts
  - Connects to Polkadot browser extension
  - Signs payload via signRaw

- frontend/src/lib/api.ts
  - Central API client
  - Adds JWT header automatically
  - Builds signed request headers for sensitive calls
  - Includes robust nonce fallback and SHA-256 fallback when Web Crypto subtle is unavailable

- frontend/src/lib/session.ts
  - Local storage persistence for JWT + identity context

### 8.3 Admin dashboard capabilities

Admin page supports:
- Assign/revoke roles
- Update role details (institution/company/hospital/pharmacy + department)
- Approve/reject doctors
- View role registry with identity and approval states

## 9. Identity and Approval Rules (Current Business Logic)

### 9.1 User self-entry

Wallet owner provides:
- fullName
- nickname
- dateOfBirth
- cabinetName only for doctor profile creation

### 9.2 Admin-entered data

Admin provides role details for operational verification:
- institutionName (company/hospital/pharmacy context)
- departmentName

### 9.3 Role access gates

- MEDECIN:
  - Must have identity profile
  - Must have doctorApprovalStatus APPROVED

- ASSURANCE, HOPITAL, PHARMACIE:
  - Must have identity profile
  - Must have institutionName + departmentName set by admin

- Other roles:
  - Must satisfy identity existence and role authorization checks

## 10. Security Model Summary

### 10.1 Authentication

- Wallet challenge nonce with expiration
- Signature verification server-side
- Short JWT session

### 10.2 Signed request integrity

For sensitive operations:
- Canonical body hash
- Signed message binds method + path + timestamp + nonce + body hash
- Timestamp skew enforcement
- Unique nonce persistence for anti-replay

### 10.3 Data confidentiality and integrity

- Prescription payload encrypted using AES-256-GCM
- Deterministic record hash computed from canonical payload
- Hash compared against stored anchor on read

### 10.4 Auditability

- Action-level audit log entries for critical operations
- Request ID and IP captured for traceability

## 11. Smart Contracts Layer (Rust)

### 11.1 medical_event.rs

Key structures and methods:
- PrescriptionStatus enum: Prescribed, Delivered, Cancelled
- MedicalAnchor: hash, owner, authorized set, status
- store_hash
- verify_hash
- grant_access / revoke_access
- is_authorized
- deliver_prescription
- cancel_prescription

### 11.2 ordonnance.rs

Key structures and methods:
- StatutOrdonnance enum: Prescribed, Delivered, Cancelled
- OrdonnanceVersion with version chain pointer previous_id
- emettre_ordonnance
- reviser (immutable versioning)
- annuler
- livrer

Notes:
- These files model target chain behavior and can be used as logic references for pallet/contract implementation.

## 12. Environment Variables

Backend .env.example:
- PORT=4000
- MONGODB_URI=mongodb://127.0.0.1:27017/ma_sante_en_chaine
- JWT_SECRET=replace-with-long-random-secret
- JWT_TTL=15m
- CORS_ORIGIN=http://localhost:3000
- ENCRYPTION_KEY=... (32-byte key material expected)
- LOGIN_NONCE_TTL_SECONDS=300
- REQUEST_SKEW_SECONDS=300
- ADMIN_WALLETS=

Frontend .env.local expected:
- NEXT_PUBLIC_API_URL=http://localhost:4000

## 13. Local Setup Guide

### 13.1 Backend

1. cd backend
2. npm install
3. cp .env.example .env
4. Set JWT_SECRET and ENCRYPTION_KEY securely
5. Start MongoDB
6. npm start

### 13.2 Frontend

1. cd frontend
2. npm install
3. Create .env.local with NEXT_PUBLIC_API_URL
4. npm run dev

### 13.3 Wallet

- Install Polkadot.js extension
- Import wallet/account
- Use role-specific login URLs or role selector from homepage

## 14. Operational Notes and Known Issues

- MongoDB stability is required for full flow; if Mongo crashes, API startup will fail.
- ripgrep (rg) may be missing in some environments; install ripgrep or use fallback grep/search tools.
- Legacy /events route is not mounted and uses outdated header-based role checks.
- Frontend uses dynamic Tailwind class fragments in login theme strings; ensure styles are generated as expected in your build setup.

## 15. API Security Headers Reference

For signed routes send:
- Authorization: Bearer <jwt>
- x-msce-wallet: <wallet>
- x-msce-signature: <wallet_signature>
- x-msce-timestamp: <epoch_ms>
- x-msce-nonce: <unique_nonce>

## 16. Handoff Checklist for Your Friend and Agent

Before coding changes:
1. Read backend/src/routes/auth.js
2. Read backend/src/routes/admin.js
3. Read backend/src/routes/prescriptions.js
4. Read backend/src/services/identityService.js
5. Read frontend/src/lib/api.ts
6. Read frontend/src/app/dashboard/admin/page.tsx

Before release:
1. Verify all role gates end-to-end
2. Verify doctor approval flow
3. Verify institution and department gate for pharmacy/hospital/insurance
4. Verify immutable revise flow
5. Verify signed request replay protection
6. Verify encryption/decryption integrity

## 17. Next Steps (Detailed Roadmap)

### 17.1 Security hardening

1. Remove or fully migrate legacy events route to JWT + signed request security.
2. Add strict schema validation to all route payloads where partial validation remains.
3. Add security tests for nonce replay, timestamp skew, and signature mismatch.
4. Rotate and externalize secrets through a secret manager for production.
5. Add per-route rate limits (different limits for auth, write operations, reads).

### 17.2 Identity and governance

1. Add explicit admin approval status for ASSURANCE/HOPITAL/PHARMACIE (separate from details completeness).
2. Add identity update history with who changed which field and when.
3. Add admin comments and rejection reason fields for doctor approval decisions.
4. Add user-facing pending/approved/rejected status page with clear reasons.

### 17.3 Domain features

1. Complete reimbursement pipeline from medical event to insurance decision trace.
2. Add richer hospital and lab workflows tied to prescription lifecycle.
3. Add attachment support (encrypted reports, imaging metadata references).
4. Add notification system for state transitions.

### 17.4 Blockchain integration

1. Replace mock Mongo anchor service with real Substrate pallet/extrinsic integration.
2. Implement finality-aware write confirmation and chain reorg handling.
3. Add periodic reconciliation job between off-chain DB and chain state.
4. Add chain event listener to update lifecycle status from on-chain events.

### 17.5 Testing and quality

1. Add unit tests for services (identityService, blockchainService, signature utils).
2. Add API integration tests for auth and prescription workflows.
3. Add frontend E2E tests for role login and admin approval flows.
4. Add load tests for signed endpoint throughput.

### 17.6 DevOps and production readiness

1. Add Docker Compose for backend + Mongo + frontend local parity.
2. Add CI pipeline:
   - lint
   - type-check
   - unit tests
   - integration tests
3. Add structured logs and centralized observability (metrics, traces, alerts).
4. Add backup and restore strategy for Mongo collections.

## 18. Quick Summary

Current implementation provides:
- Wallet-based auth with nonce and signatures
- JWT sessions
- Signed sensitive requests with replay protection
- Immutable encrypted prescription lifecycle
- Role governance and admin controls
- Identity and approval gates for doctor and institutional roles

The most important next milestone is moving from Mongo-backed mock anchors to real blockchain anchoring, while preserving the current security guarantees and role workflows.
