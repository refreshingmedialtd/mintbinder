# PokeStop

PokeStop is a working title for a Pokemon card and sealed product collection tracking app. The project is currently in planning, with app code intentionally deferred until the product, data model, and architecture are clear.

## Planning Docs

- [PROJECT_BRIEF.md](PROJECT_BRIEF.md): product vision, users, monetization, risks, and roadmap.
- [MVP_SPEC.md](MVP_SPEC.md): MVP scope, screens, user flows, and build milestones.
- [DATA_MODEL.md](DATA_MODEL.md): database model, relationships, constraints, enums, and valuation rules.
- [ARCHITECTURE.md](ARCHITECTURE.md): recommended stack, app layers, API surface, entitlements, jobs, and deployment strategy.

## Current Technical Direction

- Web/PWA first.
- Next.js with TypeScript.
- PostgreSQL.
- Prisma.
- Auth.js or managed auth, depending on speed versus independence.
- Stripe for subscriptions.
- Provider-agnostic catalogue and pricing integrations.

## Next Step

The next logical step is UX planning: define the first clickable screen flow for dashboard, collection, add item, set progress, wishlist, and the Plus analytics gate.

