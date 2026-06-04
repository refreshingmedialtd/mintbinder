# PokeStop Launch Readiness

Last updated: 2026-06-04

## Overall Progress

PokeStop is approximately 84% of the way to a credible MVP/beta release and around 66% of the way to a polished public launch.

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
- Added `npm run job:price-alerts` and ran a successful dry-run against the local production build. The job selected 1 active Plus user, found 3 alert items, recorded a succeeded `price_alerts` job run, and did not send email because Resend is not configured locally.
- Added and ran `npm run qa:operations` successfully. The pass validated protected Operations endpoints for catalogue status, catalogue gap export, duplicate provider review, job history, and local dry-run maintenance job recording.
- Completed a browser click-through of the admin Operations screen. This caught and fixed a mobile access gap by adding an admin-only `Ops` shortcut to the bottom nav; status loading, gap export API verification, duplicate review, alert dry-run, and job history were validated.
- Ran controlled Pokemon TCG API-backed variant metadata repair dry-runs for 10 and 50 candidates. Both fetched provider data successfully once network access was allowed, but found 0 repairable cards in those batches, so no catalogue rows were changed.
- Added a safer price-alert live-smoke path with `PRICE_ALERT_DIGEST_TEST_RECIPIENT`, allowing real digest content to be sent to one controlled mailbox before clearing the override for beta users.
- Ran controlled pricing backfills for Guardians Rising, Sun & Moon, and Burning Shadows. These added 20 card price snapshots, improved card pricing coverage from 99.5% to 99.6%, and reduced Sun & Moon unpriced cards from 64 to 44.
- Ran targeted TCGCSV sealed pricing groups for current unpriced products. The batch added 1 sealed price snapshot and moved sealed pricing coverage from 81.4% to 81.5%; many remaining sealed products appear to lack usable provider prices rather than missing import coverage.

Known QA warnings:

- Hosted Square checkout link creation has been smoke-tested, and webhook activation is now validated. Do one final browser-based hosted checkout smoke on a stable staging/production URL before public launch.
- Resend email credentials and sender/domain verification are not configured locally yet, so live price-alert email sending remains pending. Dry-run selection, preferences, job recording, and the controlled live-smoke override are validated in code.
- The Operations gap report currently shows 814 card variant-metadata gaps. A controlled 50-card provider dry-run found 0 repairable rows, so the remaining gaps may include cards where Pokemon TCG API does not expose TCGPlayer variant prices. Continue with measured batches before treating this as a data-quality blocker.
- Sealed pricing remains the largest data-depth gap at 81.5% coverage. Targeted TCGCSV batches can improve it slightly, but the next substantial improvement may require PriceCharting or another sealed-price source.
- Recent `fetch failed` job records are from sandbox-blocked provider calls before rerunning with network permission. The latest pricing, sealed-pricing, catalogue, and price-alert jobs have since succeeded.
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

   Configure Resend, verify sender/domain setup, run a live price-alert send test with `PRICE_ALERT_DIGEST_TEST_RECIPIENT`, and decide the schedule for daily/weekly digests. Dry-run digest selection is already validated locally.

2. Catalogue data completion

   Backfill the broad Pokemon TCG card catalogue, then run status checks until catalogue coverage, image coverage, variant metadata coverage, and duplicate provider health are acceptable. Resolve duplicate groups through the new review/merge workflow.

3. Pricing data depth

   Run card pricing and sealed pricing jobs enough times to create useful market baselines. Confirm normal/reverse holo/holo pricing choices work for real imported cards and identify which provider segments remain sparse.

4. Hosted checkout and billing browser QA

   On staging or the eventual production URL, complete one Square-hosted checkout in a browser, confirm the app Settings billing state, and confirm Square webhook delivery without the local tunnel.

5. Production environment

   Choose hosting and database providers, configure environment variables, run migrations, generate the Prisma client, set up backup policy, and document deploy steps.

6. UX polish and beta fit-and-finish

   Review mobile layouts, loading states, empty states, error messages, accessibility, button text, and first-run flows. The product already works, but this is where it starts feeling calm and trustworthy.

7. Legal, privacy, and brand safety

   Finalize the product name, add clear non-affiliation language for Pokemon/Nintendo/The Pokemon Company, write privacy and terms pages, and confirm data export/deletion expectations.

8. Domain setup batch

   Once the final name/domain is chosen, verify the Resend sending domain/subdomain DNS records, configure `EMAIL_FROM`, run the controlled live price-alert smoke with `PRICE_ALERT_DIGEST_TEST_RECIPIENT`, configure the production Square webhook URL, update sender/legal URLs, and add the final URLs to monitoring/runbooks.

9. Monitoring and operations

   Add production logging/error monitoring, job failure alerts beyond the local admin smoke, webhook failure alerts, and a small runbook for catalogue/pricing job recovery.

10. Beta launch

   Invite a small group, import enough catalogue/pricing data for their likely collections, gather feedback, and fix the highest-friction issues before a wider release.

## Recommended Order From Here

1. Configure Resend sender credentials and run a live price-alert send smoke test.
2. Run controlled catalogue and pricing backfills, including measured variant metadata repair batches, then review catalogue gap/status reports.
3. Do a focused mobile UX polish pass on authenticated core flows.
4. Add legal, privacy, and brand/non-affiliation pages.
5. Choose hosting/database providers and prepare production env/deploy steps.
6. Run the domain setup batch once the final name/domain is chosen.
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
- Operations status, exports, job history, and safe dry-run job controls pass protected API QA and browser UI click-through. Completed locally on 2026-06-04.
- Basic privacy/terms/non-affiliation pages exist.
- There is a rollback or recovery plan for migrations and job failures.

Public launch should wait until:

- Beta feedback has been addressed.
- Production backups, monitoring, and error alerts are active.
- The catalogue import/pricing process is repeatable and documented.
- Legal/brand language has been reviewed.
- The app has had at least one full mobile QA pass on real devices.
