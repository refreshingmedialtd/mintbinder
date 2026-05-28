# PokeStop

PokeStop is a working title for a Pokemon card and sealed product collection tracking app. The project now has a Next.js app foundation plus the original planning docs and static prototype.

## Planning Docs

- [PROJECT_BRIEF.md](PROJECT_BRIEF.md): product vision, users, monetization, risks, and roadmap.
- [MVP_SPEC.md](MVP_SPEC.md): MVP scope, screens, user flows, and build milestones.
- [DATA_MODEL.md](DATA_MODEL.md): database model, relationships, constraints, enums, and valuation rules.
- [ARCHITECTURE.md](ARCHITECTURE.md): recommended stack, app layers, API surface, entitlements, jobs, and deployment strategy.
- [UX_WIREFRAMES.md](UX_WIREFRAMES.md): navigation, screen wireframes, user flows, states, and prototype scope.

## Current Technical Direction

- Web/PWA first.
- Next.js with TypeScript.
- PostgreSQL.
- Prisma.
- Auth.js or managed auth, depending on speed versus independence.
- Stripe for subscriptions.
- Provider-agnostic catalogue and pricing integrations.

## Next.js App

The real app foundation lives in [src/](src/). The UI hydrates through local API routes, writes collection and wishlist changes through Prisma-backed handlers when a database is configured, and falls back to typed sample data when no database connection is active.

Run it locally:

```sh
npm run dev
```

Then open:

```text
http://127.0.0.1:3000/
```

Useful checks:

```sh
npm run typecheck
npm run lint
npm run build
npm audit --audit-level=moderate
```

## Database

The Prisma schema lives in [prisma/schema.prisma](prisma/schema.prisma), migrations live in [prisma/migrations/](prisma/migrations/), and seed data lives in [prisma/seed.mjs](prisma/seed.mjs).

Before running database commands, create a local `.env` from [.env.example](.env.example) and set `DATABASE_URL` to your PostgreSQL database.

For a simple local Windows setup, install PostgreSQL 17 and create the `pokestop` database:

```sh
winget install --id PostgreSQL.PostgreSQL.17 --source winget
createdb -h 127.0.0.1 -p 5432 -U postgres pokestop
```

Use this local development connection string:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pokestop?schema=public"
AUTH_SECRET="replace-with-a-random-32-byte-secret"
```

Useful commands:

```sh
npm run db:validate
npm run db:generate
npm run db:migrate -- --name init
npm run db:seed
```

The local sign-in flow uses Auth.js credentials with scrypt-hashed passwords. The seeded demo account is:

```text
Email: liam@example.com
Password: PokeStop2026!
```

Creating an account from the sign-in screen creates a new collector profile with an empty collection against the same global catalogue.

## API Routes

- `GET /api/app-data`: returns catalogue, collection, wishlist, set progress, and data-source status for the signed-in user.
- `POST /api/collection-items`: creates a collection item and matching collection event for the signed-in user.
- `POST /api/wishlist-items`: creates or returns a wishlist item for the signed-in user.
- `DELETE /api/wishlist-items?id=...`: removes a wishlist item for the signed-in user.

## Static Prototype

The first static clickable prototype lives in [prototype/](prototype/). It is retained as a reference artifact.

Run it locally:

```sh
node prototype/server.mjs --port 8095
```

Then open:

```text
http://127.0.0.1:8095/
```

## Next Step

The next logical step is account hardening: password reset, email verification, rate limiting, and optional OAuth or magic-link sign-in.
