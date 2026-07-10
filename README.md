# Meetday Backend

The API server for Meetday — a host-first IRL social experiences platform.

Built with NestJS (modular monolith), PostgreSQL via Prisma, Redis via Bull, and Firebase Auth.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS (TypeScript) |
| Database | PostgreSQL (via Prisma) |
| Cache / Queues | Redis (via Bull) |
| Authentication | Firebase Admin SDK |
| Payments | Razorpay (upcoming) |
| File Storage | AWS S3 (upcoming) |
| Email | AWS SES (upcoming) |

---

## Prerequisites

- Node.js >= 18
- PostgreSQL instance running (or Docker)
- Redis instance running (or Docker)
- Firebase project with a service account
- `.env` file configured (see below)

---

## Getting Started

### 1. Clone and install

git clone <repo-url>
cd meetday-backend
npm install

### 2. Set up environment variables

cp .env.example .env

Fill in all values in `.env` before proceeding.

### 3. Set up the database

npx prisma migrate dev

### 4. Run the dev server

npm run start:dev

API will be available at: http://localhost:3000
Swagger docs at: http://localhost:3000/api/docs

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_HOST` | Redis host |
| `REDIS_PORT` | Redis port |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email |
| `FIREBASE_PRIVATE_KEY` | Firebase private key (with `\n` line breaks) |
| `PORT` | Server port (default: 3000) |
| `NODE_ENV` | `development` or `production` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins, required in production (e.g. `https://app.meetday.ai,https://admin.meetday.ai`) |

---

## Project Structure

src/
├── app.module.ts
├── main.ts
├── common/             # Shared decorators, guards, filters, interceptors
├── config/             # Typed environment config
├── prisma/             # PrismaService and PrismaModule
└── modules/
    ├── auth/           # Firebase Admin SDK, FirebaseAuthGuard
    ├── users/
    ├── hosts/
    ├── events/
    ├── tickets/
    ├── payments/
    └── admin/

---

## Authentication

All routes are protected by `FirebaseAuthGuard` by default.

- The client must send a valid Firebase ID token in the `Authorization: Bearer <token>` header
- Routes that should be publicly accessible must be decorated with `@Public()`
- The decoded Firebase user (`uid`, `email`) is available in controllers via `@GetUser()`

---

## Development

### Run in watch mode
npm run start:dev

### Lint
npm run lint

### Format
npm run format

### Run tests
npm run test

---

## Branches

| Branch | Purpose |
|---|---|
| `main` | Stable, production-ready code |
| `dev` | Active development |
| `feature/*` | Feature branches, merged into dev |

---

## License

Private — All rights reserved. Meetday / Freeflow.