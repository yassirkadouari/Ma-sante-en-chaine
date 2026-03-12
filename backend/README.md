# Backend - Ma Sante en Chaine

Minimal API for medical event hashing and storage.

## Setup

1. Copy environment file:

```
cp .env.example .env
```

2. Install dependencies:

```
npm install
```

3. Run the API:

```
npm start
```

## Endpoints

- `GET /health`
- `GET /events/types`
- `POST /events`
- `GET /events/:id`
- `POST /events/:id/verify`
- `POST /events/:id/anchor`
