# Mint Binder

Mint Binder is a Pokemon card and sealed product collection tracking app. The project now has a Next.js app foundation plus the original planning docs and static prototype.

## Planning Docs

- [PROJECT_BRIEF.md](PROJECT_BRIEF.md): product vision, users, monetization, risks, and roadmap.
- [MVP_SPEC.md](MVP_SPEC.md): MVP scope, screens, user flows, and build milestones.
- [DATA_MODEL.md](DATA_MODEL.md): database model, relationships, constraints, enums, and valuation rules.
- [ARCHITECTURE.md](ARCHITECTURE.md): recommended stack, app layers, API surface, entitlements, jobs, and deployment strategy.
- [UX_WIREFRAMES.md](UX_WIREFRAMES.md): navigation, screen wireframes, user flows, states, and prototype scope.
- [LAUNCH_READINESS.md](LAUNCH_READINESS.md): current completion estimate, remaining launch tasks, beta gates, and recommended order of work.
- [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md): staging/production deployment runbook, env checklist, and launch smoke order.

## Current Technical Direction

- Web/PWA first.
- Next.js with TypeScript.
- PostgreSQL.
- Prisma.
- Auth.js or managed auth, depending on speed versus independence.
- Square for subscriptions, with Stripe retained as an optional fallback provider.
- Provider-agnostic catalogue and pricing integrations.

## PWA Behaviour

Mint Binder can be installed from a supporting browser. The manifest includes dedicated 192px, 512px, maskable, and Apple touch icons derived from the canonical `src/app/icon.svg` artwork. Installed layouts account for display cut-outs and home indicators.

The service worker deliberately caches only versioned Next.js static assets, the manifest, icons, and a small offline page. API responses, authenticated HTML, collection data, and billing pages are never written to its cache. Navigation remains network-first and falls back to the offline page only when the server cannot be reached or returns a server error. A newly installed worker waits until existing tabs close before taking control so a collection or billing session is not replaced mid-flow.

`robots.txt` is a static Next.js public asset rather than a metadata route, avoiding the production host's previous route-discovery failure.

## Next.js App

