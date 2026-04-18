# Ma Sante en Chaine - Documentation Technique Professionnelle

## 0. Pourquoi cette version

Cette documentation a ete re-ecrite pour etre exhaustive et exploitable par des profils techniques (devs, architectes, ops, auditeurs), avec un niveau de detail plus eleve sur:
1. l architecture runtime reelle
2. les flux metier par role
3. les contrats de donnees
4. la securite
5. la persistance
6. les scripts de migration
7. les procedures d exploitation et de diagnostic

## 1. Scope et etat reel du projet

### 1.1 Scope

Le scope couvre uniquement ce qui est actif dans ce repository.

### 1.2 Architecture active

Le systeme actif est compose de:
1. Frontend Next.js (orchestration metier, wallet, chiffrement, UX role-based)
2. Smart contract ink! (`smart-contracts/ink-medical-anchors/lib.rs`) execute sur node Substrate contracts
3. IPFS/Pinata (stockage off-chain des payloads chiffres)
4. API routes Next.js de support (role/identity resolve + proxy de lecture IPFS)

### 1.3 Point important

Le backend Node.js historique n est plus le runtime metier principal dans ce repo.
Le flux runtime par defaut est wallet -> frontend -> appels contrat (via `frontend/src/lib/chainContract.ts`).
Le frontend inclut une facade API locale (dans `frontend/src/lib/api.ts`) qui encapsule la logique metier et orchestre les appels on-chain et IPFS.

## 2. Vue d ensemble technique

### 2.1 Pipeline principal (high-level)

1. Un acteur se connecte avec wallet.
2. Le frontend determine le role via anchors de gouvernance.
3. Le frontend prepare le payload medical (ordonnance ou evenement).
4. Le frontend chiffre localement (AES-GCM) si necessaire.
5. Le frontend calcule un hash SHA-256 canonique.
6. Le frontend upload le document JSON vers IPFS et recupere un CID.
7. Le frontend ancre hash + CID via transaction `store_anchor` (ink!).
8. Le frontend lit/affiche les donnees en verifiant hash et droits.

### 2.2 Separation on-chain / off-chain

On-chain (ink! contract):
- hash d integrite
- CID
- wallets (owner/doctor/pharmacy/insurer)
- droits supplementaires (`grant_access`/`revoke_access`)
- statut d ordonnance
- cycle claims (submit/review/reimburse)

Off-chain (IPFS):
- contenu medical detaille
- payloads chiffres
- documents (PDF encodes en base64 dans un JSON)

## 3. Composants et responsabilites

### 3.1 Frontend Next.js

Fichiers cle:
- `frontend/src/lib/api.ts`
- `frontend/src/lib/ipfsClient.ts`
- `frontend/src/lib/medicalCrypto.ts`
- `frontend/src/lib/wallet.ts`
- `frontend/src/lib/session.ts`

Responsabilites:
1. Auth wallet + signature
2. Resolution role + identite
3. ACL metier cote client
4. Chiffrement/dechiffrement
5. Hash canonique
6. Upload/download IPFS
7. Orchestration des workflows (ordonnance, events, claims, admin)

### 3.2 Smart contract ink! + node Substrate contracts

Fichier principal:
- `smart-contracts/ink-medical-anchors/lib.rs`

Responsabilites:
1. Stockage anchors
2. Verification hash
3. Transitions statut (`mark_delivered`, `cancel_record`)
4. ACL (`can_read`, `grant_access`, `revoke_access`)
5. Claims (`submit_claim`, `review_claim`, `mark_claim_reimbursed`)
6. Clefs de chiffrement (`register_encryption_key`)

### 3.3 API routes Next.js de resolution identite/role

Routes:
- `frontend/src/app/api/role/resolve/[wallet]/route.ts`
- `frontend/src/app/api/identity/resolve/[wallet]/route.ts`

Role resolve:
1. source prioritaire: anchors `mongo:walletroles:*`
2. fallback: identity anchors
3. fallback final: inference a partir des anchors medicaux

Identity resolve:
1. lit anchors identite (`mongo:walletidentities`, `mongo:users`, `mongo:walletroles`)
2. extrait fullName/cabinet/institution/department
3. merge les candidats les plus recents

## 4. Contrats de donnees

### 4.1 Anchor (couche on-chain)

Structure conceptuelle:
1. `recordId`: id logique
2. `hash`: hash canonique
3. `cid`: adresse IPFS
4. `ownerWallet`
5. `doctorWallet`
6. `pharmacyWallet` optionnel
7. `authorizedWallets`
8. `status`: PRESCRIBED | DELIVERED | CANCELLED
9. `createdAt`, `updatedAt`

