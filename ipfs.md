# IPFS Migration Wiring Guide

## Migration status

Backend Node.js has been removed from this repository (`backend/` and `blockchain-api/` deleted).
The remaining work is to finish frontend direct interactions for all role workflows.

## But du document
Ce document explique:
1. Les branchements implementes pour connecter frontend, backend et blockchain avec IPFS
2. Comment les algorithmes de chiffrement/dechiffrement sont implementes
3. Comment le hashage fonctionne
4. Comment fonctionne la blockchain/smart contract dans l etat actuel
5. Comment supprimer progressivement le backend Node.js vers une architecture full decentralized

## Etat actuel apres branchement

### Flux ordonnance branche
1. Le medecin saisit l ordonnance dans le frontend.
2. Si IPFS est active:
   - Le payload ordonnance est chiffre cote frontend (AES-GCM)
   - Un hash SHA-256 du payload chiffre est calcule
   - Le payload chiffre est upload sur IPFS, on recupere un CID
3. Le frontend appelle `POST /prescriptions` avec:
   - `data` (payload metier actuel)
   - `ipfs.cid`
   - `ipfs.payloadHash`
   - `ipfs.encryptionVersion`
4. Le backend garde la logique existante (encryptJson interne + record Mongo) pour compatibilite.
5. Le backend ancre sur la blockchain Rust avec:
   - `recordId`
   - `hash` (hash interne actuel)
   - `cid` (CID IPFS reel si present, sinon fallback)
6. Le dashboard medecin affiche aussi `CID_IPFS`.

## Fichiers modifies pour ce branchement

### Frontend
- `frontend/src/lib/medicalCrypto.ts`
  - chiffrement/dechiffrement + hash SHA-256
- `frontend/src/lib/ipfsClient.ts`
  - upload/download IPFS
- `frontend/src/app/dashboard/medecin/page.tsx`
  - branchement E2E: encrypt -> hash -> upload IPFS -> POST backend

### Backend
- `backend/src/routes/prescriptions.js`
  - accepte metadata `ipfs` dans create
  - passe le CID au service blockchain
  - renvoie `ipfsCid` dans la reponse create
- `backend/src/models/PrescriptionRecord.js`
  - ajoute `ipfs` metadata au schema
- `backend/src/services/blockchainService.js`
  - support metadata `cid/doctor/pharmacy/timestamp`
  - fonctions lecture anchors/events

### Rust blockchain API
- `smart-contracts/medical_event.rs`
  - schema on-chain etendu (cid, owner, doctor, pharmacy, timestamps)
- `smart-contracts/src/bin/blockchain_api.rs`
  - routes anchors/events
  - mapping serde camelCase pour compatibilite API

## Implementation chiffrement/dechiffrement

## Choix algorithmique
- Algorithme: AES-GCM 256 bits
- Derivation de cle: PBKDF2 SHA-256
- Iterations: 120000
- Salt: 16 bytes aleatoires
- IV: 12 bytes aleatoires

## Pourquoi ce choix
- AES-GCM donne confidentialite + integrite (auth tag natif)
- PBKDF2 renforce une passphrase utilisateur
- IV et salt aleatoires evitent la reutilisation deterministe

## Processus chiffrement (frontend)
1. Canonicaliser le JSON (ordre de cle stable)
2. Deriver la cle AES depuis passphrase + salt
3. Chiffrer en AES-GCM avec IV
4. Exporter en base64:
   - `saltB64`
   - `ivB64`
   - `ciphertextB64`
5. Retourner envelope:
   - `version`
   - `algorithm`
   - les trois champs base64

## Processus dechiffrement
1. Recharger salt/iv/ciphertext depuis envelope
2. Rederiver la cle avec la meme passphrase
3. Dechiffrer AES-GCM
4. Parser JSON

## Notes securite
1. Ne jamais uploader des donnees medicales en clair sur IPFS
2. La passphrase ne doit jamais sortir du client
3. En production, preferer une gestion de cles par wallet/KMS plutot que passphrase manuelle

## Implementation hashage

## Objectif
Le hash sert a:
1. Detecter toute alteration de donnees
2. Fournir une preuve d integrite ancree blockchain

## Methode
- Algorithme: SHA-256
- Entree: payload canonicalise (ordre stable)
- Sortie: hex string 64 caracteres

## Deux hashes dans le systeme actuel
1. `blockchainHash` actuel (backend)
   - calcule a partir du record interne backend
   - utilise pour compatibilite avec les routes actuelles
2. `ipfs.payloadHash` (frontend)
   - calcule sur le payload chiffre envoye a IPFS
   - preuve d integrite du contenu IPFS

## Comment cela evolue
En phase full decentralized, le hash principal ancre on-chain doit devenir celui du payload IPFS chiffre.

## Comment fonctionne blockchain + smart contract actuellement

## Smart contract / service Rust
Le service Rust expose des endpoints de type smart-contract API:
- `POST /anchors/store`
- `POST /anchors/verify`
- `POST /anchors/grant`
- `POST /anchors/revoke`
- `POST /anchors/deliver`
- `POST /anchors/cancel`
- `GET /anchors`
- `GET /events`