The real app foundation lives in [src/](src/). The UI hydrates through local API routes, writes collection and wishlist changes through Prisma-backed handlers when a database is configured, and falls back to typed sample data when no database connection is active. Item detail views show valuation source, observed date, saved valuation notes, and recent price history when snapshots are available. Plus analytics includes a portfolio-wide value path built from dated market snapshots and manual estimates. Add/edit flows offer guided variant choices from imported Pokemon TCG metadata and variant-labelled price snapshots. Alerts explain target hits, watch-band prices, and weak-confidence refreshes. The Operations screen can run controlled catalogue/pricing import jobs, variant metadata repair, and card or sealed image repairs when you provide `JOB_SECRET`.

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
npm test
npm run ci
npm run typecheck
npm run lint
npm run test:admin-qa
npm run test:beta-qa
npm run test:billing
npm run test:jobs
npm run test:notifications
npm run test:price-history
npm run test:pricecharting-sealed
npm run test:tcgcsv-card-pricing
npm run build
npm run qa:beta
npm run qa:admin
npm run qa:operations
npm run qa:production-env
npm run qa:square-activation
npm run job:price-alerts
npm run job:production-bootstrap
npm run job:production-set-bootstrap
npm audit --audit-level=moderate
```

## Database

The Prisma schema lives in [prisma/schema.prisma](prisma/schema.prisma), migrations live in [prisma/migrations/](prisma/migrations/), and seed data lives in [prisma/seed.mjs](prisma/seed.mjs).

Before running database commands, create a local `.env` from [.env.example](.env.example) and set `DATABASE_URL` to your PostgreSQL database.

For a simple local Windows setup, install PostgreSQL 17 and create the `mintbinder` database:

```sh
winget install --id PostgreSQL.PostgreSQL.17 --source winget
createdb -h 127.0.0.1 -p 5432 -U postgres mintbinder
```

Use this local development connection string:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/mintbinder?schema=public"
AUTH_SECRET="replace-with-a-random-32-byte-secret"
AUTH_URL="http://127.0.0.1:3000"
AUTH_TRUST_HOST="true"
NEXT_PUBLIC_APP_URL="http://127.0.0.1:3000"
BILLING_PROVIDER="square"
SQUARE_ENVIRONMENT="sandbox"
SQUARE_ACCESS_TOKEN=""
SQUARE_LOCATION_ID=""
SQUARE_WEBHOOK_SUBSCRIPTION_ID=""
SQUARE_WEBHOOK_SIGNATURE_KEY=""
SQUARE_WEBHOOK_NOTIFICATION_URL="http://127.0.0.1:3000/api/billing/webhook/square"
SQUARE_PAYMENT_CORRELATION_VERIFIED="false"
SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID=""
SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID=""
SQUARE_PLUS_MONTHLY_AMOUNT_MINOR="249"
SQUARE_PLUS_YEARLY_AMOUNT_MINOR="1999"
SQUARE_CURRENCY="GBP"
SQUARE_CUSTOMER_PORTAL_URL=""
STRIPE_SECRET_KEY=""
STRIPE_PLUS_MONTHLY_PRICE_ID=""
STRIPE_PLUS_YEARLY_PRICE_ID=""
STRIPE_WEBHOOK_SECRET=""
JOB_SECRET=""
SCHEDULED_JOB_APP_URL=""
ADMIN_EMAIL="liam@refreshing.media"
ADMIN_QA_EMAIL="liam@refreshing.media"
EMAIL_PROVIDER="smtp"
EMAIL_FROM="Mint Binder <alerts@mintbinder.co.uk>"
EMAIL_SMOKE_TO=""
EMAIL_SMOKE_SUBJECT=""
SMTP_HOST="smtp.stackmail.com"
SMTP_PORT="465"
SMTP_SECURE="true"
SMTP_USER="alerts@mintbinder.co.uk"
SMTP_PASSWORD=""
RESEND_API_KEY=""
PRICE_ALERT_DIGEST_DRY_RUN="true"
PRICE_ALERT_DIGEST_NOW=""
PRICE_ALERT_DIGEST_TEST_RECIPIENT=""
PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS="false"
OPERATIONS_QA_NETWORK_REPAIRS="false"
POKEMON_TCG_API_KEY=""
POKEMON_TCG_QUERY=""
EXCHANGE_RATES_PROVIDER="frankfurter"
EXCHANGE_RATES_API_URL="https://api.frankfurter.app/latest"
EXCHANGE_RATES_AUTO="true"
EXCHANGE_RATES_ALLOW_ENV_FALLBACK="true"
POKEMON_TCG_USD_TO_GBP_RATE=""
POKEMON_TCG_EUR_TO_GBP_RATE=""
POKEMON_TCG_PRICING_PAGE="auto"
POKEMON_TCG_PRICING_PAGE_SIZE="250"
POKEMON_TCG_PRICING_MAX_PAGES="5"
POKEMON_TCG_PRICING_REQUEST_MAX_PAGES="1"
POKEMON_TCG_PRICING_BATCH_WAIT_MS="1500"
POKEMON_TCG_API_TIMEOUT_MS="15000"
POKEMON_TCG_API_RETRY_ATTEMPTS="3"
POKEMON_TCG_API_RETRY_WAIT_MS="1500"
POKEMON_TCG_PRICING_QUERIES=""
BOOTSTRAP_PAGE_SIZE="50"
BOOTSTRAP_MAX_PAGES_PER_JOB="10"
BOOTSTRAP_MAX_JOBS="50"
BOOTSTRAP_SET_LIMIT=""
BOOTSTRAP_SET_PAGE_SIZE="250"
BOOTSTRAP_SET_ONLY_MISSING="true"
BOOTSTRAP_SET_ONLY_UNPRICED="false"
BOOTSTRAP_SET_MIN_UNPRICED="1"
BOOTSTRAP_SET_SKIP_CATALOGUE="false"
BOOTSTRAP_SET_RUN_PRICING="false"
CARD_IMAGE_REPAIR_LIMIT="500"
CARD_IMAGE_REPAIR_DRY_RUN="false"
SEALED_IMAGE_REPAIR_LIMIT="500"
SEALED_IMAGE_REPAIR_DRY_RUN="false"
SEALED_IMAGE_REPAIR_WAIT_MS="120"
VARIANT_METADATA_REPAIR_LIMIT="500"
VARIANT_METADATA_REPAIR_DRY_RUN="false"
VARIANT_METADATA_REPAIR_WAIT_MS="120"
TCGCSV_SEALED_GROUP_IDS=""
TCGCSV_SEALED_GROUP_LIMIT="1"
TCGCSV_USD_TO_GBP_RATE=""
TCGCSV_SEALED_PRICE_ONLY_UNPRICED="false"
TCGCSV_SEALED_WAIT_MS="120"
TCGCSV_SEALED_WRITE_PRICES="true"
TCGDEX_BACKFILL_LANGUAGES="zh-cn,ko"
TCGDEX_BACKFILL_PAGE_SIZE="250"
TCGDEX_BACKFILL_CHUNK_PAGES="2"
TCGDEX_BACKFILL_START_PAGE="1"
TCGDEX_BACKFILL_WAIT_MS="250"
TCGCSV_CARD_GROUP_IDS=""
TCGCSV_CARD_GROUP_LIMIT=""
TCGCSV_CARD_ONLY_UNPRICED_GROUPS="false"
TCGCSV_CARD_MIN_UNPRICED="1"
TCGCSV_CARD_PRICE_ONLY_UNPRICED="true"
TCGCSV_CARD_WRITE_PRICES="true"
TCGCSV_JAPAN_CARD_CATEGORY_ID="85"
TCGCSV_JAPAN_CARD_GROUP_IDS=""
TCGCSV_JAPAN_CARD_GROUP_LIMIT="1"
TCGCSV_JAPAN_CARD_LANGUAGE="ja"
TCGCSV_JAPAN_CARD_MIN_UNPRICED="1"
TCGCSV_JAPAN_CARD_ONLY_UNPRICED_GROUPS="false"
TCGCSV_JAPAN_CARD_PRICE_ONLY_UNPRICED="false"
TCGCSV_JAPAN_CARD_WAIT_MS="120"
TCGCSV_JAPAN_CARD_WRITE_PRICES="true"
TCGCSV_JAPAN_USD_TO_GBP_RATE=""
CARDTRADER_API_TOKEN=""
CARDTRADER_SEALED_ENABLED=""
CARDTRADER_SEALED_SET_LIMIT="1"
CARDTRADER_SEALED_PRODUCT_LIMIT="5"
CARDTRADER_SEALED_PRICE_ONLY_UNPRICED="false"
CARDTRADER_SEALED_WAIT_MS="1000"
CARDTRADER_SEALED_WRITE_PRICES="true"
CARDTRADER_EUR_TO_GBP_RATE=""
CARDTRADER_USD_TO_GBP_RATE=""
PRICECHARTING_API_TOKEN=""
PRICECHARTING_USD_TO_GBP_RATE=""
PRICECHARTING_API_TIMEOUT_MS="10000"
PRICECHARTING_API_RETRY_ATTEMPTS="3"
PRICECHARTING_API_RETRY_WAIT_MS="1500"
PRICECHARTING_GRADED_ENABLED="false"
PRICECHARTING_GRADED_LIMIT="5"
PRICECHARTING_GRADED_WAIT_MS="1100"
PRICECHARTING_GRADED_PRICE_ONLY_UNPRICED="true"
PRICECHARTING_GRADED_WRITE_PRICES="false"
PRICECHARTING_GRADED_ALIASES_JSON=""
PRICECHARTING_SEALED_LIMIT="25"
PRICECHARTING_SEALED_WAIT_MS="1100"
PRICECHARTING_SEALED_PRICE_ONLY_UNPRICED="true"
PRICECHARTING_SEALED_USE_NAME_SEARCH="true"
PRICECHARTING_SEALED_WRITE_PRICES="false"
```

