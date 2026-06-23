# Mint Binder Launch Readiness

Last updated: 2026-06-14

## Overall Progress

Mint Binder is approximately 90% of the way to a credible MVP/beta release and around 74% of the way to a polished public launch.

The product is now feature-complete enough to validate the core idea with a small beta group: users can track cards and sealed products, manage wishlist targets, review value history, see set progress, use Plus-gated analytics/reporting, and admins can operate catalogue/pricing imports. The remaining work is less about inventing the product and more about finishing integration QA, production setup, legal/brand readiness, and a focused mobile polish pass.

## Latest QA Snapshot

Completed on 2026-06-04:

- Applied all Prisma migrations to the local PostgreSQL `mintbinder` database.
- Seeded the local database with the admin demo user, sample collection, wishlist, storage, catalogue, sealed products, events, and price snapshots.
- Ran `npm run qa:admin` successfully with zero failures.
- Ran `npm run build` successfully.
- Ran `npm run qa:beta` successfully with 18/18 checks passing.
- Ran `npm run qa:square-activation` successfully. The final pass created Square sandbox monthly/yearly subscriptions through a live Cloudflare webhook tunnel, verified Square's test webhook, confirmed monthly Plus activation, confirmed cancellation keeps Plus active through the estimated paid period, and left the admin account on active yearly Plus. The final pass used real Square webhook delivery with no signed local replay fallback.
- Reran `npm run qa:admin` after Square activation; the admin QA user now reports `PLUS_YEARLY` / `ACTIVE`.
- Added `npm run job:price-alerts` and ran a successful dry-run against the local production build. The job selected 1 active Plus user, found 3 alert items, recorded a succeeded `price_alerts` job run, and did not send email because no live email provider is configured locally.
- Added and ran `npm run qa:operations` successfully. The pass validated protected Operations endpoints for catalogue status, catalogue gap export, duplicate provider review, job history, and local dry-run maintenance job recording.
- Completed a browser click-through of the admin Operations screen. This caught and fixed a mobile access gap by adding an admin-only `Ops` shortcut to the bottom nav; status loading, gap export API verification, duplicate review, alert dry-run, and job history were validated.
- Ran controlled Pokemon TCG API-backed variant metadata repair dry-runs for 10 and 50 candidates. Both fetched provider data successfully once network access was allowed, but found 0 repairable cards in those batches, so no catalogue rows were changed.
- Added a safer price-alert live-smoke path with `PRICE_ALERT_DIGEST_TEST_RECIPIENT`, allowing real digest content to be sent to one controlled mailbox before clearing the override for beta users.
- Ran controlled pricing backfills for Guardians Rising, Sun & Moon, and Burning Shadows. These added 20 card price snapshots, improved card pricing coverage from 99.5% to 99.6%, and reduced Sun & Moon unpriced cards from 64 to 44.
- Ran targeted TCGCSV sealed pricing groups for current unpriced products. The batch added 1 sealed price snapshot and moved sealed pricing coverage from 81.4% to 81.5%; many remaining sealed products appear to lack usable provider prices rather than missing import coverage.
- Added `npm run job:pricing-targets` for multi-set Pokemon TCG price catch-ups, then processed 29 remaining sparse set queries. The sweep added 59 more card price snapshots and moved card pricing coverage to 99.9%, leaving 17 edge-case unpriced printings.
- Ran targeted TCGCSV card pricing against the final six matched sparse groups. It matched 825 card products but created 0 additional snapshots, confirming the remaining card gaps are provider/no-price edge cases rather than missed group coverage.
- Ran a full targeted TCGCSV sealed sweep across all 87 groups with unpriced sealed products. It processed 13,594 products and created 0 additional snapshots, confirming the remaining sealed gaps need PriceCharting or another sealed-price source rather than more TCGCSV coverage.
- Started the beta UX polish pass by removing the prototype-only Plus simulation path, adding a clear Free vs Plus comparison in Settings, clarifying Plus email notification behavior, and locking automated price-watch content behind real checkout actions for free users.
- Added local theme selection with free Light/Dark options and a Plus-gated extended palette, plus first-run dashboard/collection empty states, a shorter mobile dashboard set-progress preview, and a less overwhelming Add Item catalogue result cap.
- Continued beta UX polish with a cleaner item-detail mobile layout, moving owned-lot actions out of the page header, adding a compact owned-lot summary, and clarifying edit/sale form states.
- Continued mobile UX polish across set detail and wishlist flows, adding clearer set progress summaries, target-watch summaries, full-width mobile actions, and better no-results/empty states.
- Added beta-draft legal pages for privacy, terms, and Pokemon non-affiliation, linked them from the app/auth surfaces, and added first-run onboarding copy to the sign-in/create-account screen.
- Added a production deployment runbook, `npm run qa:production-env` validator, and `npm run db:deploy` command for staging/production migration flow.

Completed on 2026-06-13:

- Deployed Mint Binder to the live `mintbinder.co.uk` 20i NodeJS Optimised Managed Cloud Server and confirmed the public app returns `200`.
- Connected the live app to Neon PostgreSQL after 20i enabled outbound TCP 5432; live account registration, session creation, database-backed app data, storage-location creation, and Square sandbox checkout link creation all passed.
- Configured 20i SMTP for `alerts@mintbinder.co.uk`, with public SPF, DKIM selector `s1`, and DMARC records visible.
- Ran local and production email smoke tests successfully through 20i SMTP. Production `/api/jobs/email-smoke` returned `200` and sent via provider `smtp`.
- Added a temporary `app.js` protected email-smoke fallback while the 20i deployment script behaviour was being diagnosed.
- Added a disposable `npm run job:price-alert-fixture` helper so the controlled live price-alert digest smoke can be tested even before real Plus beta users exist.
- Ran a live-database price-alert digest dry run with one disposable Plus fixture user and one alert; the `price_alerts` job recorded a successful dry run with 1 eligible user and 1 alert.
- Ran the controlled live price-alert digest smoke through 20i SMTP to the configured smoke mailbox; the `price_alerts` job recorded a successful send, then the disposable fixture user, subscription, wishlist item, card, price snapshot, and set were removed.
- Added a public `/api/health` endpoint and `npm run monitor:jobs` for first-pass uptime and job-run failure/stale-run monitoring.

Completed on 2026-06-14:

- Confirmed 20i Git Version Control expects the deployment script field to contain the script path, and that `scripts/deploy-20i.sh` now performs dependency install, Prisma generation/migration deployment, and `next build`.
- Added a post-build PM2 reload step to `scripts/deploy-20i.sh` so fresh deploys try to restart the registered 20i Node app after rebuilding.
- Removed the temporary custom-server API fallbacks from `app.js`; the 20i Node server now forwards requests to the real Next route handlers for `/api/health`, `/api/jobs/email-smoke`, and future API routes.
- Added repeatable production catalogue bootstrap scripts for broad Pokemon TCG imports and targeted set-by-set imports/pricing.
- Bootstrapped the live Neon catalogue to 20,359 cards across 173 sets, with 100% card image coverage, 0 set deficits, and 0 duplicate Pokemon TCG provider ID groups.
- Enriched production card pricing through Pokemon TCG API and TCGCSV. The live database now has 19,302 priced cards out of 20,359, or 94.8% card pricing coverage, with 20,759 total price snapshots across card and sealed products.
- Imported the live sealed-product catalogue from TCGCSV. Production now has 1,936 sealed products, 100% sealed image coverage, 1,457 priced sealed products, and 75.3% sealed pricing coverage.
- Added protected `/api/jobs/scheduled-set-pricing` and `/api/jobs/scheduled-pricing` routes, live scheduler helpers, and `SCHEDULED_JOBS.md` so production pricing snapshots can run automatically by least-recently refreshed set without manual page tracking or deep provider paging.

Known QA warnings:

- Hosted Square checkout link creation has been smoke-tested in sandbox on the production URL, and webhook activation is validated. Do one final browser-based hosted checkout smoke before public beta, then switch to production Square credentials before paid launch.
- 20i SMTP email delivery and controlled price-alert digest sending are production-verified. A first-pass job monitor now exists; remaining notification work is deciding the real daily/weekly digest schedule and enabling scheduled monitor alerts.
- 20i support confirmed Git Version Control expects a path to a bash script rather than inline commands. The 20i deployment script field should remain set to `/home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/deploy-20i.sh`; fresh deploys should show dependency install, Prisma generation/migrations, `next build`, and a PM2 app reload.
- The production Operations gap report currently shows 814 card variant-metadata gaps, with 96% coverage overall. A controlled 50-card provider dry-run found 0 repairable rows, so the remaining gaps appear concentrated in cards where Pokemon TCG API does not expose TCGPlayer variant prices or newer provider metadata is sparse.
- Production card pricing is strong enough for beta at 94.8% coverage. Remaining gaps are concentrated in older/legacy sets such as Expedition Base Set, XY base, HeartGold & SoulSilver, Base, and a small number of promo/special products where the current providers lack usable prices or matching needs more aliases.
- Production sealed pricing is useful but still a data-depth gap at 75.3% coverage. The next substantial improvement requires PriceCharting or another sealed-price source, especially for booster boxes/decks/blisters where TCGCSV has products but no usable market price.
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

   20i SMTP, SPF, DKIM, DMARC, local email smoke, production email smoke, price-alert dry run, and controlled live price-alert sending are complete. The first-pass job monitor is in place; next, decide the real digest schedule and enable scheduled monitor alerts before enabling real beta recipient emails.

2. Catalogue data completion

   Production card catalogue coverage is now beta-ready: 20,359 cards, 173 sets, 100% card images, 0 set deficits, and 0 duplicate provider groups. Remaining work is ongoing maintenance imports for new sets and measured variant metadata repair/alias improvements.

