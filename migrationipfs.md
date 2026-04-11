# Migration IPFS - Plan Full Decentralized (4 jours)

## Objectif
Passer de l architecture actuelle (frontend + backend Node.js + MongoDB + bridge blockchain) vers une architecture full decentralized:
- Frontend wallet-first
- Smart contracts comme source de verite
- Donnees medicales chiffrees sur IPFS
- Plus de backend Node.js pour la logique metier critique

Ce document decrit:
1. Comment approcher la migration
2. Comment IPFS fonctionne dans ce systeme
3. Comment interagir avec le backend pendant la transition
4. Comment organiser le travail sur une branche Git `ipfs`
5. Un plan execution sur 4 jours

---

## Architecture cible

### Avant
- Frontend Next.js
- Backend Node.js (auth, validation, routes)
- MongoDB (ordonnances, dossiers, claims)
- Service blockchain (mock/remote)

### Apres (cible)
- Frontend Next.js + wallet
- Smart contracts (ordonnances, statuts, droits, claims)
- IPFS (stockage des payloads medicaux chiffrees)
- Indexation decentralisee (option recommandee: The Graph ou indexer maison)
- Aucune dependance MongoDB pour les workflows critiques

---

## Comment IPFS va marcher

## 1) Ecriture d une ordonnance
1. Le medecin remplit le formulaire dans le frontend.
2. Le frontend construit un payload canonique.
3. Le payload est chiffre cote client (jamais en clair sur IPFS).
4. Le frontend calcule un hash (SHA-256) du payload canonique/chiffre.
5. Le frontend upload le document chiffre sur IPFS -> obtient un CID.
6. Le frontend envoie une transaction au smart contract avec:
   - recordId
   - patientWallet
   - doctorWallet
   - cid
   - hash
   - metadata minimale (version, timestamp)
7. Le smart contract emet un event.

Resultat:
- IPFS garde le contenu chiffre
- La blockchain garde preuve d integrite + ownership + status

## 2) Lecture d une ordonnance
1. Le frontend lit le CID et le hash depuis le smart contract.
2. Il recupere le document sur IPFS via le CID.
3. Il recalcule le hash localement.
4. Il compare avec le hash on-chain.
5. Si identique: dechiffrement local et affichage.

## 3) Livraison pharmacie
1. Pharmacie soumet transaction `deliverPrescription(recordId, totalAmount)`.
2. Contrat verifie autorisation et statut.
3. Statut passe a `DELIVERED`.
4. Event emitted pour indexation/UI.

## 4) Claim assurance
1. Patient soumet claim on-chain reference a `recordId`.
2. Assurance review on-chain (APPROVED/REJECTED).
3. Paiement/reimbursement trace via event/tx.

---

## Comment ca interagit avec le backend

## Etat final (full decentralized)
- Backend Node.js n est plus requis pour:
  - create/read/update de prescriptions
  - verification d integrite
  - claims assurance
- Le frontend parle directement a:
  - RPC blockchain (via wallet)
  - IPFS gateway/API

## Etat transition (4 jours)
Pendant la migration, on peut garder un backend minimal temporaire pour:
- servir les assets et pages
- eventuellement proxy IPFS (si besoin)
- healthcheck

Puis suppression progressive des routes metier Node.js.

Important:
- Si le prof demande strictement full decentralized a la demo, il faut presenter le flow principal sans backend metier.

---

## Strategie Git (branche ipfs)

## 1) Creer la branche
```bash
git checkout -b ipfs
```

## 2) Regle de travail
- Tout le dev migration se fait sur `ipfs`
- Pas de modification directe sur `main`
- Commits petits et atomiques

## 3) Exemple de commits
1. `chore(ipfs): add architecture docs and env for web3/ipfs`
2. `feat(contracts): add prescription cid/hash anchoring`
3. `feat(front): add wallet direct contract calls`
4. `feat(front): add ipfs upload/download with encryption`
5. `feat(front): replace backend claim flow by on-chain flow`
6. `chore(cleanup): disable nodejs prescription routes`

## 4) Protection
- Tag avant merge: `pre-ipfs-migration`
- PR de `ipfs` vers `main` seulement apres demo/tests

---

## Plan execution 4 jours

## Jour 1 - Base technique
Objectif: preparer fondation blockchain + ipfs sans casser le projet.

Taches:
1. Definir schema on-chain minimal:
   - recordId, cid, hash, owner, doctor, pharmacy, status, timestamps
2. Adapter/etendre smart contracts Rust pour inclure `cid`.
3. Ajouter events necessaires pour dashboard.
4. Integrer client IPFS (upload/download) dans frontend.
5. Ajouter module crypto frontend (encrypt/decrypt + hash).

Definition of done:
- Contrat compile
- Une transaction de test cree une ordonnance avec cid/hash
- Un document chiffre est uploade et lisible via CID

## Jour 2 - Flow ordonnance complet
Objectif: remplacer le flow backend ordonnance par flow frontend->chain/ipfs.