### 4.2 Event chain

Chaque mutation metier peut produire un event avec:
1. `eventId`
2. `recordId`
3. `eventType`
4. `actorWallet`
5. `txHash` (local simulated id)
6. `blockNumber` (timestamp-based pseudo block)
7. `timestamp`
8. `status`
9. `hash`
10. `cid`

### 4.3 Payload ordonnance (IPFS)

Champs usuels:
1. `ordonnanceText`
2. `medications`
3. `instructions`

Peut etre:
1. plain JSON
2. encrypted envelope `msce-aes-256-gcm-v1`

### 4.4 Payload evenement medical (IPFS)

Schema courant `msce-medical-event-v1`:
1. `eventDomain`: VISIT | LAB_RESULT | MEDICAL_ACT
2. `eventType`
3. `patientWallet`
4. `details`
5. `amountClaim`
6. `sourceDocumentCid` (si document associe)
7. `actorWallet`
8. `actorRole`
9. `createdAt`

Selon type:
- visite: diagnosis, notes
- labo: testType, resultSummary
- hopital: operationName/department/details

### 4.5 Claim model (frontend override store)

Les claims sont maintenus dans `localStorage` (key `msc_claim_overrides_v1`) avec:
1. `status`: PENDING | APPROVED | REJECTED | REIMBURSED
2. `sourceType`: PRESCRIPTION | VISIT | OPERATION | LAB_TEST
3. `sourceId`
4. `patientWallet`
5. `providerWallet`
6. `amountRequested`
7. `amountApproved`
8. `reason`
9. `paymentReference`
10. `verification`

### 4.6 Profil patient local

Stocke dans `localStorage` key `msc_patient_profiles_v1`:
1. `primaryDoctorWallet`
2. `bloodType`
3. `age`
4. `diseases`
5. `region`

### 4.7 Session

Key `msc_session`:
1. `token`
2. `walletAddress`
3. `role`
4. `identity`

## 5. Interface on-chain active (ink!)

Couche d acces principale:
1. `frontend/src/lib/chainContract.ts`

Transactions majeures:
1. `store_anchor`
2. `mark_delivered`
3. `cancel_record`
4. `grant_access` / `revoke_access`
5. `submit_claim` / `review_claim` / `mark_claim_reimbursed`

Queries majeures:
1. `get_anchor` / `list_record_ids`
2. `get_claim` / `list_claim_ids`
3. `can_read`
4. `verify_hash`
5. `encryption_key_of`

### 5.1 Semantique d erreur runtime

Mapping principal:
1. `contracts.ContractReverted`: logique metier rejetee (Unauthorized/InvalidTransition/...)
2. `Contract call rejected ...`: erreur detectee en phase estimate/query avant signature
3. erreurs decodees cote frontend en messages metier explicites (ex: delivrance non autorisee)

### 5.2 Reference legacy Rust API (compatibilite)

La couche `smart-contracts/src/bin/blockchain_api.rs` reste utile pour migration/tests historiques,
mais n est plus le chemin runtime principal du mode decentralise actuel.

## 6. API facade locale frontend (detail)

La facade `frontend/src/lib/api.ts` expose des routes logiques cote client.

### 6.1 Prescriptions

1. `GET /prescriptions`
- role session requis
- filtre anchors prescriptions
- applique ACL role-based

2. `GET /prescriptions/:recordId`
- verifie acces
- lit CID IPFS
- gere content states:
  - PENDING_IPFS
  - ENCRYPTED_LOCKED
  - DECRYPTED
  - PLAIN_IPFS
  - UNAVAILABLE

3. `GET /prescriptions/:recordId/scan`
- verification rapide cote pharmacie

4. `POST /prescriptions/:recordId/deliver`
- role PHARMACIE
- appel `markDeliveredOnChain(recordId)` avec le wallet session
- policy on-chain active:
  - si `pharmacyWallet` est assigne dans l ancre, seule cette pharmacie peut delivrer
  - si `pharmacyWallet` est null, toute pharmacie peut delivrer
- persiste montant delivrance pour claims
- tente de stocker un receipt anchor `receipt:<recordId>`

5. `POST /prescriptions/:recordId/cancel`
- roles PATIENT ou MEDECIN
- cancel via contrat

### 6.2 Records patient

