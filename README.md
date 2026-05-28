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

The real app foundation lives in [src/](src/). It currently uses typed sample data and frontend state while the backend/auth/database work is still pending.

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

The next logical step is connecting the app foundation to persistence: Prisma, PostgreSQL schema, and collection/catalogue seed data.