Useful commands:

```sh
npm run db:validate
npm run db:generate
npm run db:migrate -- --name init
npm run db:deploy
npm run qa:admin
```

Use `npm run db:deploy` for staging/production because it applies committed migrations without creating new ones.

The sample collection seed is deliberately disabled by default and refuses to run when `NODE_ENV=production`. To create local-only sample data, set `MINTBINDER_ENABLE_DEV_SEED=true` in your local `.env`, then run `npm run db:seed`. The seed creates a normal user and prints a generated one-time password unless `MINTBINDER_DEMO_PASSWORD` is set locally. Set `MINTBINDER_DEMO_ADMIN=true` only when a local Operations account is specifically required. Never enable or run the demo seed against staging or production; create an account normally and promote the intended operator with `npm run ops:ensure-admin` instead.

`npm run qa:admin` checks the real database-backed admin environment. It verifies required environment variables, configured admin access, subscription and notification rows, core table counts, catalogue media/variant/pricing coverage, duplicate Pokemon TCG provider groups, latest job runs by type, recent job failure counts/details, and pricing exchange-rate configuration.

`npm run qa:operations` starts the production app locally and exercises the protected Operations API surface with `JOB_SECRET`: catalogue status, catalogue gap export, duplicate provider review, job history, and safe dry-run maintenance jobs. Network-backed repair jobs are skipped by default to keep the smoke local and repeatable; set `OPERATIONS_QA_NETWORK_REPAIRS=true` only when deliberately testing provider-backed sealed image or variant metadata repair calls.

## Beta QA

Run `npm run build` before `npm run qa:beta`. The beta smoke starts the production app locally, verifies the app shell, checks auth/session behaviour, confirms protected collection, wishlist, billing, report, notification, and Plus alert routes reject unauthenticated access, and confirms Operations job routes require `JOB_SECRET`. Set `BETA_QA_BASE_URL` to test an already-running local or staging deployment instead of starting a local server.

The local sign-in flow uses Auth.js credentials with scrypt-hashed passwords. Login fields are intentionally empty and no shared demo password is stored in the client or documentation.

Creating an account from the sign-in screen creates a new collector profile with an empty collection against the same global catalogue.

## API Routes