`GET /records/patient/:wallet`
- enforce access relation (owner/admin/assurance/relation wallet)
- agrege events + ordonnances
- exclut anchors system

### 6.3 Medical events

1. `GET /medical-events/mine`
- reconstruit visites/lab/operations depuis anchors `event:*`
- recalcule hash payload vs anchor hash
- expose `blockchainVerified`

2. `POST /medical-events/visit`
- roles MEDECIN/HOPITAL
- ancre event VISIT

3. `POST /hopital/events`
- roles HOPITAL/MEDECIN
- refuse eventDomain VISIT/LAB_RESULT ici
- ancre MEDICAL_ACT

4. `POST /labo/results`
- roles LABO/HOPITAL/MEDECIN
- ancre LAB_RESULT

### 6.4 Claims

1. `GET /claims`
- role PATIENT: own
- role ASSURANCE: all queue

2. `POST /claims/prescriptions/:recordId`
- role PATIENT
- ordonnance doit etre DELIVERED ou USED
- amount fallback depuis receipt anchor si absent

3. `POST /claims/events/:eventId`
- role PATIENT
- source doit etre event
- amountClaim > 0 obligatoire

4. `PATCH /claims/:claimId/review`
- role ASSURANCE
- decision APPROVED/REJECTED

5. `POST /claims/:claimId/reimburse`
- role ASSURANCE
- claim doit etre APPROVED
- genere paymentReference

### 6.5 Admin

1. `GET /admin/users`
- role ADMIN
- inventorie wallets depuis anchors
- resolve role/identity
- scope region si non-global admin

2. `POST /admin/users`
- role ADMIN
- assign role via anchor `mongo:walletroles:*`

3. `DELETE /admin/users`
- role ADMIN
- revoke via anchor role revoked

4. `PATCH /admin/users/institution`
- role ADMIN
- met a jour institution/department via anchor governance

5. `PATCH /admin/users/approval`
- role ADMIN
- approval medecin

### 6.6 Auth/profile local

`PATCH /auth/relink-doctor`
- update `primaryDoctorWallet` dans profile local

## 7. Role matrix (operationnelle)

PATIENT:
1. lire ses ordonnances
2. reclamer remboursements
3. changer medecin traitant
4. lire ses events

MEDECIN:
1. creer ordonnances
2. creer visites
3. creer actes hopital (si role HOPITAL aussi)
4. cancel ordonnance autorisee

PHARMACIE:
1. scanner et verifier ordonnances
2. delivrer ordonnances
3. consulter contenu ordonnance selon ACL

HOPITAL:
1. creer actes MEDICAL_ACT
2. peut aussi creer VISIT selon endpoint autorise

LABO:
1. creer resultats LAB_RESULT

ASSURANCE:
1. consulter claims
2. review approve/reject
3. reimburse approved

ADMIN:
1. gouvernance role/approval/institution
2. scope region selon isGlobalAdmin

## 8. Securite detaillee

### 8.1 Wallet et signature

Au login:
1. connect wallet extension
2. signer challenge message local
3. resoudre role via anchors
4. imposer completion profile minimal (nom, prenom, age)

### 8.2 Signed request model dans facade

Pour routes `signed: true`:
1. generation nonce local
2. calcul bodyHash canonical
3. signature du message
4. enforcement coherence wallet/session

### 8.3 Chiffrement

Impl en `frontend/src/lib/medicalCrypto.ts`:
1. PBKDF2 SHA-256 derive key
2. AES-GCM encrypt/decrypt
3. envelope base64

### 8.4 Integrite hash

1. canonicalize deterministic JSON
2. SHA-256 hex
3. compare local payload hash vs anchor hash

### 8.5 ACL anchors

Decision d acces typique:
1. owner
2. doctor
3. pharmacy (si assignee)
4. authorizedWallets
5. admin/assurance privileged read paths selon logique facade

## 9. Lifecycle states

### 9.1 Prescription

Transitions valides:
1. PRESCRIBED -> DELIVERED
2. PRESCRIBED -> CANCELLED

Transitions invalides:
1. DELIVERED -> CANCELLED
2. CANCELLED -> DELIVERED
3. double deliver

### 9.2 Claim

Lifecycle:
1. PENDING
2. APPROVED | REJECTED
3. REIMBURSED (seulement depuis APPROVED)

## 10. Persistance detaillee

### 10.1 Rust snapshot (mode legacy)

Fichier:
- `smart-contracts/data/blockchain_state.json` (par defaut)

