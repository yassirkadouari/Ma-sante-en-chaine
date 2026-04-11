# Ma Sante en Chaine

Systeme de sante decentralise pour la tracabilite du parcours medical et l'acceleration des remboursements.

## Sommaire projet

- [documentation.md](documentation.md) sert de sommaire et de preuve de mise a jour (journal technique pas a pas).

## Architecture technique (haut niveau)

Le projet est decoupe en trois couches :

1) /frontend
   - Next.js (App Router) pour l'UI par roles.
   - POC wallet-only avec Polkadot.js Extension.

2) /backend
   - API REST Express + MongoDB.
   - Wallet auth (nonce + signature + JWT 15min).
   - Requetes sensibles signees (anti-replay nonce + timestamp).
   - Chiffrement AES-256-GCM des donnees medicales.
   - Prescriptions immuables versionnees (jamais de mise a jour directe).
   - Verification d'integrite off-chain vs hash on-chain.
   - RBAC, audit logs append-only, helmet, rate-limit.

3) /smart-contracts
   - Modeles Rust pour ancrage hash et controle d'acces.
   - Fonctions: store_hash, verify_hash, grant_access, revoke_access, is_authorized, deliver_prescription.
   - Cables comme crate Rust compilable (Cargo).

## Concept cle

- Off-chain : donnees medicales chiffrees + versionnees.
- On-chain : hash + owner + wallets autorises + statut prescription.
- Verification : lecture autorisee uniquement apres verification signature, droits chain, et hash chain.

## Lancer le backend (POC)

```
cd backend
npm install
cp .env.example .env
npm start
```

## Lancer les modeles Rust

```
cd smart-contracts
cargo test
```

## Endpoints principaux (secure)

- POST /auth/nonce
- POST /auth/verify
- GET /prescriptions
- POST /prescriptions
- GET /prescriptions/:recordId
- POST /prescriptions/:recordId/revise
- POST /prescriptions/:recordId/deliver
- POST /prescriptions/:recordId/grant
- POST /prescriptions/:recordId/revoke