- `GET /api/app-data`: returns app data; newer dashboard loads should prefer `/api/dashboard`.
- `GET /api/dashboard`: returns the lightweight signed-in dashboard payload with only referenced catalogue items.
- `GET /api/catalogue`: returns the full searchable card and sealed-product catalogue for add, set-detail, and admin workflows.
- `GET /api/catalogue/search`: searches, filters, sorts, and paginates catalogue results server-side for Add Item. Pass `limit` (1–100) and `offset` (0–1,000; defaults to 0) alongside the existing `q`, `type`, `set`, `rarity`, `language`, and `sort` filters. The response returns `returned`, exact lookahead-based `hasMore`, `nextOffset`, and `windowExhausted` without running a total-count query; `resultCount` remains as a deprecated alias of `returned` for older clients. Re-send the same filters and sort with `offset=nextOffset` to load more. `nextOffset` is `null` on the final page or when the bounded result window is exhausted; in the latter case `hasMore` and `windowExhausted` are both true, so the UI should ask the collector to narrow the filters.
- `GET /api/admin/beta-status`: returns logged-in admin/owner beta readiness checks, environment safety, catalogue status, and recent job runs.
- `POST /api/collection-items`: creates a collection item and matching collection event for the signed-in user.
- `PATCH /api/collection-items/:id`: updates owned item details and records an edit event for the signed-in user.
- `DELETE /api/collection-items/:id`: archives an owned item and records a remove event for the signed-in user.
- `POST /api/collection-items/:id/sale`: records a sale and removes the lot from active collection.
- `POST /api/wishlist-items`: creates or returns a wishlist item for the signed-in user.
- `DELETE /api/wishlist-items?id=...`: removes a wishlist item for the signed-in user.
- `GET /api/set-goal`: returns the signed-in user's single active set-building goal, or `null`.
- `PUT /api/set-goal`: creates or replaces that goal with `{ cardSetId, targetCompletionPercent?, wishlistPriority? }`. Completion is an integer from 1 to 100 and priority is Low, Medium, High, or Grail.
- `DELETE /api/set-goal`: clears the signed-in user's active goal.
- `POST /api/set-goal/wishlist`: transactionally adds missing cards from the active set to the signed-in user's wishlist. Send `{}` for all missing printings or `{ cardPrintingIds: string[] }` for a selected subset. Requests are limited to 500 unique printings, cards outside the active set are skipped, owned and already-wishlisted cards are not added, and no target price is inferred.
- `GET/PATCH /api/notification-preferences`: reads or updates user email alert preferences.
- `GET /api/alerts/price`: returns Plus-gated price alert insights.
- `GET /api/reports/insurance`: exports a Plus-gated insurance-style HTML report.
- `GET /api/account/export`: downloads the signed-in user's structured account, collection, wishlist, active set goal, binder, preference, and subscription data.
- `DELETE /api/account`: requires password reauthentication and explicit confirmation, cancels supported active billing first, then atomically deletes account-owned data (including the active set goal) plus private or pending-review manual sealed products. Global catalogue contributions are retained with the creator link and free-form notes removed.
- `POST /api/billing/checkout`: creates a Square-hosted Plus subscription checkout link when Square env vars are configured. Set `BILLING_PROVIDER=stripe` to use the retained Stripe fallback.
- `POST /api/billing/portal`: returns a configured Square billing management URL, or creates a Stripe billing portal session when Stripe is the active provider.
- `GET/PATCH /api/billing/subscription`: returns the signed-in user's billing subscription state and, for Square, schedules Plus renewal cancellation while preserving access until the paid period ends.
- `POST /api/billing/webhook/square` and `POST /api/billing/webhook/stripe`: stable provider-specific endpoints that keep existing subscriptions synchronized even when the checkout provider changes. The parent `/api/billing/webhook` remains a signature-header-based transition endpoint.
- `POST /api/jobs/price-alerts`: sends or dry-runs Plus price alert email digests behind `JOB_SECRET`.
- `POST /api/jobs/password-reset-delivery`: claims and delivers queued password-reset messages behind `JOB_SECRET`; uncertain provider outcomes are retained for reconciliation and never retried automatically.
- `POST /api/jobs/email-smoke`: sends one protected production email smoke to `EMAIL_SMOKE_TO` behind `JOB_SECRET`.
- `POST /api/jobs/catalogue-refresh`: imports card catalogue pages from the Pokemon TCG API behind `JOB_SECRET`.
- `POST /api/jobs/card-image-repair`: fills missing Pokemon TCG card image URLs from stored provider IDs behind `JOB_SECRET`.
- `POST /api/jobs/sealed-image-repair`: fills missing TCGCSV sealed product image URLs from stored provider IDs behind `JOB_SECRET`.
- `POST /api/jobs/variant-metadata-repair`: fills missing Pokemon TCG variant metadata from stored provider IDs behind `JOB_SECRET`.
- `POST /api/jobs/pricing-refresh`: imports Pokemon TCG API prices as GBP snapshots behind `JOB_SECRET`.
- `POST /api/jobs/scheduled-pricing`: imports Pokemon TCG API prices using the next page inferred from recent successful pricing runs behind `JOB_SECRET`.
- `POST /api/jobs/sealed-pricing-refresh`: imports TCGCSV sealed products and GBP price snapshots behind `JOB_SECRET`.
- `GET /api/jobs/catalogue-status`: reports local catalogue counts, import coverage, image/variant metadata coverage, duplicate provider ID health, and the next broad-import page behind `JOB_SECRET`.
- `GET /api/jobs/catalogue-gaps`: exports a live JSON catalogue gap report with pricing-source, media, variant metadata, and recommended next-action breakdowns behind `JOB_SECRET`.
- `GET /api/jobs/duplicate-provider-review`: exports duplicate Pokemon TCG provider ID groups and affected card rows behind `JOB_SECRET`.
- `POST /api/jobs/duplicate-card-merge`: dry-runs or executes one reviewed duplicate card merge behind `JOB_SECRET`.
- `GET /api/jobs/runs`: returns recent job run records behind `JOB_SECRET`.