Contenu:
1. anchors
2. meta
3. events

### 10.2 Browser localStorage

Keys principales:
1. `msc_session`
2. `msc_wallet_roles_v1`
3. `msc_patient_profiles_v1`
4. `msc_claim_overrides_v1`

Impact:
- claims/profiles sont locaux navigateur
- comportement multi-device non synchronise sans migration

## 11. Variables d environnement

### 11.1 Frontend

Required:
1. `NEXT_PUBLIC_CHAIN_WS_URL`
2. `NEXT_PUBLIC_CONTRACT_ADDRESS`
3. `NEXT_PUBLIC_CONTRACT_METADATA_URL`
4. `NEXT_PUBLIC_IPFS_API_URL`
5. `NEXT_PUBLIC_IPFS_GATEWAY_URL`
6. `NEXT_PUBLIC_IPFS_API_TOKEN`

Recommended:
1. `NEXT_PUBLIC_ADMIN_WALLETS`
2. `NEXT_PUBLIC_NO_BACKEND=true`

Optional fallback:
1. `NEXT_PUBLIC_BLOCKCHAIN_API_URL` (mode legacy)
2. `NEXT_PUBLIC_API_URL`

### 11.2 Node contracts / toolchain

1. node websocket actif (par defaut `ws://127.0.0.1:9944`)
2. `cargo-contract` installe pour deploy local
3. extension wallet Polkadot.js disponible cote navigateur

## 12. Runbook exploitation

### 12.1 Demarrage

Node contracts (persistant) :

```bash
mkdir -p ./blockchain-data
substrate-contracts-node --dev -d ./blockchain-data
```

*(Note: Evitez le flag `--tmp` si vous souhaitez conserver les donnees du contrat entre les redemarrages)*

Deploy contrat (local dev) :

Un script automatique est fourni pour gerer le build, le deploy et la mise a jour de l'environnement frontend.

```bash
./deploy-contract.sh
```

Notes importantes:
1. Le script mettra a jour automatiquement `NEXT_PUBLIC_CONTRACT_ADDRESS` dans `.env.local`
2. Le script copiera automatiquement la metadata `frontend/public/contracts/medical_anchors_contract.json`

Frontend:

```bash
cd frontend
npm install
npm run dev
```

### 12.2 Health checks

```bash
ss -ltn | grep 9944
cd frontend && grep NEXT_PUBLIC_CONTRACT_ADDRESS .env.local
cd frontend && test -f public/contracts/medical_anchors_contract.json && echo "metadata ok"
```

### 12.3 Smoke tests fonctionnels

1. login wallet + role resolve
2. create ordonnance medecin
3. scan/deliver pharmacie
4. claim patient
5. review/reimburse assurance
6. create/read event hopital/labo

## 13. Scripts migration

Scripts presentes:
1. `scripts/migrate_mongo_to_ipfs.py`
2. `scripts/migrate_all_mongo_to_ipfs.py`
3. `scripts/migrate_ipfs_to_blockchain.py`

Installation deps:

```bash
python3 -m pip install --user requests pymongo
```

Dry-run example:

```bash
set -a && source frontend/.env.local && set +a
python3 scripts/migrate_all_mongo_to_ipfs.py --dry-run
```

## 14. Diagnostic guide

### 14.1 "anchor not found"

Verifier:
1. recordId exact
2. `NEXT_PUBLIC_CONTRACT_ADDRESS` pointe sur le bon contrat
3. ancre lisible via query on-chain (`get_anchor`)

### 14.2 "caller not authorized" deliver

Verifier:
1. adresse wallet de la session pharmacie active
2. si ancre assignee: `pharmacyWallet` doit matcher le caller
3. si ancre non assignee: deploy adresse contrat mise a jour (policy ouverte)
4. message decode cote frontend: `Unauthorized` vs `InvalidTransition`

### 14.3 Echec build contrat (`panic_immediate_abort`)

Contexte observe:
1. certaines combinaisons `cargo-contract`/Rust recentes echouent pendant la generation complete des artifacts
2. impact principal: build `.contract` peut etre bloquee

Contournement local:
1. utiliser un artifact `.wasm` valide
2. instancier avec `cargo contract instantiate ... --salt <hex>`
3. conserver la metadata JSON frontend a jour

### 14.4 PDF/Document non lisible

Verifier:
1. CID accessible
2. payload encrypted ou plain
3. passphrase correcte
4. gateway reachable

### 14.5 Montant claim a 0

