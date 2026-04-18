# Ma Sante en Chaine

Plateforme santé décentralisée orientée traçabilité, ancrage cryptographique (Hash/CID) et stockage médical chiffré sur IPFS.

## État du projet

- Le backend Node.js classique ainsi que l'API Rust legacy ont été remplacés.
- L'architecture 100% Web3 active repose sur :
  1. **Frontend Next.js** (wallet-first, chiffrement local, UX par rôle, logique métier décentralisée).
  2. **Smart Contract ink!** sur un nœud **Substrate Contracts** (gestion des ancres, événements, droits d'accès, cycles de vie des claims).
  3. **IPFS/Pinata** (stockage off-chain des dossiers médicaux chiffrés).

## Architecture active

1. Un acteur se connecte avec son wallet (Polkadot.js) dans le frontend.
2. Le frontend chiffre le payload médical localement (AES-GCM), puis calcule son Hash (SHA-256).
3. Le payload chiffré est uploadé sur IPFS et retourne un CID.
4. Le frontend ancre le couple Hash + CID de façon immuable dans le Smart Contract.
5. Les opérations métier (grant/revoke/deliver/claim) appellent les fonctions du contrat ink!.
6. L'état du contrat est persisté dans le nœud local Substrate.

## Prérequis

- Node.js 20+
- npm 10+
- Rust stable + toolchain WebAssembly
- [cargo-contract](https://github.com/paritytech/cargo-contract) (outil de compilation ink!)
- [substrate-contracts-node](https://github.com/paritytech/substrate-contracts-node) (le nœud blockchain de développement)
- Extension wallet navigateur (Polkadot.js, Talisman, ou SubWallet)

---

## Démarrage local

Pour lancer l'application complètement, suivez ces 3 étapes :

### 1) Lancer le nœud Blockchain (Substrate)

Ouvrez un terminal et lancez un nœud blockchain persistant :

```bash
mkdir -p ./blockchain-data
substrate-contracts-node --dev -d ./blockchain-data
```

*(Laissez ce terminal ouvert en arrière-plan. L'état sera sauvegardé dans le dossier `blockchain-data`)*

### 2) Déployer le Smart Contract

Ouvrez un nouveau terminal à la racine du projet et exécutez le script d'automatisation :

```bash
./deploy-contract.sh
```

Ce script va automatiquement :
- Compiler le contrat ink!
- Le déployer sur votre nœud local.
- Mettre à jour l'adresse dans `frontend/.env.local`.
- Copier la metadata JSON au bon endroit pour le frontend.

### 3) Lancer le Frontend

```bash
cd frontend
npm install
npm run dev
```

L'application est maintenant disponible sur [http://localhost:3000](http://localhost:3000).

---

## Variables d'environnement

Le fichier `frontend/.env.local` est généré/modifié par le script de déploiement. Il doit contenir :

```env
# Configuration Blockchain
NEXT_PUBLIC_CHAIN_WS_URL=ws://127.0.0.1:9944
NEXT_PUBLIC_CONTRACT_ADDRESS=votre_adresse_de_contrat_generee
NEXT_PUBLIC_CONTRACT_METADATA_URL=/contracts/medical_anchors_contract.json

# Configuration IPFS (Pinata)
NEXT_PUBLIC_IPFS_API_URL=https://api.pinata.cloud/pinning
NEXT_PUBLIC_IPFS_GATEWAY_URL=https://gateway.pinata.cloud/ipfs
NEXT_PUBLIC_IPFS_API_TOKEN=votre_token_jwt_pinata

# Configuration Application
NEXT_PUBLIC_ADMIN_WALLETS=5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
```

---

## Documentation du projet

- [documentation.md](documentation.md) : référence technique complète et détaillée.
- [ipfs.md](ipfs.md) : flux IPFS, chiffrement local, vérification d'intégrité.
- [frontend/README.md](frontend/README.md) : guide spécifique au frontend.

## Licence

Projet académique. Adapter la licence selon votre politique de publication.
