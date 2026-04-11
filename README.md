# Ma Sante en Chaine

Systeme de sante decentralise axe sur la tracabilite medicale, l ancrage blockchain et le stockage IPFS chiffre.

## Etat actuel

Le backend Node.js a ete retire du repository.

Architecture active:
1. `frontend/`: Next.js (wallet-first, chiffrement local, integration IPFS)
2. `smart-contracts/`: logique Rust + API bridge anchors/events

## Documents importants

1. [ipfs.md](ipfs.md): implementation IPFS, chiffrement, hashage, plan suppression backend
2. [migrationipfs.md](migrationipfs.md): planning de migration full decentralized
3. [documentation.md](documentation.md): reference technique (sections backend marquees legacy)

## Lancer le frontend

```bash
cd frontend
npm install
npm run dev
```

## Lancer la couche Rust

```bash
cd smart-contracts
cargo run --bin blockchain_api
```

## Variables frontend IPFS (Pinata)

```env
NEXT_PUBLIC_IPFS_API_URL=https://api.pinata.cloud/pinning
NEXT_PUBLIC_IPFS_GATEWAY_URL=https://gateway.pinata.cloud/ipfs
NEXT_PUBLIC_IPFS_API_TOKEN=your_pinata_jwt
```

## Notes

1. La couche Rust est actuellement en memoire (etat non persistant apres restart).
2. Le frontend migre progressivement vers appels directs blockchain + IPFS.
3. Les anciens flux backend sont en cours de remplacement complet.