Verifier:
1. totalAmount envoye a deliver
2. receipt anchor cree
3. fallback amount depuis receipt

### 14.6 Role mal resolu

Verifier:
1. anchors governance `mongo:walletroles:*`
2. IPFS doc lisible
3. fallback inference

## 15. Limites connues

1. node local `substrate-contracts-node --dev --tmp` est ephemere par nature
2. tx_hash/block_number simules
3. claims/profiles stores localement navigateur
4. presence de routes/fallbacks legacy pour compatibilite

## 16. Recommandations pro

1. passer claims/profiles en persistence partagee
2. ajouter tests E2E par role
3. verrouiller schema validation end-to-end
4. renforcer observabilite (logs structure, metrics)
5. definir process de rotation secrets/tokens

## 17. Checklist release branche ipfs

1. docs relues et coherentes
2. aucun secret dans fichiers trackes
3. lint frontend execute
4. smoke tests metiers passes
5. adresse contrat et metadata frontend valides
6. diff git propre (pas de fichiers patch temporaires)

## 18. Changelog documentation

2026-04-17:
1. restauration d un niveau de detail professionnel
2. alignement strict avec code runtime actuel
3. ajout matrices role, ACL, lifecycle, runbook et diagnostics
4. policy pharmacie: delivrance ouverte pour ordonnances non assignees
5. runbook deploy ink! precise (salt + mise a jour contract address)

## 19. Mecanique interne detaillee (niveau professionnel)

### 19.1 Algorithme de login wallet (frontend)

Implementation cle: `frontend/src/app/login/page.tsx`

Ordre exact de traitement:
1. `connectWallet()` recupere wallet actif du provider.
2. Appel de `/api/role/resolve/:wallet` pour role runtime.
3. Si wallet dans `NEXT_PUBLIC_ADMIN_WALLETS`, override role en ADMIN.
4. Si aucun role et `anchorsCount == 0`, fallback role PATIENT.
5. Signature challenge local `MaSanteEnChaine Local Login`.
6. Appel `/api/identity/resolve/:wallet` pour nom/cabinet/institution.
7. Verification profil minimal: prenom, nom, age.
8. Si incomplet: blocage navigation + formulaire completion obligatoire.
9. Si complet: creation session locale (`msc_session`) puis redirect dashboard role.

Points de controle critiques:
1. Protection contre mismatch wallet/session.
2. Role cache fallback local only si resolver non autoritaire.
3. Completion profil forcee avant acces dashboard.

### 19.2 Algorithme de role resolve (API route)

Implementation cle: `frontend/src/app/api/role/resolve/[wallet]/route.ts`

Sources de verite par priorite:
1. Wallets forces admin (env)
2. Cache memoire in-process (TTL 2 minutes)
3. Anchors `mongo:walletroles:*` du wallet
4. Fallback parse recordId si document IPFS indisponible
5. Anchors legacy `mongo:walletidentities:*` / `mongo:users:*`
6. Inference comportementale (owner/pharmacy/doctor)

Comportement en cas d IPFS lent:
1. tente fetch document role avec timeout court
2. si echec, derive role depuis le `recordId`
3. assigne cache court (fallback) pour eviter incoherence longue

Champs retour enrichis:
1. `role`
2. `source`
3. `region`
4. `isGlobalAdmin`
5. `anchorsCount`

### 19.3 Algorithme identity resolve

Implementation cle: `frontend/src/app/api/identity/resolve/[wallet]/route.ts`

Traitement:
1. liste anchors identite lies au wallet cible
2. tri du plus recent au plus ancien
3. fetch docs IPFS (timeout)
4. extraction multi-cle (fullName, first/last, cabinet, institution, department)
5. merge progressif jusqu a avoir set identite utile

Resultat:
1. `fullName`
2. `cabinetName`
3. `institutionName`
4. `departmentName`
5. `source`

### 19.4 Algorithme creation d ancre medicale

Chemin type (visite, labo, hopital):
1. verifier role autorise
2. normaliser champs obligatoires
3. construire payload medical (`msce-medical-event-v1`)
4. upload payload vers IPFS
5. calcul hash canonique (`bodyDigest`)
6. appel `storeAnchorOnChain(...)` -> tx `store_anchor`
7. invalidation cache lecture anchors/claims cote frontend

Garanties:
1. hash immuable cote anchor
2. CID immutable reference
3. event journal pour audit

### 19.5 Algorithme delivrance pharmacie (cas le plus sensible)

