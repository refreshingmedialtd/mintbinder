# Mint Binder launch readiness

Last updated: 2026-08-24

## Current status

Mint Binder is ready for a controlled beta once this release candidate has been
deployed, its database migration has completed, and the registered 20i Node
application has been restarted successfully. The core product, collection and
wishlist workflows, pricing operations, Plus foundations, legal drafts, account
controls, and responsive binder experience are implemented.

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
- Source-aware, lazily loaded long-range price history with raw and exact graded
  streams kept separate.
- Accessible dialogs, focus management, keyboard states, touch targets, and a
  reduced-motion path for animation-heavy interfaces.
- Branded loading, error, and not-found states; installable PWA metadata; search
  metadata; social cards; sitemap; and robots policy.

### Accounts, privacy, and billing

- Strong password policy, scrypt password hashing, persistent authentication
  throttling, required production auth secret, and invalidation of sessions for
  deleted users.
- Email verification and password-reset flows use expiring, single-use hashed
  tokens. Verification requires an explicit confirmation action so mail-link
  scanners cannot consume a token merely by visiting it.
- Price-alert email selection excludes unverified accounts.
- Authenticated JSON account export and password-confirmed account deletion.
- Account deletion removes private and pending user-created catalogue data,
  anonymises retained global catalogue contributions, and cascades personal
  collection, wishlist, binder, storage, preference, subscription, token, and
  goal data.
- Billing webhook events are idempotent and guard against out-of-order provider
  updates. Outbound billing and email calls are bounded by timeouts.
- Square hosted checkout uses a signed opaque payment-note correlation because
  Square may create or select a buyer customer by phone rather than use the
  profile Mint Binder prepared. Paid checkout remains fail-closed until the
  payment.created/payment.updated sandbox path is explicitly verified.
- Security headers include a restrictive content policy, frame protection,
  transport security in production, a permissions policy, and MIME sniffing
  protection.

### Pricing, catalogue, and operations

- CardTrader sealed matching now uses guarded identifiers and conservative exact
  fallbacks rather than requiring one provider ID on every product.
- Provider calls use bounded timeout, retry, jitter, and `Retry-After` handling.
- Scheduled jobs use database-backed overlap protection; partial or zero-output
  provider work is marked degraded rather than reported as fully healthy.
- Health reporting covers provider freshness/output, stale alert work, price
  snapshot growth, storage forecasts, webhook failures, and retention candidates.
- Price alerts have a forced-safe daily dry-run lane, separate from live delivery.
- Snapshot and operational-data retention support dry-run, double opt-in for
  destructive execution, batching, and monitoring.
- A conservative PriceCharting graded-price lane supports only explicit PSA 10,
  BGS 10, and CGC 10 fields. It is disabled and non-writing by default because
  third-party display requires written provider permission.
- Raw valuations exclude graded snapshots. Graded collection items require an
  exact company-and-score stream rather than silently falling back to an
  unrelated graded value.
- Catalogue search uses bounded deterministic pagination, tenant-aware sealed
  visibility, compact payloads, and a client-side “load more” path.
- The Plus insurance report now generates a styled PDF; HTML remains an explicit
  fallback format.

## Production pricing health

Read-only snapshot taken 2026-08-24 at approximately 15:25 UTC:

| Catalogue | Priced | Coverage | Freshness |
| --- | ---: | ---: | ---: |
| English cards | 20,462 / 20,479 | 99.9% | 100% of priced cards fresh |
| Japanese cards | 4,194 / 6,246 | 67.1% | 4,177 fresh; 17 stale |
| Sealed products | 1,612 / 1,979 | 81.5% | 94.9% of priced products fresh |

- The seven-day sealed rotation visited 152/152 sets.
- CardTrader produced its first sealed snapshot: five products checked, one
  matched, and one snapshot created. The four latest misses are blueprint-mapping
  misses; the new identifier/name/type fallbacks need a post-deploy run before
  manual aliases are justified.
- The snapshot table held 1,458,393 rows at about 1.13 GB. Current growth projects
  roughly 10.47 million rows / 8.14 GB after one year, below configured limits.
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
5. Confirm `/api/health`, the signed-in dashboard, catalogue search pagination,
   binder creation/save/reload, a private binder, and an unlisted share link.
6. Confirm registration, verification email, password reset, account export, and
   password-confirmed deletion using disposable accounts.
7. Run sealed pricing and inspect CardTrader `mappingReview` before adding aliases.
8. Run pricing-health and job-monitor reports; confirm the daily alert lane remains
   dry-run until recipients are intentionally enabled.
9. Complete one Square hosted-checkout browser smoke with a buyer phone that maps
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
- Add the final registered business/operator identity, service address, and legal
  contact details, then obtain legal review of privacy and terms drafts.
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
- Core authenticated workflows pass on a real mobile device.
- Backups and external uptime/error alerts are active.
- Square remains disabled for paid users or its production checkout/webhook path
  has passed end-to-end.
- Legal pages contain the real operator details and have been reviewed.
- PriceCharting remains disabled unless written permission has been recorded.

Public launch should additionally wait for beta feedback, real restore testing,
at least one month of healthy scheduled-job history, confirmed provider/licensing
positions for every advertised market, and a support/recovery runbook owned by a
named operator.
