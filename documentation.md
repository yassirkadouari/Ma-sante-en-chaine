# Journal de Developpement - Ma Sante en Chaine
*Equipe du projet : Yassir kadouari, Marouane ismaili , Ahmed Amr et Matine elkasbiji*

Ce fichier sert de sommaire technique et de preuve de mise a jour du projet.

## Journal rapide (maj)

| Date | Action | Fichiers touches |
| --- | --- | --- |
| 05 Mars 2026 | Architecture initiale (frontend/backend/smart-contracts) | documentation.md |
| 05 Mars 2026 | Modele Ordonnance Rust + UI roles | smart-contracts/ordonnance.rs, frontend/src/app |
| 12 Mars 2026 | API events + hashing + verification | backend/src/models, backend/src/routes, backend/src/utils |
| 12 Mars 2026 | Taxonomie events + POC wallet | backend/src/config, frontend/src/app/login/page.tsx |

## Etape 1 : Initialisation de l'architecture (05 Mars 2026)
But : mettre un socle clair avec separation stricte des couches et du flux de donnees.

- Mise en place d'un mono-repo decoupe en trois domaines :
  - frontend/ : UI Next.js, routing App Router, styles Tailwind.
  - backend/ : API REST Node.js, persistance MongoDB, logique off-chain.
  - smart-contracts/ : modeles Rust pour les preuves on-chain.
- Intention technique : isoler UI, API et couche on-chain pour limiter le coupling et preparer un passage Substrate propre.

## Etape 2 : Developpement du Smart Contract "Ordonnance" (05 Mars 2026)
But : poser une base de logique d'etat (state machine) et un comportement deterministe.

- Fichier cible : smart-contracts/ordonnance.rs
- Structure : Ordonnance { hash_id, hash_patient, hash_medecin, date_emission, statut }
- Enum StatutOrdonnance : Active, Utilisee, Annulee
- emettre_ordonnance() : creation atomique avec statut Active.
- marquer_comme_utilisee() : guard clauses contre double delivrance (verification de statut avant mutation).
- Valeur technique : un automate d'etat minimal qui interdit la reutilisation si le statut est deja Utilisee.

## Etape 3 : Execution de l'Interface Visuelle (05 Mars 2026)
But : avoir un parcours UX complet, meme en mode demo, pour tester les roles.

- Stack : Next.js (App Router), TypeScript, TailwindCSS.
- Routing role-based : patient, medecin, pharmacie, assurance, hopital.
- Page d'accueil : entrées par role, UI de type console.
- Dashboards : ecrans de demonstration par role.
- Raison : stabiliser l'UX avant l'integration web3 complete.

## Etape 4 : Base technique des preuves medicales (12 Mars 2026)
But : sortir du modele ordonnance-only et aller vers un event ledger medical generique.

### 4.1 API REST et persistance
- API Express avec JSON body parsing et CORS.
- MongoDB via Mongoose (strictQuery active).
- Schema MedicalEvent minimal :
  - patientId, actorId, actorRole
  - eventType, eventData
  - occurredAt
  - hash + chainProof

### 4.2 Canonicalisation et hashing
- Utilitaire de hashing canonique : tri des cles JSON, suppression des undefined.
- Hash SHA-256 hex pour empreinte deterministe.
- Interet : eviter les collisions logiques liees a l'ordre des cles.

### 4.3 Verification locale
- Endpoint /events/:id/verify :
  - Recalcul du hash a partir d'un payload canonique.
  - Comparaison stricte avec la valeur stockee.
  - Verdict binaire (valid true/false).

## Etape 5 : Restructuration metier et POC wallet (12 Mars 2026)
But : verrouiller la taxonomie et preparer l'ancrage on-chain sans l'implanter a 100%.

### 5.1 Taxonomie stricte des evenements
- Liste ferme eventType :
  VISITE, DIAGNOSTIC, ANALYSE, IMAGERIE, ORDONNANCE, HOSPITALISATION, INTERVENTION, REMBOURSEMENT.
- Liste ferme actorRole :
  PATIENT, MEDECIN, PHARMACIE, HOPITAL, LABO, ASSURANCE, ANAM.
- Benefice : coherence semantique + auditabilite native.

### 5.2 Versionnage des preuves
- eventVersion et hashVersion integres au schema.
- Objectif : evolution du format sans casser la verification historique.

### 5.3 Consentement et audit minimal
- Bloc consent : required, grantedBy, grantedAt, method.
- Bloc audit : createdByWallet, createdByRole, sourceIp.
- Objectif : tracer l'origine et le mode d'autorisation d'un event.

### 5.4 Stub d'ancrage on-chain
- Endpoint /events/:id/anchor :
  - Simule l'ancrage (txHash, blockNumber, status=ANCHORED).
  - Placeholder pour l'integration Substrate.

### 5.5 Wallet-only POC (frontend)
- Bouton CONNECT_WALLET sur l'ecran login.
- Integration Polkadot.js Extension (injectedWeb3) : detection, enable, fetch accounts.
- Redirection vers dashboard role apres connexion.
- Note : POC uniquement, pas encore de signature challenge serveur.

## Etat actuel (synthese technique)
- Backend : creation d'events, hashing canonique, verification locale, stub d'ancrage.
- Frontend : parcours role-based + POC wallet.
- On-chain : modele Rust present, integration Substrate a faire.

## Prochaines etapes (plan technique)
1) Pipeline asynchrone DB -> queue -> ancrage on-chain (idempotence, retries).
2) Pallet Substrate minimal (storage proofs, extrinsic submit_event_proof).
3) Verification on-chain par comparaison de hash (local vs ancre).
4) Signature challenge wallet + session securisee (auth sans password).
5) Alignement complet avec cahier des charges (audit ANAM, remboursements auto).