Implementation cle: `frontend/src/lib/api.ts` route `POST /prescriptions/:recordId/deliver`

Etapes detaillees:
1. verification role PHARMACIE
2. lecture anchor courant
3. verification ACL facade (`canAccessAnchor`)
4. appel on-chain unique `markDeliveredOnChain(recordId)` avec le wallet session
5. policy contrat:
  - ancre assignee -> seule la pharmacie assignee delivre
  - ancre non assignee -> toute pharmacie peut delivrer
6. au succes, statut passe `DELIVERED` sur contrat
7. extraction montant delivre (`totalAmount`) avec normalisation stricte
8. tentative de creation receipt IPFS + anchor `receipt:<recordId>` (kind `OTHER`)
9. si receipt fail, ne pas rollback la delivrance (best effort)

Pourquoi ce design:
1. aligner strictement la policy metier (pharmacies autorisees sur ordonnances non assignees)
2. eviter les boucles de signatures dues a des retries caller multiples
3. garder trace monetaire pour assurance

### 19.6 Algorithme claims (prescription + events)

Source de verite claims:
1. anchors on-chain (ink!) pour etat medical
2. `msc_claim_overrides_v1` pour etat assurance

Construction claims:
1. scanner prescriptions anchorees
2. filtrer celles marquees `requested`
3. reconstruire montant (override puis fallback receipt)
4. injecter verification metadata
5. ajouter event claims (VISIT/OPERATION/LAB_TEST)
6. appliquer filtre statut

Regle cle montant:
1. montant prioritaire = override local
2. sinon lecture `receipt:<recordId>` sur IPFS
3. sinon `0`

## 20. Contrats HTTP detail (payloads exemples)

### 20.1 Rust `POST /anchors/store`

Request example:

```json
{
  "recordId": "event:6db8f9b5-9c53-46d4-a420-0a31f4385e6b",
  "hash": "f9d2b2e41f6f0f1112b8f7f6f4f4f0a1d9c8e7b1a4d32c2f61f61d0f8a0f1173",
  "cid": "bafybeihxxxxxxxxxxxxxxxxxxxx",
  "ownerWallet": "0xPATIENT",
  "doctorWallet": "0xMEDECIN",
  "pharmacyWallet": null,
  "authorizedWallets": ["0xMEDECIN", "0xPATIENT"],
  "timestamp": 1776381800
}
```

Response example:

```json
{
  "anchor": {
    "recordId": "event:6db8f9b5-9c53-46d4-a420-0a31f4385e6b",
    "hash": "f9d2b2e41f6f0f1112b8f7f6f4f4f0a1d9c8e7b1a4d32c2f61f61d0f8a0f1173",
    "cid": "bafybeihxxxxxxxxxxxxxxxxxxxx",
    "ownerWallet": "0xPATIENT",
    "doctorWallet": "0xMEDECIN",
    "pharmacyWallet": null,
    "authorizedWallets": ["0xMEDECIN", "0xPATIENT"],
    "status": "PRESCRIBED",
    "txHash": "tx-event:6db8f9b5-9c53-46d4-a420-0a31f4385e6b-1776381800",
    "blockNumber": 1776381800,
    "createdAt": "2026-04-17T10:56:40+00:00",
    "updatedAt": "2026-04-17T10:56:40+00:00"
  }
}
```

### 20.2 Frontend facade `POST /medical-events/visit`

Request example:

```json
{
  "patientWallet": "0xPATIENT",
  "diagnosis": "Infection ORL",
  "notes": "Repos 5 jours, hydratation",
  "amountClaim": 350,
  "documentCid": "bafybeipdfcidexample"
}
```

Response example:

```json
{
  "eventId": "event:5f8bced9-a47f-4c6e-bdd7-cc058383dfad"
}
```

### 20.3 Frontend facade `POST /prescriptions/:recordId/deliver`

Request example:

```json
{
  "totalAmount": "200"
}
```

Response example:

```json
{
  "status": "DELIVERED"
}
```

### 20.4 Frontend facade `PATCH /claims/:claimId/review`

Request example:

```json
{
  "decision": "APPROVED",
  "amountApproved": 180,
  "reason": "Ticket conforme au contrat"
}
```

Response example:

```json
{
  "ok": true
}
```

## 21. Gouvernance et identites (anchors system)

Record families a connaitre:
1. `mongo:walletroles:*` roles et approbations
2. `mongo:walletidentities:*` identites migrées
3. `mongo:users:*` legacy users migrés
4. `receipt:*` tickets de delivrance pharmacie