Taches:
1. Creation ordonnance: frontend direct wallet + ipfs + tx.
2. Consultation ordonnance: read on-chain + fetch ipfs + verify hash + decrypt.
3. Delivery pharmacie: tx status `DELIVERED`.
4. UI status mapping alignee on-chain.

Definition of done:
- Patient voit ordonnance creee sans appel route Node.js metier
- Pharmacie peut livrer et statut change on-chain

## Jour 3 - Claims assurance + migration data
Objectif: brancher remboursement et migrer donnees existantes.

Taches:
1. Claims on-chain (create/review/reimburse) ou version simplifiee demo.
2. Script migration Mongo -> IPFS + ancrage on-chain.
3. Verification integrity post-migration (hash check).
4. Dashboard assurance base sur events/index.

Definition of done:
- Au moins un dossier migré completement et remboursable via nouveau flow

## Jour 4 - Stabilisation demo
Objectif: fiabiliser, nettoyer, documenter.

Taches:
1. Supprimer/neutraliser routes Node.js metier non utilisees.
2. Tests E2E demo:
   - create ordonnance
   - deliver
   - claim
   - review
3. Gerer erreurs UX (wallet reject, tx failed, ipfs timeout).
4. Finaliser documentation + scripts demo.

Definition of done:
- Demo fluide sans backend metier critique
- README migration clair pour soutenance

---

## Mapping logique actuelle -> logique decentralisee

1. `PrescriptionRecord` Mongo
-> Smart contract state + CID IPFS

2. `dataHash` backend
-> Hash calcule cote client + verifie on-chain

3. `blockchainService` backend
-> Web3 client direct dans frontend

4. `claims` backend routes
-> Fonctions smart contract claims + events

5. `verifyHash` API backend
-> Verification locale frontend contre valeur on-chain

---

## Checklist technique minimale

1. Chiffrement cote client obligatoire
2. Hash deterministic (meme canonicalization partout)
3. CID stocke on-chain
4. Status on-chain: `PRESCRIBED`, `DELIVERED`, `CANCELLED`
5. Access control on-chain (owner/authorized)
6. Event schema stable pour indexation
7. Plan de fallback IPFS gateway
8. Script de migration idempotent

---

## Risques et mitigations

1. Risque: fuite de donnees medicales
- Mitigation: jamais stocker en clair, chiffrer avant IPFS

2. Risque: incoherence hash
- Mitigation: canonicalization unique + tests vectors

3. Risque: latence blockchain
- Mitigation: UI etats transaction (pending/success/fail)

4. Risque: indisponibilite IPFS publique
- Mitigation: pinning service + gateway secondaire

5. Risque: scope trop large pour 4 jours
- Mitigation: MVP strict sur ordonnance + delivery + claim simple

---

## MVP demo recommande (si temps serre)

Inclure seulement:
1. Create ordonnance on-chain avec cid/hash
2. Read + verify + decrypt
3. Delivery pharmacie
4. Claim patient + review assurance simplifiee

Reporter apres demo:
- analytics avances
- suppression totale de tout backend utilitaire
- optimisation UX profonde

---

## Commandes utiles

```bash
# Nouvelle branche de migration
git checkout -b ipfs

# Sauvegarder et pousser rapidement
git add .
git commit -m "chore(ipfs): bootstrap decentralized migration"
git push -u origin ipfs
```

---

## Conclusion
Oui, c est faisable en 4 jours pour une version demo solide, en gardant la logique actuelle mais en deplacant:
- la persistance vers IPFS
- la verite metier vers smart contracts
- l orchestration vers le frontend wallet-first

La cle est de garder un scope strict, livrer un MVP complet, puis iterer.

---

## Validation Jour 1 (check rapide)

## 1) Contrat compile
```bash
cd smart-contracts
cargo check
```

## 2) Transaction de test avec cid + hash
```bash
curl -s -X POST http://localhost:4600/anchors/store \
   -H "Content-Type: application/json" \
   -d '{
      "recordId":"test-ipfs-001",
      "hash":"4e2b5c0f6f0a5b5f0d7fd7ec9f4da4c50853d87495d3f91ef39db8f468ca4d56",
      "cid":"bafybeigdyrzt5examplecidforordonnance000001",
      "ownerWallet":"patient-wallet-001",
      "doctorWallet":"doctor-wallet-001",
      "pharmacyWallet":"pharmacy-wallet-001",
      "authorizedWallets":["doctor-wallet-001","pharmacy-wallet-001"],
      "timestamp":1712851200
   }' | jq
```

Puis verifier:
```bash
curl -s http://localhost:4600/anchors/test-ipfs-001 | jq
curl -s http://localhost:4600/events/test-ipfs-001 | jq
```

## 3) Upload JSON chiffre sur IPFS puis lecture par CID
Utiliser le module frontend:
- `frontend/src/lib/medicalCrypto.ts`
- `frontend/src/lib/ipfsClient.ts`

Pseudo-flow:
1. `encryptMedicalPayload(payload, passphrase)`
2. `sha256HexFromObject(encryptedPayload)`
3. `uploadJsonToIpfs(encryptedPayload)` -> retourne `cid`
4. `downloadJsonFromIpfs(cid)` pour relire
5. compare hash local vs hash ancre
