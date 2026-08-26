# Mint Binder launch readiness

Last updated: 2026-08-26

## Current status

Mint Binder is close to a controlled beta, but the current production scheduler
must first be restored and observed running cleanly after this release candidate
is deployed. The database migration must complete and the registered 20i Node
application must restart successfully. The core product, collection and wishlist
workflows, pricing operations, Plus foundations, legal drafts, account controls,
installable web-app foundation, and responsive binder experience are implemented.
Public paid launch remains a separate gate from a controlled free beta.

This file distinguishes four different states deliberately:

- **Implemented** means the code is in this release candidate.
- **Verified locally** means automated checks or browser QA have passed against
  the local production build.
- **Verified in production** means a read-only or controlled live check has
  completed against `mintbinder.co.uk` or the production database.
- **External action** means hosting, provider approval, credentials, policy, or
  business information is still required outside the repository.

## August 2026 release candidate

### Product and UX

- Persistent, database-backed binders with nine-pocket pages, manual card/copy
  placement, blank pockets, cover styles, private-by-default sharing, unlisted
  read-only links, mobile swipe navigation, and reduced-motion support.
- Honest mutation feedback: save failures no longer look successful, destructive
  or slow actions are locked while pending, and recovery actions are available.
- Collection acquisition dates, quantity-aware purchase lots, partial sales, and
  remaining cost-basis handling.
- Collection and sealed-product filters, wishlist-to-collection conversion, and
  CSV preview with row-level validation before import.
- CSV import/export round-trips purchase date and grading information.
- Persistent onboarding progress rather than a checklist that resets per device.
- Set Builder with one active set goal, completion target, priority, missing-card
  focus, safe bulk wishlist actions, and a next-card-to-chase recommendation.
- Source-aware, lazily loaded long-range price history with currency, condition,
  language, variant, grading company, and grade streams kept separate.
- Accessible dialogs, focus management, keyboard states, touch targets, and a
  reduced-motion path for animation-heavy interfaces.
- Branded loading, error, not-found, and offline states; installable PWA metadata
  with dedicated regular/maskable/Apple icons; safe-area layout support; search
  metadata; social cards; sitemap; and robots policy. The service worker caches
  public static assets only, never authenticated HTML, API, collection, or billing
  data.

### Accounts, privacy, and billing

- Strong password policy, scrypt password hashing, persistent authentication
  throttling, required production auth secret, and invalidation of sessions for
  deleted users.
- Email verification and password-reset flows use expiring, single-use hashed
  tokens. Verification requires an explicit confirmation action so mail-link
  scanners cannot consume a token merely by visiting it.
- Price-alert email selection excludes unverified accounts.
- Password-confirmed JSON account export and password-confirmed account deletion.
- Account deletion removes private and pending user-created catalogue data,
  anonymises retained global catalogue contributions, and cascades personal
  collection, wishlist, binder, storage, preference, subscription, token, and
  goal data.
- Billing webhook events are idempotent and guard against out-of-order provider
  updates. Webhook request bodies are bounded before buffering; outbound billing
  and email calls are bounded by timeouts.
- Square hosted checkout uses a signed opaque payment-note correlation because
  Square may create or select a buyer customer by phone rather than use the
  profile Mint Binder prepared. Paid checkout remains fail-closed until the
  payment.created/payment.updated sandbox path is explicitly verified.
- The public health endpoint exposes only service state and time. Build,
  environment, and database diagnostics require an administrator or `JOB_SECRET`.
- Security headers include a restrictive content policy, frame protection,
  transport security in production, a permissions policy, and MIME sniffing
  protection.

### Pricing, catalogue, and operations

- CardTrader sealed matching now uses guarded identifiers and conservative exact
  fallbacks rather than requiring one provider ID on every product.
- Provider calls use bounded timeout, retry, jitter, and `Retry-After` handling.
- Scheduled jobs use database-backed overlap protection and renewable heartbeats
  for legitimate long runs; partial or zero-output provider work is marked
  degraded rather than reported as fully healthy.
- The job monitor fingerprints eight independent critical schedule lanes and
  measures age from their last successful run. A healthy shared job type can no
  longer hide a stopped English, Japanese, sealed, discovery, international,
  password-reset, or checkout-retirement lane.
- Health reporting covers provider freshness/output, stale alert work, price
  snapshot growth, storage forecasts, webhook failures, and retention candidates.