Exemple recordId role:
`mongo:walletroles:0xabc:1776382000:MEDECIN:ACTIVE`

Flags possibles:
1. `REVOKED` pour retrait
2. `GLOBAL` pour admin global

## 22. ACL detaillee par operation sensible

`store_anchor` (tx contrat):
1. valid payload
2. wallet fields non vides
3. recordId unique

`mark_delivered` (tx contrat):
1. ordonnance existante
2. non deja delivree/cancellee
3. caller autorise selon policy contrat (assignee stricte, sinon ouverte)

`cancel_record` (tx contrat):
1. ordonnance existante
2. caller autorise (owner/doctor selon contrat)
3. non deja finalisee

`/records/patient/:wallet` (facade):
1. PATIENT doit etre owner
2. roles tiers doivent prouver relation anchor
3. ADMIN/SUB_ADMIN/ASSURANCE bypass relation stricte

## 23. Observabilite et audit

### 23.1 Evenements exploitables

Event types generes:
1. `ANCHOR_STORED`
2. `ACCESS_GRANTED`
3. `ACCESS_REVOKED`
4. `PRESCRIPTION_DELIVERED`
5. `PRESCRIPTION_CANCELLED`

### 23.2 Sources de diagnostic

1. logs frontend (decode erreurs runtime contrat)
2. retour des queries/tx dans `frontend/src/lib/chainContract.ts`
3. events node Substrate contracts pendant les extrinsics
4. comparaison hash local vs hash ancre pour integrite

### 23.3 Strategie incident

1. isoler recordId impacte
2. verifier anchor et statut
3. verifier event timeline
4. verifier disponibilite CID IPFS
5. verifier coherence montant claim/receipt

## 24. Cas limites et comportement attendu

1. CID `pending:*`:
- lecture ordonnance retourne `PENDING_IPFS`
- UI doit informer qu un upload IPFS final est requis

2. IPFS indisponible:
- endpoints de lecture retournent fallback `UNAVAILABLE` ou payload partiel
- aucune mutation d ancre ne doit corrompre etat Rust

3. Role non resolu avec anchors existants:
- `role-anchor-unresolved`
- login bloque attribution automatique agressive

4. Multi-role wallet sans anchor role explicite:
- fallback priorise PATIENT si wallet owner + doctor

5. Echec receipt post-delivery:
- delivrance reste valide
- montant peut rester a 0 tant qu aucun receipt lisible

## 25. Hardening recommande (priorise)

P1 (immediat):
1. signer et verifier cryptographiquement les requests cote serveur
2. remplacer claims localStorage par store partage serveur
3. ajouter anti-replay robuste (nonce persistant)

P2 (court terme):
1. validation schema stricte sur tous payloads IPFS
2. chiffrement de documents binaires avec metadata explicite
3. journal securite dedie (auth, role, access changes)

P3 (moyen terme):
1. event bus/indexer pour analytics assurance
2. rotation et gouvernance de clef chiffrement
3. strategie backup/restore et tests de reprise complete

## 26. Definition de done documentaire (niveau professionnel)

Une mise a jour est consideree complete seulement si:
1. chaque endpoint modifie est reflechi dans cette doc
2. les payload examples sont mis a jour
3. les ACL et transitions de statut sont reconciliees
4. le runbook incident couvre les nouveaux cas d erreur
5. la checklist release est validee avant push

## 27. Donnees stockees: IPFS vs Blockchain (detail exact)

### 27.1 Ce qui est stocke sur IPFS (off-chain)

Le systeme stocke sur IPFS des JSON metiers, pas les etats de transition du contrat.

Familles de payloads IPFS actives:
1. Ordonnances (`schema: msce-prescription-v2`)
2. Evenements medicaux (`schema: msce-medical-event-v2`)
3. Tickets de delivrance (`schema: msce-prescription-delivery-v2`)
4. Documents gouvernance role wallet (assign/revoke/approval)
5. Profils wallet utilisateur (`schema: msce-wallet-profile-v1`)
6. Documents binaires encapsules (PDF encode en base64 dans JSON) pour labo/hopital

Exemple payload ordonnance (avant chiffrement):
1. `schema`
2. `patientWallet`
3. `doctorWallet`
4. `ordonnanceText`
5. `medications`
6. `instructions`
7. `createdAt`