## Jobs and Integrations

Square billing is the default provider. In Square Developer, create or choose a sandbox app, copy its access token, and choose the business location ID. Use `npm run billing:square-plans` to create/reuse the Plus monthly subscription plan variation at GBP 2.49 and the Plus yearly subscription plan variation at GBP 19.99, then add the printed plan variation IDs to `.env`. For local webhook testing without buying a domain, run `npm run build` and then `npm run billing:square-tunnel`. The tunnel helper creates a temporary Cloudflare URL, creates or updates a Square webhook subscription, writes `SQUARE_WEBHOOK_NOTIFICATION_URL`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, and `SQUARE_WEBHOOK_SUBSCRIPTION_ID` to your ignored local `.env`, starts the built app, sends Square's test webhook, and keeps the tunnel open until you press Ctrl+C. Use `npm run billing:square-tunnel -- --once` for a one-shot webhook smoke test that exits after Square's test webhook succeeds. During beta, Square billing management is handled in-app: active Plus users can open billing settings to see provider/status/renewal information and schedule renewal cancellation through Square while keeping Plus access until the paid period ends.

Run `npm run qa:square-activation` after a production build to perform the local end-to-end Square activation pass. It starts the tunnel helper, validates Square's test webhook, creates sandbox monthly/yearly subscription records, verifies monthly Plus activation, verifies cancellation preserves paid access locally, and leaves the admin QA account on active yearly Plus. The runner tries real Square webhook delivery first and reports whether it had to use its signed local webhook replay fallback for sandbox flakiness. Hosted checkout link creation is covered by `npm run billing:square-smoke`; do one final browser-based hosted checkout smoke on a stable staging or production URL before public launch.

For production, configure a webhook subscription for this URL:

```text
https://your-domain.example/api/billing/webhook/square
```

Use Square events `subscription.created`, `subscription.updated`, `invoice.payment_made`, `payment.created`, and `payment.updated`. Copy Square's webhook signature key into `SQUARE_WEBHOOK_SIGNATURE_KEY`, and set `SQUARE_WEBHOOK_NOTIFICATION_URL` to the exact URL configured in Square because signature validation depends on that exact value. Hosted subscription checkout can create a different Square customer from the profile Mint Binder prepared, so the payment events carry Mint Binder's signed opaque checkout correlation and attach the resulting customer before Plus is granted. Keep `SQUARE_PAYMENT_CORRELATION_VERIFIED=false` until a real sandbox hosted checkout has proved that a completed payment maps exactly once to the intended disposable account; checkout is deliberately disabled while the flag is false. Square does not provide the same built-in Stripe customer portal flow; set `SQUARE_CUSTOMER_PORTAL_URL` if you have a customer-facing billing management page, or manage early beta subscription changes in Square while we add a fuller in-app cancellation/update flow.

Run `npm run billing:square-smoke` to verify the configured Square sandbox location, plan variations, and checkout-link creation. It creates a sandbox smoke-test customer and prints a Square-hosted checkout URL. Set `SQUARE_BILLING_SMOKE_PLAN=yearly` to smoke-test the annual plan instead of monthly.