3. Pricing data depth

   Production card pricing is beta-ready at 94.8% coverage from Pokemon TCG API and TCGCSV. Sealed pricing is 75.3% covered from TCGCSV; add PriceCharting or another sealed-price source for the next meaningful improvement.

4. Hosted checkout and billing browser QA

   On staging or the eventual production URL, complete one Square-hosted checkout in a browser, confirm the app Settings billing state, and confirm Square webhook delivery without the local tunnel.

5. Production environment

   20i hosting, Neon PostgreSQL, Square sandbox, and 20i SMTP are configured on `mintbinder.co.uk`. The path-based 20i deployment script is in place; before real beta users, upgrade Neon, run `npm run qa:production-env`, set up backup policy, and connect scheduled monitoring.

6. UX polish and beta fit-and-finish

   Review mobile layouts, loading states, empty states, error messages, accessibility, button text, and first-run flows. The first passes have clarified Free vs Plus messaging, Analytics upgrade actions, free-user alert states, theme selection, collection/add-flow mobile scanning, first-run empty states, item-detail edit/sale flows, set detail, and wishlist targets; continue with onboarding copy and real-device QA.

7. Legal, privacy, and brand safety

   Beta-draft privacy, terms, and non-affiliation pages now exist. Finalize the product name, domain, company/contact details, legal review, Pokemon/Nintendo/The Pokemon Company non-affiliation wording, and data export/deletion expectations.

8. Domain setup batch

   For `mintbinder.co.uk`, the 20i sender mailbox, SPF/DKIM/DMARC records, `EMAIL_FROM`, local email smoke, production email smoke, and controlled live price-alert smoke are complete. Remaining domain tasks: configure production Square credentials/webhook when ready, update final legal URLs, and add the final URLs to monitoring/runbooks.

9. Monitoring and operations

   `/api/health`, `/api/jobs/scheduled-set-pricing`, `/api/jobs/scheduled-pricing`, live scheduled job helpers, and `npm run monitor:jobs` are in place for first-pass uptime, pricing-history refreshes, and job-run failure/stale-run monitoring. Remaining operations work: configure the 20i/external schedules, choose the uptime/error-monitoring provider, add webhook failure alerts, database backup checks, and a small runbook for catalogue/pricing job recovery.

10. Beta launch

   Invite a small group, import enough catalogue/pricing data for their likely collections, gather feedback, and fix the highest-friction issues before a wider release.

## Recommended Order From Here

1. Decide the price-alert digest schedule and keep real beta recipient emails disabled until the first beta group is approved.
2. Do a focused production QA pass against `https://mintbinder.co.uk`, including account creation, add-card/add-sealed flows, wishlist, storage, reports, Settings, and mobile layouts.
3. Complete a hosted Square checkout browser smoke on production.
4. Schedule card/sealed pricing jobs, schedule the job monitor, configure public uptime/error monitoring, backups, webhook alerts, and database backup checks.
5. Review/finalize legal, privacy, brand/non-affiliation, and onboarding copy for `mintbinder.co.uk`.
6. Run one final `npm run build`, `npm run qa:beta`, and `npm run qa:admin`.
7. Invite a small beta group.

## Launch Gates

Beta can start when:

- A real database-backed admin session has been tested.
- `npm run qa:beta` passes against the production build or staging deployment. Completed locally on 2026-06-04.
- `npm run qa:admin` passes without launch-blocking failures and any warnings are understood. Completed locally on 2026-06-04.
- Users can sign up, add cards/sealed products, edit collection items, use wishlist, and view value/set progress without relying on sample data.
- Catalogue coverage is broad enough for modern Pokemon TCG collections, or gaps are clearly handled. Production card catalogue coverage is beta-ready as of 2026-06-14.
- Pricing refreshes produce useful values for common card variants and sealed products. Production card pricing is beta-ready at 94.8%; sealed pricing is useful at 75.3% but should be deepened before a wider public launch.
- Plus gates, Square checkout link creation, billing management, and webhook entitlement updates work in sandbox mode. Backend activation completed locally on 2026-06-04; hosted-checkout browser smoke remains for staging/production.
- Email notifications can be dry-run and sent safely. Production SMTP smoke and controlled price-alert digest smoke completed on 2026-06-13.
- Operations status, exports, job history, and safe dry-run job controls pass protected API QA and browser UI click-through. Completed locally on 2026-06-04.
- Basic privacy/terms/non-affiliation pages exist in beta-draft form. Completed locally on 2026-06-04; final legal/name/domain review remains.
- There is a rollback or recovery plan for migrations and job failures.

Public launch should wait until:

- Beta feedback has been addressed.
- Production backups, monitoring, and error alerts are active.
- The catalogue import/pricing process is repeatable and documented.
- Legal/brand language has been reviewed.
- The app has had at least one full mobile QA pass on real devices.
