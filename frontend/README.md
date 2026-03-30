# Frontend - Ma Sante en Chaine

Next.js client for secure wallet authentication and prescription lifecycle actions.

## Features

- Wallet login with nonce challenge and message signature
- JWT session storage for authenticated API calls
- Signed sensitive requests (`x-msce-*` headers)
- Doctor flow: create immutable prescription versions
- Pharmacy flow: verify and deliver prescriptions
- Patient flow: grant/revoke access to prescription records
- Admin flow: assign/revoke wallet roles

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure API endpoint:

```bash
echo "NEXT_PUBLIC_API_URL=http://localhost:4000" > .env.local
```

3. Run frontend:

```bash
npm run dev
```

4. Open:

- http://localhost:3000

## Wallet Requirement

Use the Polkadot.js browser extension to sign login and request messages.

To access admin dashboard:

- Ensure backend `ADMIN_WALLETS` contains your wallet address.
- Login via `/login` (role auto-detected from backend role registry).
- Open `/dashboard/admin`.