## Donnees ancrees
Pour chaque record:
- `recordId`
- `hash`
- `cid`
- `ownerWallet`
- `doctorWallet`
- `pharmacyWallet`
- `authorizedWallets`
- `status`
- `createdAt/updatedAt`

## Events dashboard
Le bridge Rust enregistre des events metier:
- `ANCHOR_STORED`
- `ACCESS_GRANTED`
- `ACCESS_REVOKED`
- `PRESCRIPTION_DELIVERED`
- `PRESCRIPTION_CANCELLED`

Ces events servent a construire des dashboards sans interroger chaque record individuellement.

## Limite actuelle
Le bridge Rust est en memoire (in-memory). Redemarrage = reset d etat.
Pour production, il faut un vrai reseau blockchain persistant.

## Plan pour supprimer le backend Node.js

## Etape 1 - Frontend wallet-first (court terme)
1. Conserver Node.js seulement pour routes legacy
2. Ajouter un mode frontend direct chain+ipfs pour prescriptions
3. Afficher dans UI transaction hash et confirmations

## Etape 2 - Smart contracts comme source unique
1. Creation/revision/delivery/cancel completement on-chain
2. Claims assurance on-chain
3. Verification hash uniquement on-chain + IPFS

## Etape 3 - Indexation decentralisee
1. Ajouter indexer events (The Graph ou indexer custom)
2. Dashboards lisent indexer au lieu de Mongo

## Etape 4 - Extinction backend metier Node.js
1. Retirer routes metier:
   - `/prescriptions`
   - `/claims`
   - `/medical-events` (partie metier)
2. Garder au pire un service statique/dev only
3. Supprimer MongoDB des workflows critiques

## Etape 5 - Nettoyage final
1. Deprecier `encryptJson` backend
2. Deprecier `PrescriptionRecord` Mongo
3. Conserver uniquement contrats + frontend + indexer + IPFS pinning

## Risques et points critiques
1. Gestion de cles chiffrement: point le plus sensible
2. Cout gas/latence UX: transactions blockchain sont plus lentes
3. Disponibilite IPFS: necessite pinning fiable
4. Migration data: doit etre idempotente et verifiable hash par hash

## Checklist execution
1. Cargo/Rust toolchain installee localement
2. Noeud IPFS local ou provider operationnel
3. Frontend configure:
   - `NEXT_PUBLIC_IPFS_API_URL`
   - `NEXT_PUBLIC_IPFS_GATEWAY_URL`
   - `NEXT_PUBLIC_IPFS_API_TOKEN` (obligatoire pour Pinata)
4. Backend configure remote Rust blockchain
5. Test E2E:
   - create ordonnance
   - verify anchor
   - lire CID
   - delivrer
   - claim

## Configuration Pinata (implementee)

Le client `frontend/src/lib/ipfsClient.ts` supporte maintenant 2 modes:
1. IPFS local (`/api/v0/add`)
2. Pinata (`/pinning/pinJSONToIPFS`)

Pinata est active automatiquement quand `NEXT_PUBLIC_IPFS_API_URL` contient `pinata.cloud`.

Exemple:
```env
NEXT_PUBLIC_IPFS_API_URL=https://api.pinata.cloud/pinning
NEXT_PUBLIC_IPFS_GATEWAY_URL=https://gateway.pinata.cloud/ipfs
NEXT_PUBLIC_IPFS_API_TOKEN=your_pinata_jwt
```

## Conclusion
Le projet est maintenant branche pour une phase hybride stable:
- logique actuelle preservee
- pipeline IPFS chiffre operationnel cote frontend
- cid deja injecte dans l ancrage blockchain

La prochaine bascule vers full decentralized consiste a deplacer progressivement toute la logique metier restante du backend Node.js vers smart contracts + indexation.

## Smoke test rapide (sans Node.js)

Pre-requis:
1. Frontend lance
2. Rust blockchain API lancee sur `http://localhost:4600`
3. Extension wallet active
4. Pinata (ou IPFS local) configure

Variables frontend minimales:
```env
NEXT_PUBLIC_BLOCKCHAIN_API_URL=http://localhost:4600
NEXT_PUBLIC_IPFS_API_URL=https://api.pinata.cloud/pinning
NEXT_PUBLIC_IPFS_GATEWAY_URL=https://gateway.pinata.cloud/ipfs
NEXT_PUBLIC_IPFS_API_TOKEN=your_pinata_jwt
```

Steps:
1. Ouvrir dashboard medecin
2. Saisir wallet patient
3. Laisser "Upload IPFS chiffre" active et saisir passphrase
4. Cliquer "EMETTRE_ORDONNANCE"
5. Verifier que le registre affiche:
   - `RECORD_ID`
   - `HASH_BLOCKCHAIN`
   - `CID_IPFS`

Verification terminal:
```bash
curl -s http://localhost:4600/anchors | jq
curl -s http://localhost:4600/events | jq
```
