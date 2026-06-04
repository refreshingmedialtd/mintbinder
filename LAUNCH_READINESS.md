# PokeStop Launch Readiness

Last updated: 2026-06-04

## Overall Progress

PokeStop is approximately 81% of the way to a credible MVP/beta release and around 63% of the way to a polished public launch.

The product is now feature-complete enough to validate the core idea with a small beta group: users can track cards and sealed products, manage wishlist targets, review value history, see set progress, use Plus-gated analytics/reporting, and admins can operate catalogue/pricing imports. The remaining work is less about inventing the product and more about finishing integration QA, production setup, legal/brand readiness, and a focused mobile polish pass.

## Latest QA Snapshot

Completed on 2026-06-04:

- Applied all Prisma migrations to the local PostgreSQL `pokestop` database.
- Seeded the local database with the admin demo user, sample collection, wishlist, storage, catalogue, sealed products, events, and price snapshots.
- Ran `npm run qa:admin` successfully with zero failures.
- Ran `npm run build` successfully.
- Ran `npm run qa:beta` successfully with 18/18 checks passing.
- Ran `npm run qa:square-activation` successfully. The final pass created Square sandbox monthly/yearly subscriptions through a live Cloudflare webhook tunnel, verified Square's test webhook, confirmed monthly Plus activation, confirmed cancellation keeps Plus active through the estimated paid period, and left the admin account on active yearly Plus. The final pass used real Square webhook delivery with no signed local replay fallback.
- Reran `npm run qa:admin` after Square activation; the admin QA user now reports `PLUS_YEARLY` / `ACTIVE`.

Known QA warnings:

- Hosted Square checkout link creation has been smoke-tested, and webhook activation is now validated. Do one final browser-based hosted checkout smoke on a stable staging/production URL before public launch.
- One sealed-pricing job failed in the last 24 hours, but the latest sealed-pricing job has since succeeded.
- `npm run db:generate` hit a Windows `EPERM` while replacing Prisma's existing query engine DLL. The migration, seed, build, admin QA, and beta QA all completed successfully, so this is currently a local Windows file-lock warning rather than a launch blocker.

## What Is Already In Place

- Next.js app shell with mobile-first navigation and responsive core screens.
- Authentication, user roles, admin-only Operations access, and sample-data fallback.
- PostgreSQL/Prisma data model for users, subscriptions, catalogue, collection items, wishlist, storage, events, prices, and job runs.
- Collection flows for adding, editing, duplicating, removing, selling, grading, and storing cards/sealed products.
- Wishlist flows with target prices, priorities, update/delete actions, and collection conversion.
- Set progress, detail views, variant-aware card values, price history, analytics, action queues, and insurance report export.
- CSV import/export and collection import templates.
- Square checkout, webhook verification, subscription entitlement foundations, and retained Stripe fallback support.
- Square local tunnel testing and beta subscription management, including in-app renewal cancellation while preserving paid access until the period ends.
- Notification preferences and price-alert dry-run/email job support.
- Operations dashboard for catalogue imports, pricing refreshes, sealed imports, job runs, status, gap reports, image repairs, variant metadata repairs, duplicate provider reviews, and guarded duplicate card merges.
- Catalogue health reporting for coverage, pricing, sealed products, images, variants, duplicate provider IDs, and recommended next actions.
- Tests for auth roles, beta route smoke checks, admin/database readiness, billing webhooks, catalogue status/gaps, job runs, notifications, pricing, price history, variants, image repairs, sealed imports, duplicate reviews, and duplicate merge planning.

## Main Remaining Work

1. Email and notification readiness

   Configure the email provider, verify sender/domain setup, run price-alert dry runs with real users, and decide the schedule for daily/weekly digests.

2. Catalogue data completion

   Backfill the broad Pokemon TCG card catalogue, then run status checks until catalogue coverage, image coverage, variant metadata coverage, and duplicate provider health are acceptable. Resolve duplicate groups through the new review/merge workflow.

3. Pricing data depth

   Run card pricing and sealed pricing jobs enough times to create useful market baselines. Confirm normal/reverse holo/holo pricing choices work for real imported cards and identify which provider segments remain sparse.

4. Authenticated Operations QA

   Exercise the database-backed Operations screen directly, including catalogue status, gap reports, duplicate review, duplicate merge dry runs, job run history, and small controlled job runs.

5. Hosted checkout and billing browser QA

   On staging or the eventual production URL, complete one Square-hosted checkout in a browser, confirm the app Settings billing state, and confirm Square webhook delivery without the local tunnel.

6. Production environment

   Choose hosting and database providers, configure environment variables, run migrations, generate the Prisma client, set up backup policy, and document deploy steps.

7. UX polish and beta fit-and-finish

   Review mobile layouts, loading states, empty states, error messages, accessibility, button text, and first-run flows. The product already works, but this is where it starts feeling calm and trustworthy.

8. Legal, privacy, and brand safety

   Finalize the product name, add clear non-affiliation language for Pokemon/Nintendo/The Pokemon Company, write privacy and terms pages, and confirm data export/deletion expectations.

9. Monitoring and operations

   Add production logging/error monitoring, job failure alerts beyond the local admin smoke, webhook failure alerts, and a small runbook for catalogue/pricing job recovery.

10. Beta launch

   Invite a small group, import enough catalogue/pricing data for their likely collections, gather feedback, and fix the highest-friction issues before a wider release.

## Recommended Order From Here

1. Configure email sending and run notification dry-runs/send tests.
2. Exercise the database-backed Operations screen directly, especially catalogue status, job history, and gap reports.
3. Run controlled catalogue and pricing backfills, then review catalogue gap/status reports.
4. Do a focused mobile UX polish pass on authenticated core flows.
5. Add legal, privacy, and brand/non-affiliation pages.
6. Choose hosting/database providers and prepare production env/deploy steps.
7. Complete a hosted Square checkout browser smoke on staging/production.
8. Configure production monitoring, backups, webhook alerts, and job failure alerts.
9. Run one final `npm run build`, `npm run qa:beta`, and `npm run qa:admin`.
10. Invite a small beta group.

## Launch Gates

Beta can start when:

- A real database-backed admin session has been tested.
- `npm run qa:beta` passes against the production build or staging deployment. Completed locally on 2026-06-04.
- `npm run qa:admin` passes without launch-blocking failures and any warnings are understood. Completed locally on 2026-06-04.
- Users can sign up, add cards/sealed products, edit collection items, use wishlist, and view value/set progress without relying on sample data.
- Catalogue coverage is broad enough for modern Pokemon TCG collections, or gaps are clearly handled.
- Pricing refreshes produce useful values for common card variants and sealed products.
- Plus gates, Square checkout link creation, billing management, and webhook entitlement updates work in sandbox mode. Backend activation completed locally on 2026-06-04; hosted-checkout browser smoke remains for staging/production.
- Email notifications can be dry-run and sent safely.
- Basic privacy/terms/non-affiliation pages exist.
- There is a rollback or recovery plan for migrations and job failures.

Public launch should wait until:

- Beta feedback has been addressed.
- Production backups, monitoring, and error alerts are active.
- The catalogue import/pricing process is repeatable and documented.
- Legal/brand language has been reviewed.
- The app has had at least one full mobile QA pass on real devices.