Stripe remains available as a fallback by setting `BILLING_PROVIDER=stripe`. Configure Stripe independently at `/api/billing/webhook/stripe`; webhook fulfillment expects events for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`. Keep `SQUARE_WEBHOOK_ENABLED=true` and/or `STRIPE_WEBHOOK_ENABLED=true` while that provider has historical or current subscriptions; production environment QA requires each enabled provider's API and verification secrets independently of the provider accepting new checkouts.

Job routes accept either `Authorization: Bearer <JOB_SECRET>` or `x-job-secret: <JOB_SECRET>`; signed-in admin users can also run them from Operations without entering the secret. Each successful authenticated job request creates a `job_runs` record with input, result, status, timing, and errors. Catalogue and pricing refreshes accept `page`, `pageSize`, `q`, and `maxPages`; `maxPages` is capped at 20 per job so broad backfills can be resumed in controlled batches. Pricing refreshes fetch live USD/EUR to GBP exchange rates from Frankfurter by default, prefer available Cardmarket European pricing for UK-facing estimates, and retain TCGplayer/TCGCSV conversion as a clearly labelled US market reference. `POKEMON_TCG_USD_TO_GBP_RATE`, `POKEMON_TCG_EUR_TO_GBP_RATE`, and `TCGCSV_USD_TO_GBP_RATE` are optional fallbacks or manual-mode overrides, not daily maintenance values. Scheduled production pricing should use `/api/jobs/scheduled-set-pricing` or `npm run job:live-pricing`, which rotates through sets from the local database in timeout-safe batches. The deployed `cron-live-pricing.sh` wrapper then refreshes one oldest-priced TCGCSV English group in a separate request, so the existing hourly task covers both feeds without increasing gateway timeout risk. `POKEMON_TCG_API_TIMEOUT_MS`, `POKEMON_TCG_API_RETRY_ATTEMPTS`, and `POKEMON_TCG_API_RETRY_WAIT_MS` control the bounded attempt timeout and retries for transient Pokemon TCG API `408`/`425`/`429`/`5xx` or transport failures. Exhausted transient failures degrade only the affected set so the rotation can continue; credentials and other structural `4xx` responses still fail the job.

Email alerts can be sent through 20i SMTP or Resend. For the 20i path, create a mailbox such as `alerts@mintbinder.co.uk`, confirm SPF/DKIM/DMARC are configured in 20i DNS, then set `EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASSWORD` in `.env`. The expected 20i outgoing host is usually `smtp.stackmail.com`; use the exact values shown in your 20i mailbox setup screen. Resend remains available as an optional fallback by setting `EMAIL_PROVIDER=resend` and `RESEND_API_KEY`. Set `EMAIL_SMOKE_TO` to a mailbox you control and run `npm run email:smoke` to confirm one harmless transactional test email can be delivered before running app-level alert jobs. After deploying to production, run `npm run email:production-smoke` to trigger the same protected smoke through `/api/jobs/email-smoke` on the live app. Run `npm run job:price-alerts` to execute the digest job through the production app. It defaults to dry-run mode with `PRICE_ALERT_DIGEST_DRY_RUN=true`, selects active Plus users, applies notification preferences, records a `price_alerts` job run, and does not send email. Set `PRICE_ALERT_DIGEST_DRY_RUN=false` only after email sending is configured. For the first live price-alert smoke, set `PRICE_ALERT_DIGEST_TEST_RECIPIENT` to a mailbox you control so real digest content is delivered to that address while the job still records which user would have received it. The command-line runner will not email real users unless `PRICE_ALERT_DIGEST_TEST_RECIPIENT` is set or `PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS=true` is explicitly configured. Clear `PRICE_ALERT_DIGEST_TEST_RECIPIENT` and set `PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS=true` only when you are ready to send real beta digests. Use `PRICE_ALERT_DIGEST_NOW` with an ISO timestamp when you need to test daily/weekly scheduling deterministically.

If `npm run qa:admin` reports recent failed job runs, inspect the `recentFailedJobRunDetails` JSON first. Fix the named job's configuration or provider issue, rerun a small controlled batch from Operations, confirm the latest run for that job type is `SUCCEEDED`, then rerun `npm run qa:admin` before increasing batch size. The warning notes when the latest failed job type has since recovered with a later successful run.

For a first controlled card import, open Operations, enter `JOB_SECRET`, choose a preset or keep the default query `set.id:sv3pt5`, and run Catalogue with a small page size. Review the job result and recent run before increasing page count or switching to Pricing.

For broader catalogue backfills, leave the query blank or use a broad Pokemon TCG API filter, set `pageSize` to `250`, and run small `maxPages` batches. If the result returns `nextPage`, set Page to that value or use the Operations resume control before continuing.

For local command-line backfills, set `JOB_SECRET`, `POKEMON_TCG_IMPORT_PAGE`, `POKEMON_TCG_IMPORT_PAGE_SIZE`, and `POKEMON_TCG_IMPORT_MAX_PAGES`, then run `npm run job:catalogue-batch`. Use `POKEMON_TCG_IMPORT_PAGE=auto` to resume from the latest matching catalogue-status page. The helper starts the built app, runs one catalogue job, prints the JSON result, and stops the server.

For fresh production catalogue bootstraps, use `npm run job:production-bootstrap` for broad Pokemon TCG pages, then `npm run job:production-set-bootstrap` for targeted set-by-set completion. The set bootstrap supports `BOOTSTRAP_SET_ONLY_MISSING=true` for missing/incomplete sets, and `BOOTSTRAP_SET_ONLY_UNPRICED=true` plus `BOOTSTRAP_SET_MIN_UNPRICED` for repeatable pricing passes that prioritise the largest unpriced set gaps first.

Use `npm run report:catalogue-gaps` or the Operations export button to check local catalogue health, set-level count gaps, duplicate Pokemon TCG provider IDs, image coverage, variant metadata coverage, pricing-source mix, sealed product-type gaps, and recommended next actions. Operations can load a duplicate provider review showing each duplicate group, affected rows, and attached collection/wishlist/price usage before any manual merge decision. After review, use Prepare to fill the primary and duplicate card IDs, dry-run the plan, then execute it to move collection items, wishlist items, and price snapshots onto the primary card before deleting the duplicate card row. Pokemon TCG card image URLs can be repaired from provider IDs in Operations or from the command line with `npm run job:repair-card-images`; set `CARD_IMAGE_REPAIR_LIMIT` and `CARD_IMAGE_REPAIR_DRY_RUN=true` for a smaller or preview-only run. TCGCSV sealed product image URLs can be repaired with `npm run job:repair-sealed-images`; set `SEALED_IMAGE_REPAIR_LIMIT`, `SEALED_IMAGE_REPAIR_DRY_RUN=true`, and `SEALED_IMAGE_REPAIR_WAIT_MS` to tune the run. Pokemon TCG variant choices can be repaired with `npm run job:repair-variant-metadata`; set `VARIANT_METADATA_REPAIR_LIMIT`, `VARIANT_METADATA_REPAIR_DRY_RUN=true`, and `VARIANT_METADATA_REPAIR_WAIT_MS` to tune the API backfill. For command-line pricing refreshes, set `JOB_SECRET`, `POKEMON_TCG_PRICING_PAGE`, `POKEMON_TCG_PRICING_PAGE_SIZE`, `POKEMON_TCG_PRICING_MAX_PAGES`, and optionally `POKEMON_TCG_PRICING_QUERY`, then run `npm run job:pricing-batch`. For several known sparse sets, set `POKEMON_TCG_PRICING_QUERIES` to comma-separated queries such as `set.id:sm1,set.id:sm5` and run `npm run job:pricing-targets`; this starts one local job server and processes each one-page target sequentially. Automatic exchange rates enable Pokemon TCG API Cardmarket fallback prices by default; set `POKEMON_TCG_PRICE_ONLY_UNPRICED=true` when enriching sparse segments without duplicating existing snapshots.

For TCGCSV card-pricing enrichment, run `npm run job:tcgcsv-card-pricing`. The importer reads TCGCSV's cached TCGplayer Pokemon groups/products/prices, matches groups to local card sets, matches card products by set/name/number, and writes card price snapshots with source `tcgcsv-card`. When a matched product has multiple price subtypes, each usable subtype is stored as its own variant snapshot. Set `TCGCSV_CARD_GROUP_IDS` to a comma-separated list of TCGplayer group IDs for a targeted run, `TCGCSV_USD_TO_GBP_RATE` or `POKEMON_TCG_USD_TO_GBP_RATE` for this standalone importer, and `TCGCSV_CARD_PRICE_ONLY_UNPRICED=true` only for a deliberate missing-price backfill. The hourly production wrapper uses `priceOnlyUnpriced=false` and processes one oldest-priced group so existing values build fresh history. These prices remain US market references rather than UK market prices.

For international catalogue backfills, use Operations or run `npm run job:live-international-catalogue-backfill` against the deployed app. By default this reruns the source-backed Simplified Chinese and Korean TCGdex imports in small chunks; set `TCGDEX_BACKFILL_LANGUAGES=ja,zh-tw,zh-cn,ko` when you deliberately want to refresh every supported international language.

For Japanese card-pricing enrichment, run `npm run job:tcgcsv-japan-card-pricing` locally or `npm run job:live-japan-card-pricing` against the deployed app. This uses TCGCSV's `Pokemon Japan` category (`TCGCSV_JAPAN_CARD_CATEGORY_ID=85`), matches TCGdex-backed Japanese sets by set code where possible, and writes source `tcgcsv-japan-card` snapshots with `language=ja`. Scheduled production runs should use `TCGCSV_JAPAN_CARD_GROUP_LIMIT=1`, `TCGCSV_JAPAN_CARD_ONLY_UNPRICED_GROUPS=false`, and `TCGCSV_JAPAN_CARD_PRICE_ONLY_UNPRICED=false` so each run fills blanks and also creates fresh price-history snapshots for the oldest Japanese group.

Traditional Chinese, Simplified Chinese, and Korean card-pricing enrichment does not currently have a safe automated source. Keep those pricing gaps visible in Operations and use a reviewed CSV/licensed-source workflow rather than scraping official pages or requiring Cardmarket personal/business verification.

For sealed product catalogue imports, run `npm run job:sealed-tcgcsv`. The importer reads TCGCSV's cached TCGplayer Pokemon groups/products/prices, matches groups to local card sets, filters sealed products, and writes sealed-product price snapshots. Set `TCGCSV_SEALED_GROUP_IDS` to a comma-separated list of TCGplayer group IDs for a smaller import, `TCGCSV_USD_TO_GBP_RATE` or `POKEMON_TCG_USD_TO_GBP_RATE` for this standalone importer, and `TCGCSV_SEALED_PRICE_ONLY_UNPRICED=true` to enrich only products that do not already have sealed prices.

For tracked sealed-pricing backfills through the same API route used by Operations, set `JOB_SECRET`, keep automatic exchange rates enabled, then run `npm run job:sealed-pricing-batch`. The helper starts the built app, posts to `/api/jobs/sealed-pricing-refresh`, records a `sealed_pricing_refresh` job run, prints the JSON result, and stops the server. Use `TCGCSV_SEALED_GROUP_LIMIT`, `TCGCSV_SEALED_GROUP_IDS`, or `TCGCSV_SEALED_PRODUCT_LIMIT` for small batches before scaling up. Production scheduled sealed pricing should use `npm run job:live-sealed-pricing` with `TCGCSV_SEALED_GROUP_LIMIT=1`, `TCGCSV_SEALED_PRODUCT_LIMIT=40`, and `TCGCSV_SEALED_PRICE_ONLY_UNPRICED=false` so sealed products build price history the same way card pricing does. The live helper defaults to `TCGCSV_SEALED_PRODUCT_LIMIT=40` if the env value is absent.

For production scheduled jobs, see [SCHEDULED_JOBS.md](SCHEDULED_JOBS.md). The live helpers call the deployed app instead of starting a temporary local server: `npm run job:live-health`, `npm run job:live-password-reset-delivery`, `npm run job:live-billing-checkout-retirement`, `npm run job:live-pricing`, `npm run job:live-english-card-pricing`, `npm run job:live-japan-card-pricing`, `npm run job:live-sealed-pricing`, and `npm run job:live-price-alerts`. Run password-reset delivery every minute so the public request endpoint only performs a durable, enumeration-safe enqueue; stale or uncertain claims are surfaced by monitoring and never automatically resent. Run billing checkout retirement every ten minutes so expired hosted links are checked against provider truth and closed without waiting for another user request. Hourly pricing is separate from `scripts/cron-live-daily.sh`, which handles slow set discovery and a forced-safe price-alert dry run. When `CARDTRADER_API_TOKEN` is configured, the sealed-pricing route also rotates through a small CardTrader batch. It resolves blueprints conservatively within a matched expansion using a reviewed manual alias, exact TCGplayer ID, exact UPC/EAN, or exact normalized name plus compatible product type; ambiguous candidates are emitted for review rather than guessed. It derives a European marketplace reference from eligible English listings and records it separately as `cardtrader-sealed`. Obtain the bearer token from the settings page of the CardTrader account used by the service; leave `CARDTRADER_SEALED_ENABLED` empty to enable the lane automatically when the token exists.

`npm run report:pricing-health` includes per-source sealed coverage/freshness plus price-snapshot growth and one-year storage forecasts. `npm run ops:price-snapshot-retention -- --days=365 --batch=5000` is the read-only planning step for weekly downsampling of older duplicate observations; retention is never scheduled automatically and applying a bounded batch requires the additional environment opt-in and `--confirm`. `npm run ops:operational-retention` separately audits expired account tokens, stale authentication throttles, terminal checkout attempts, completed billing webhook records, completed job runs, successfully sent notification claims, and completed password-reset outbox rows against configurable retention windows. Claimed, queued, ambiguous, or unresolved delivery records are retained for reconciliation and surfaced by the job monitor. Checkout correlation is retained for at least as long as webhook evidence (730 days by default). The audit is dry-run by default and uses its own double-gated, bounded deletion path. See the runbook before using either command.

Per-account collection-history growth is bounded. Ordinary additions and edits stop at the configured event ceiling; a sale or removal at that exact ceiling may transactionally replace only the oldest low-value `EDITED` event. Acquisition, grading, sale, and removal evidence is never selected for that emergency compaction, and the event count cannot exceed the ceiling.

The PriceCharting adapters remain available for explicitly licensed use via `npm run job:pricecharting-sealed` and `npm run job:pricecharting-graded`. Both default to non-writing, and the graded importer has a protected deployed helper (`npm run job:live-graded-card-pricing`) but is intentionally not in the default schedule. PriceCharting's current terms require express written permission before its data is displayed in third-party public software; keep `PRICECHARTING_SEALED_WRITE_PRICES=false`, `PRICECHARTING_GRADED_ENABLED=false`, and `PRICECHARTING_GRADED_WRITE_PRICES=false` until that permission is confirmed.

The graded importer follows the official Prices API contract narrowly. It may write only `manual-only-price` (PSA 10), `bgs-10-price` (BGS 10), and `condition-17-price` (CGC 10). PriceCharting's generic grade 7/8/9/9.5 fields do not name a grading company, so they are returned as diagnostics and never written. `condition-19-price` (CGC 10 Pristine) and `condition-20-price` (BGS 10 Black Label) are also diagnostic-only because Mint Binder does not currently store those qualifiers. Exact set, card name, collector number, and compatible variant matching is required; ambiguous products go to `mappingReview`. A reviewed override can use `card:<local UUID>|<normalized variant>` or `pokemon_tcg_api:<provider id>|<normalized variant>` in `PRICECHARTING_GRADED_ALIASES_JSON`.

Start with a local capability/mapping dry run:

```sh
PRICECHARTING_GRADED_ENABLED=true PRICECHARTING_GRADED_WRITE_PRICES=false npm run job:pricecharting-graded
```

After reviewing `mappingReview`, confirming the licence, and taking a database backup, enable a small write batch explicitly. Graded snapshots are stored in a separate `pricecharting-graded-card` series keyed by company, score, and underlying card variant; raw catalogue values never consume those snapshots. `npm run report:pricing-health` reports exact owned grade-target coverage and freshness plus a non-failing limitation count for grades that the provider cannot safely attribute to PSA/BGS/CGC.

For the `mintbinder.co.uk` domain setup batch, create and verify the 20i sender mailbox, confirm SPF/DKIM/DMARC, update `EMAIL_FROM` and SMTP settings, configure the production Square webhook URL, update the beta-draft privacy/terms/non-affiliation pages with final contact details, and wire those URLs into monitoring and operational runbooks.

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

The next logical step is an end-to-end beta QA pass covering auth, billing, imports, pricing jobs, reports, notification preferences, and the main mobile collection flows.
