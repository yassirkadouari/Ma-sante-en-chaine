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
   - Stockage off-chain des evenements medicaux.
   - Calcul d'empreintes SHA-256 sur payload canonique.
   - Verification locale + stub d'ancrage on-chain.

3) /smart-contracts
   - Modeles Rust pour preuves medicales.
   - Integration Substrate prevue (pallet proofs).

## Concept cle

- Off-chain : donnees medicales detaillees (DB privee).
- On-chain : preuves d'evenements (hash + metadonnees minimales).
- Verification : recalcul du hash depuis la DB puis comparaison avec la preuve ancree.

## Lancer le backend (POC)

```
cd backend
npm install
cp .env.example .env
npm start
```

## Endpoints principaux

- GET /health
- GET /events/types
- POST /events
- GET /events/:id
- POST /events/:id/verify
- POST /events/:id/anchor