Exemple payload evenement VISIT:
1. `schema`
2. `eventDomain` (`VISIT`)
3. `eventType`
4. `visitKind`
5. `patientWallet`
6. `diagnosis`
7. `notes`
8. `details`
9. `amountClaim`
10. `sourceDocumentCid` (optionnel)
11. `actorWallet`
12. `actorRole`
13. `createdAt`

Exemple payload receipt pharmacie:
1. `schema`
2. `sourceRecordId`
3. `totalAmount`
4. `deliveredAt`
5. `deliveredByWallet`

Mode chiffrement IPFS (payload final ecrit):
1. enveloppe `msce-hybrid-aesgcm-v2`
2. `algorithm: AES-GCM`
3. `ivB64`
4. `ciphertextB64`
5. `payloadHashHex`
6. `encryptedKeys[]` (slots par wallet destinataire):
7. `walletAddress`
8. `senderPublicKeyHex`
9. `nonceB64`
10. `encryptedDataKeyB64`

Mode degrade IPFS (si cle chiffrement indisponible):
1. upload en JSON plain possible
2. champ `security.mode = PLAIN_IPFS_FALLBACK`
3. raisons observees:
4. `CONTRACT_UNAVAILABLE`
5. `KEY_REGISTRATION_RATE_LIMIT`
6. `KEY_REGISTRATION_STORAGE_DEPOSIT_LIMIT`
7. `MISSING_RECIPIENT_ENCRYPTION_KEY`

Important:
1. IPFS stocke le contenu fonctionnel (medical, gouvernance, profile), pas la logique d autorisation.
2. Le CID peut etre temporairement `pending:*` (fallback) avant upload final.

### 27.2 Ce qui est stocke sur la blockchain (on-chain, ink!)

Le smart contract stocke l etat canonique minimal et auditable.

Structures on-chain principales:
1. `records: Mapping<RecordId, Anchor>`
2. `record_index: Vec<RecordId>`
3. `claims: Mapping<ClaimId, Claim>`
4. `claim_index: Vec<ClaimId>`
5. `access: Mapping<(RecordId, AccountId), bool>`
6. `encryption_keys: Mapping<AccountId, [u8;32]>`

Contenu d un `Anchor` on-chain:
1. `kind` (`Prescription`, `Visit`, `LabResult`, `Operation`, `Other`)
2. `cid` (bytes du CID IPFS)
3. `data_hash` (`Hash32` du payload)
4. `owner`
5. `doctor`
6. `pharmacy` (optionnel)
7. `insurer` (optionnel)
8. `status` (`Prescribed`, `Delivered`, `Cancelled`)
9. `created_at`
10. `updated_at`

Contenu d un `Claim` on-chain:
1. `source_record_id`
2. `claimant`
3. `insurer`
4. `amount_requested`
5. `amount_approved` (optionnel)
6. `status` (`Pending`, `Approved`, `Rejected`, `Reimbursed`)
7. `reason_hash` (optionnel)
8. `payment_ref_hash` (optionnel)
9. `created_at`
10. `updated_at`

Cles de chiffrement on-chain:
1. une cle publique 32 bytes par wallet
2. ecrite par `register_encryption_key`
3. lue par `encryption_key_of`

Ce qui est emit en events on-chain:
1. `AnchorStored`
2. `AccessGranted`
3. `AccessRevoked`
4. `RecordStatusChanged`
5. `ClaimSubmitted`
6. `ClaimReviewed`
7. `ClaimReimbursed`
8. `EncryptionKeyRegistered`

### 27.3 Ce qui n est PAS stocke on-chain

1. Texte medical complet (`ordonnanceText`, `diagnosis`, `notes`, etc.)
2. PDF bruts et base64
3. Donnees d identite detaillees (nom complet, etc.) sauf si indirectement en doc IPFS reference
4. Session navigateur
5. Etats UI transitoires

### 27.4 Mapping concret IPFS -> blockchain

Pour une creation d evenement medical:
1. payload JSON (chiffre ou plain) ecrit sur IPFS -> obtient `CID`
2. hash SHA-256 calcule sur payload final
3. transaction `store_anchor` ecrit sur chain: `record_id`, `kind`, `cid`, `data_hash`, wallets metier, status initial
4. la verification ulterieure se fait via:
5. lecture IPFS par `cid`
6. recalcul hash local
7. comparaison avec `data_hash` on-chain

### 27.5 Resume decisionnel

1. IPFS = donnees metier volumineuses et potentiellement chiffrees
2. Blockchain = preuve, droits, statut, et pointeurs (CID + hash)
3. La coherence est garantie par le couple `cid + data_hash`
