# Ma Sante en Chaine

Plateforme sante decentralisee orientee tracabilite, ancrage hash/CID et stockage medical chiffre sur IPFS.

## Etat du projet

- Le backend Node.js n est plus present dans ce repository.
- L architecture active repose sur:
1. frontend Next.js (wallet-first, chiffrement local, UX par role)
2. couche Rust blockchain API (anchors, events, droits, statuts)
3. IPFS/Pinata (stockage off-chain des payloads chiffres)

## Architecture active

1. Un acteur se connecte avec wallet dans le frontend.
2. Le frontend chiffre le payload medical puis calcule un hash.
3. Le payload chiffre est uploade sur IPFS et retourne un CID.
4. Le frontend ancre hash + CID dans la Rust API via /anchors/store.
5. Les operations metier (grant/revoke/deliver/cancel) mettent a jour l anchor et les events.
6. L etat Rust est persiste sur disque dans un fichier JSON.

## Prerequis

- Node.js 20+
- npm 10+
- Rust stable + cargo
- Extension wallet Polkadot.js

## Demarrage local

### 1) Lancer la couche Rust

```bash
cd smart-contracts
BLOCKCHAIN_STATE_FILE=data/blockchain_state.json PORT=4600 cargo run --bin blockchain_api
```

### 2) Lancer le frontend

```bash
cd frontend
npm install
npm run dev
```

## Variables frontend minimales

Configurer `frontend/.env.local` avec au moins:

```env
NEXT_PUBLIC_BLOCKCHAIN_API_URL=http://localhost:4600
NEXT_PUBLIC_IPFS_API_URL=https://api.pinata.cloud/pinning
NEXT_PUBLIC_IPFS_GATEWAY_URL=https://gateway.pinata.cloud/ipfs
NEXT_PUBLIC_IPFS_API_TOKEN=replace_with_pinata_jwt
NEXT_PUBLIC_ADMIN_WALLETS=wallet1,wallet2
```

Optionnel:

```env
NEXT_PUBLIC_NO_BACKEND=true
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## Verification rapide

```bash
curl http://localhost:4600/health
curl http://localhost:4600/debug/state
curl http://localhost:4600/anchors
curl http://localhost:4600/events
```

## Documentation du projet

- [documentation.md](documentation.md): reference technique complete
- [ipfs.md](ipfs.md): flux IPFS, chiffrement, verification integrite
- [migrationipfs.md](migrationipfs.md): strategie migration et scripts
- [frontend/README.md](frontend/README.md): guide frontend et variables

## Checklist avant push branche ipfs

1. Verifier que la Rust API demarre sans erreur.
2. Verifier login wallet et resolution role.
3. Verifier create/read/deliver ordonnance.
4. Verifier lecture PDF acte chiffre avec passphrase.
5. Verifier claims patient/assurance.
6. Verifier lint frontend.
7. Relire docs et endpoints exposes.

## Licence

Projet academique. Adapter la licence selon votre politique de publication.
