# Diagnostic Technique : Problème d'Affichage des Données (Dashboard Vide)

## Le Problème Racine
Le problème de "Dashboard vide" (ordonnances, visites ou rôles qui ne s'affichent pas) n'est pas dû à une perte de données, mais à une **incohérence de casse (majuscules/minuscules)** dans les adresses wallets.

### Analyse
Dans le code original, les comparaisons d'adresses sont **strictes** (ex: `5H9b...` !== `5h9b...`).
1.  **L'extension Polkadot.js** renvoie souvent l'adresse avec un format de casse spécifique (ex: SS58 avec majuscules).
2.  **Le Smart Contract ou IPFS** peut avoir stocké l'adresse en minuscules (si elle a été saisie manuellement ou transformée par un script).
3.  **Le code original** fait : `normalizeWallet(addr1) === normalizeWallet(addr2)`. Comme `normalizeWallet` ne fait qu'un `.trim()`, la comparaison échoue si la casse diffère.

## Correctifs Appliqués
Pour résoudre ce problème sans imposer une normalisation globale (qui pourrait casser d'autres parties du projet), j'ai appliqué des **comparaisons insensibles à la casse** aux endroits critiques :

### 1. Affichage des Ordonnances (`api.ts`)
La fonction `canAccessAnchor` a été modifiée pour comparer les adresses en minuscules :
```typescript
const owner = normalizeWallet(anchor.ownerWallet).toLowerCase();
const current = normalizeWallet(session.walletAddress).toLowerCase();
return owner === current; // Fonctionne même si l'un est en majuscule et l'autre non
```

### 2. Détection des Rôles (`onchainIdentity.ts`)
La boucle qui scanne la blockchain pour trouver votre rôle d'Admin ou de Médecin utilise maintenant aussi `.toLowerCase()`. Cela permet de retrouver votre identité même si elle a été enregistrée avec un format de casse différent sur la blockchain.

### 3. Réclamations et Evénements Médicaux (`api.ts`)
Toutes les routes `/medical-events/mine` et `/claims/*` ont été mises à jour pour utiliser cette comparaison flexible.

## Recommandations
Si des données manquent encore :
1.  **Vérifiez l'adresse dans l'extension** : Assurez-vous que c'est bien le wallet utilisé pour créer les données.
2.  **Nettoyage ponctuel** : Si vous avez changé de version de nœud blockchain, assurez-vous que `NEXT_PUBLIC_CONTRACT_ADDRESS` est à jour.