- Price alerts have a forced-safe daily dry-run lane, separate from live delivery.
- Snapshot and operational-data retention support dry-run, double opt-in for
  destructive execution, batching, and monitoring.
- A conservative PriceCharting graded-price lane supports only explicit PSA 10,
  BGS 10, and CGC 10 fields. It is disabled and non-writing by default because
  third-party display requires written provider permission. Persistence and
  customer-facing reads both fail closed unless
  `PRICECHARTING_LICENCE_CONFIRMED=true`.
- Collection, dashboard, storage, CSV, wishlist alerts, portfolio history, and
  insurance reports share one valuation policy. Explicit finishes require an
  exact variant stream; graded items require the exact company, score, and
  variant. Missing exact prices stay unvalued instead of borrowing a headline,
  raw, or different-finish price.
- Wishlist rows persist the selected finish, show it in the UI, and calculate
  targets and alerts from that exact finish.
- Catalogue search uses bounded deterministic pagination, tenant-aware sealed
  visibility, compact payloads, and a client-side “load more” path.
- The Plus insurance report now generates a styled PDF; HTML remains an explicit
  fallback format. PDF/HTML rows include finish and valuation provenance, and
  production downloads use the correct `.pdf` filename.
- Pricing health measures English/Japanese exact-variant coverage and freshness,
  plus CardTrader coverage and freshness. A configured second source producing
  only a token number of snapshots is no longer reported as healthy.
- Bounded rotating international catalogue maintenance, a read-only deferred
  constraint audit, and a bounded sampled remote-image reachability report are
  available as explicit operations.

## Production pricing health

Read-only snapshot taken 2026-08-26 at approximately 14:40 UTC:

| Catalogue | Priced | Coverage | Freshness |
| --- | ---: | ---: | ---: |
| English cards | 20,462 / 20,479 | 99.9% | 20,426 fresh; 36 stale |
| Japanese cards | 4,194 / 6,246 | 67.1% | 4,175 fresh; 19 stale |
| Sealed products | 1,613 / 1,979 | 81.5% | 1,528 fresh; 85 stale |

- The seven-day sealed rotation visited 152/152 sets.
- Exact English variant coverage is 32,803/32,972 (99.5%); 30,007 priced streams
  are fresh and 2,796 stale.
- CardTrader has only 3/1,979 sealed products (0.2%), below the new 5% meaningful
  second-source threshold. Its latest run checked five candidates but produced no
  new snapshots: four blueprint mappings missed and one matched listing had no
  eligible offer. Keep this lane degraded while mapping coverage is improved.
- The snapshot table held 1,478,503 rows at about 1.151 GB. Current growth projects
  roughly 8.856 million rows / 6.894 GB after one year.
- All seven deferred `NOT VALID` constraints returned zero violations in the
  read-only production audit. They are candidates for a later reviewed,
  backup-protected validation-only migration; this release does not validate them.
- A 20-card and 20-sealed-image production sample passed with a ten-second probe.
  TCGdex card images were valid but often exceeded five seconds, so this candidate
  bypasses the seven-second Next image optimiser for that host while retaining
  normal browser caching.
- No tracked scheduled-job run was recorded in the 24 hours before this audit.
  Latest catalogue, pricing, and sealed runs were on 25 August at approximately
  08:57, 09:59, and 10:15 UTC; the latest price-alert dry run was on 14 July.
  There was no recent recorded international catalogue, password-reset delivery,
  or billing-retirement run. This is a beta blocker until the 20i tasks resume;
  the new per-lane cadence monitor will make a recurrence explicit once its own
  external heartbeat is monitored.
- Known zero-output promotion groups are intentionally excluded from coverage
  alarms only after repeated provider runs establish that those groups contain no
  usable price observations. They remain visible as excluded diagnostics; they
  are not counted as successful price updates and their products are not deleted.

## Verification required before deployment

