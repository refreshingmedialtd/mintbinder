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

The real app foundation lives in [src/](src/). The UI hydrates through local API routes, writes collection and wishlist changes through Prisma-backed handlers when a database is configured, and falls back to typed sample data when no database connection is active. The Operations screen can run controlled catalogue/pricing import jobs when you provide `JOB_SECRET`.

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
npm run test:billing
npm run test:jobs
npm run test:notifications
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
AUTH_URL="http://127.0.0.1:3000"
AUTH_TRUST_HOST="true"
NEXT_PUBLIC_APP_URL="http://127.0.0.1:3000"
STRIPE_SECRET_KEY=""
STRIPE_PLUS_MONTHLY_PRICE_ID=""
STRIPE_PLUS_YEARLY_PRICE_ID=""
STRIPE_WEBHOOK_SECRET=""
JOB_SECRET=""
RESEND_API_KEY=""
EMAIL_FROM="PokeStop <alerts@example.com>"
POKEMON_TCG_API_KEY=""
POKEMON_TCG_QUERY=""
POKEMON_TCG_USD_TO_GBP_RATE=""
POKEMON_TCG_EUR_TO_GBP_RATE=""
TCGCSV_SEALED_GROUP_IDS=""
TCGCSV_SEALED_GROUP_LIMIT=""
TCGCSV_USD_TO_GBP_RATE=""
TCGCSV_SEALED_PRICE_ONLY_UNPRICED="true"
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
- `PATCH /api/collection-items/:id`: updates owned item details and records an edit event for the signed-in user.
- `DELETE /api/collection-items/:id`: archives an owned item and records a remove event for the signed-in user.
- `POST /api/collection-items/:id/sale`: records a sale and removes the lot from active collection.
- `POST /api/wishlist-items`: creates or returns a wishlist item for the signed-in user.
- `DELETE /api/wishlist-items?id=...`: removes a wishlist item for the signed-in user.
- `GET/PATCH /api/notification-preferences`: reads or updates user email alert preferences.
- `GET /api/alerts/price`: returns Plus-gated price alert insights.
- `GET /api/reports/insurance`: exports a Plus-gated insurance-style HTML report.
- `POST /api/billing/checkout`: creates a Stripe subscription Checkout session when Stripe env vars are configured.
- `POST /api/billing/portal`: creates a Stripe billing portal session for users with a Stripe customer.
- `POST /api/billing/webhook`: verifies Stripe webhook signatures and syncs Plus subscription status.
- `POST /api/jobs/price-alerts`: sends or dry-runs Plus price alert email digests behind `JOB_SECRET`.
- `POST /api/jobs/catalogue-refresh`: imports card catalogue pages from the Pokemon TCG API behind `JOB_SECRET`.
- `POST /api/jobs/pricing-refresh`: imports Pokemon TCG API prices as GBP snapshots behind `JOB_SECRET`.
- `GET /api/jobs/catalogue-status`: reports local catalogue counts, import coverage, duplicate provider ID health, and the next broad-import page behind `JOB_SECRET`.
- `GET /api/jobs/runs`: returns recent job run records behind `JOB_SECRET`.

## Jobs and Integrations

Stripe webhook fulfillment expects events for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`. The webhook URL is:

```text
https://your-domain.example/api/billing/webhook
```

Job routes accept either `Authorization: Bearer <JOB_SECRET>` or `x-job-secret: <JOB_SECRET>`. The in-app Operations screen is visible to admin users only, and the job secret is still required before any import or alert job can run. Each successful authenticated job request creates a `job_runs` record with input, result, status, timing, and errors. Catalogue and pricing refreshes accept `page`, `pageSize`, `q`, and `maxPages`; `maxPages` is capped at 20 per job so broad backfills can be resumed in controlled batches. Pricing refreshes convert Pokemon TCG API USD prices into GBP snapshots with `POKEMON_TCG_USD_TO_GBP_RATE`; when `POKEMON_TCG_EUR_TO_GBP_RATE` is also set, cards without TCGPlayer prices can fall back to embedded Cardmarket EUR prices. Keep conversion rates current before running pricing jobs.

For a first controlled card import, open Operations, enter `JOB_SECRET`, choose a preset or keep the default query `set.id:sv3pt5`, and run Catalogue with a small page size. Review the job result and recent run before increasing page count or switching to Pricing.

For broader catalogue backfills, leave the query blank or use a broad Pokemon TCG API filter, set `pageSize` to `250`, and run small `maxPages` batches. If the result returns `nextPage`, set Page to that value or use the Operations resume control before continuing.

For local command-line backfills, set `JOB_SECRET`, `POKEMON_TCG_IMPORT_PAGE`, `POKEMON_TCG_IMPORT_PAGE_SIZE`, and `POKEMON_TCG_IMPORT_MAX_PAGES`, then run `npm run job:catalogue-batch`. Use `POKEMON_TCG_IMPORT_PAGE=auto` to resume from the latest matching catalogue-status page. The helper starts the built app, runs one catalogue job, prints the JSON result, and stops the server.

Use `npm run report:catalogue-gaps` to check local catalogue health, set-level count gaps, duplicate Pokemon TCG provider IDs, and pricing coverage. For command-line pricing refreshes, set `JOB_SECRET`, `POKEMON_TCG_USD_TO_GBP_RATE`, `POKEMON_TCG_PRICING_PAGE`, `POKEMON_TCG_PRICING_PAGE_SIZE`, `POKEMON_TCG_PRICING_MAX_PAGES`, and optionally `POKEMON_TCG_PRICING_QUERY`, then run `npm run job:pricing-batch`. Set `POKEMON_TCG_EUR_TO_GBP_RATE` to enable Cardmarket fallback prices and `POKEMON_TCG_PRICE_ONLY_UNPRICED=true` when enriching sparse segments without duplicating existing snapshots.

For sealed product catalogue imports, run `npm run job:sealed-tcgcsv`. The importer reads TCGCSV's cached TCGplayer Pokemon groups/products/prices, matches groups to local card sets, filters sealed products, and writes sealed-product price snapshots. Set `TCGCSV_SEALED_GROUP_IDS` to a comma-separated list of TCGplayer group IDs for a smaller import, `TCGCSV_USD_TO_GBP_RATE` to override the Pokemon USD rate, and `TCGCSV_SEALED_PRICE_ONLY_UNPRICED=true` to enrich only products that do not already have sealed prices.

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

The next logical step is a real admin console for monitoring catalogue/pricing job runs and running controlled imports.