- `npm run db:generate`
- `npm run db:validate`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm audit`
- Production-build browser smoke at desktop and mobile widths.
- Review the final Prisma SQL before `npm run db:deploy`; do not use `migrate dev`
  against production.

The 26 August hardening candidate passed local Prisma generation/validation,
ESLint, TypeScript, the complete automated suite, and a production Next.js build
before it was committed. Repeat the checks after any subsequent change.

The migration creates binders, billing event receipts, account tokens,
authentication throttles, and active set goals; adds supporting indexes and
non-validating integrity constraints; and marks existing password accounts as
verified for a safe rollout. It does not enable any destructive retention job.

## Deployment and immediate post-deploy checks

1. Confirm a current Neon backup or restore point.
2. Keep the 20i Git deployment script set to the repository deployment script.
3. Deploy `main`; require dependency installation, Prisma generation, migration
   deployment, `next build`, and runtime build verification to pass.
4. Restart the registered 20i Node application using the hosting-supported
   command or control-panel action. The deploy script now fails clearly if it
   cannot perform or verify a restart; a successful build alone is not a healthy
   deployment.
5. Confirm public `/api/health` is minimal, authenticated `/api/admin/health`
   contains build diagnostics, and both report healthy. Confirm the signed-in
   dashboard, catalogue search pagination, binder creation/save/reload, a private
   binder, and an unlisted share link.
6. Confirm registration, verification email, password reset, account export, and
   password-confirmed deletion using disposable accounts.
7. Confirm one raw finish, one graded item, one unpriced exact finish, a wishlist
   finish, CSV export, and insurance PDF all reconcile to the same values. An
   unavailable exact stream must show as unvalued.
8. Run sealed pricing and inspect CardTrader `mappingReview` before adding aliases.
9. Run `npm run report:pricing-health`, `npm run report:image-health`, and
   `npm run db:audit-constraints`. The latter two are read-only; retain their
   output with the release evidence.
10. Run the job-monitor report. Confirm every cadence lane is current, then keep
    the daily alert lane dry-run until recipients are intentionally enabled.
11. Complete one Square hosted-checkout browser smoke with a buyer phone that maps
   to a different Square customer. Confirm payment.created/payment.updated maps
   the intended disposable account exactly once, then confirm subscription
   webhook delivery and in-app entitlement state before enabling the correlation
   flag or accepting paid users.

## External launch actions

These cannot be completed safely in code alone:

- Confirm the first deployment's project-local PM2 preflight can see the 20i
  registered application and that runtime reload/commit verification complete.
  The deploy fails before migration if registration is not visible.
- Configure independent uptime/error monitoring and verify production database
  backups with an actual restore exercise.
- Repair or re-save the existing 20i scheduled tasks and use **Test Command** for
  every wrapper after deployment. Confirm new `job_runs` rows appear for all
  eight monitored lanes; task rows merely showing “Enabled” is not evidence that
  the scheduler executed them.
- Smoke-test a dedicated `JOB_MONITOR_ALERT_TO`, then set
  `JOB_MONITOR_DRY_RUN=false`. A configured recipient while dry-run remains on is
  deliberately not considered ready.
- Add `scripts/cron-live-international-catalogue.sh` to 20i every six hours and
  verify its durable language/page cursor advances without overlap.
- Run the read-only deferred-constraint audit. Only after every violation count is
  zero, take a restore point and review a separate validation-only migration.
- Add the final registered business/operator identity, service address, and legal
  contact details, remove all draft/pre-launch wording, then obtain legal review
  of privacy, terms, and non-affiliation notices. Record the corresponding
  `LEGAL_*` values and require `npm run qa:public-launch` to pass.
- Switch Square from sandbox to production credentials only when paid beta is
  approved, then run the hosted checkout and refund/cancellation smoke path.
- Obtain PriceCharting’s express written permission and a paid API token before
  enabling either graded-price flag or displaying its data to third parties.
- Keep Korean and Simplified Chinese catalogue/pricing coverage labelled partial
  until a licensed, dependable source is secured.
- Choose and approve the initial beta cohort and live email-digest schedule.

## Beta gate

A controlled beta can open when all of the following are true:

- The release candidate passes the complete local release gate.
- Production migration, build verification, registered-app restart, and health
  checks pass without manual recovery.
- Every required 20i schedule has produced a successful, current job-run record,
  and the externally observed monitor heartbeat is active.
- Core authenticated workflows pass on a real mobile device.
- Install/update/offline behavior passes on a real iOS and Android device using a
  disposable authenticated account; no private data may appear in browser cache
  or while signed out.
- Backups and external uptime/error alerts are active.
- Square remains disabled for paid users or its production checkout/webhook path
  has passed end-to-end.
- Legal pages contain the real operator details and have been reviewed.
- PriceCharting remains disabled unless written permission has been recorded.

Public launch should additionally wait for beta feedback, real restore testing,
at least one month of healthy scheduled-job history, confirmed provider/licensing
positions for every advertised market, and a support/recovery runbook owned by a
named operator.
