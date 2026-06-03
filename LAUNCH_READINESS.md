# PokeStop Launch Readiness

Last updated: 2026-06-03

## Overall Progress

PokeStop is approximately 70% of the way to a credible MVP/beta release and around 55% of the way to a polished public launch.

The product is now feature-complete enough to validate the core idea with a small beta group: users can track cards and sealed products, manage wishlist targets, review value history, see set progress, use Plus-gated analytics/reporting, and admins can operate catalogue/pricing imports. The remaining work is less about inventing the product and more about hardening, filling real catalogue data, running end-to-end QA, and preparing production operations.

## What Is Already In Place

- Next.js app shell with mobile-first navigation and responsive core screens.
- Authentication, user roles, admin-only Operations access, and sample-data fallback.
- PostgreSQL/Prisma data model for users, subscriptions, catalogue, collection items, wishlist, storage, events, prices, and job runs.
- Collection flows for adding, editing, duplicating, removing, selling, grading, and storing cards/sealed products.
- Wishlist flows with target prices, priorities, update/delete actions, and collection conversion.
- Set progress, detail views, variant-aware card values, price history, analytics, action queues, and insurance report export.
- CSV import/export and collection import templates.
- Stripe checkout, billing portal, webhook verification, and subscription entitlement foundations.
- Notification preferences and price-alert dry-run/email job support.
- Operations dashboard for catalogue imports, pricing refreshes, sealed imports, job runs, status, gap reports, image repairs, variant metadata repairs, duplicate provider reviews, and guarded duplicate card merges.
- Catalogue health reporting for coverage, pricing, sealed products, images, variants, duplicate provider IDs, and recommended next actions.
- Tests for auth roles, beta route smoke checks, billing webhooks, catalogue status/gaps, job runs, notifications, pricing, price history, variants, image repairs, sealed imports, duplicate reviews, and duplicate merge planning.

## Main Remaining Work

1. Real database/admin QA

   Run `npm run build` and `npm run qa:beta` to verify the production app shell, unauthenticated route protections, Plus/report/billing route protections, and Operations job-secret protections. Then run the app against a real local or staging PostgreSQL database with an admin user. Use `npm run qa:admin` after migrations/seed to verify env settings, seeded admin access, core table counts, notification/subscription rows, duplicate provider health, and job-run availability. Exercise Operations directly, including catalogue status, duplicate review, duplicate merge dry runs, and job run history.

2. Catalogue data completion

   Backfill the broad Pokemon TCG card catalogue, then run status checks until catalogue coverage, image coverage, variant metadata coverage, and duplicate provider health are acceptable. Resolve duplicate groups through the new review/merge workflow.

3. Pricing data depth

   Run card pricing and sealed pricing jobs enough times to create useful market baselines. Confirm normal/reverse holo/holo pricing choices work for real imported cards and identify which provider segments remain sparse.

4. Production environment

   Choose hosting and database providers, configure environment variables, run migrations, generate the Prisma client, set up backup policy, and document deploy steps.

5. Billing verification

   Complete Stripe test-mode checkout, portal, cancellation, renewal, and webhook flows. Confirm Plus gates behave correctly before and after webhook updates.

6. Email and notification readiness

   Configure the email provider, verify sender/domain setup, run price-alert dry runs with real users, and decide the schedule for daily/weekly digests.

7. UX polish and beta fit-and-finish

   Review mobile layouts, loading states, empty states, error messages, accessibility, button text, and first-run flows. The product already works, but this is where it starts feeling calm and trustworthy.

8. Legal, privacy, and brand safety

   Finalize the product name, add clear non-affiliation language for Pokemon/Nintendo/The Pokemon Company, write privacy and terms pages, and confirm data export/deletion expectations.

9. Monitoring and operations

   Add production logging/error monitoring, job failure visibility, webhook failure alerts, and a small runbook for catalogue/pricing job recovery.

10. Beta launch

   Invite a small group, import enough catalogue/pricing data for their likely collections, gather feedback, and fix the highest-friction issues before a wider release.

## Recommended Order From Here

1. Run `npm run build` and `npm run qa:beta` against the production app shell.
2. Create a real local/staging admin QA environment.
3. Run `npm run qa:admin`, then run database-backed smoke tests through the Operations screen.
4. Backfill catalogue data in batches and resolve duplicate provider IDs.
5. Run image, variant metadata, and pricing repair/enrichment jobs.
6. Verify Stripe and email integrations end to end.
7. Do a focused mobile UX polish pass.
8. Add legal/brand/privacy pages.
9. Configure production monitoring, backups, and deployment runbook.
10. Launch a small beta.

## Launch Gates

Beta can start when:

- A real database-backed admin session has been tested.
- `npm run qa:beta` passes against the production build or staging deployment.
- Users can sign up, add cards/sealed products, edit collection items, use wishlist, and view value/set progress without relying on sample data.
- Catalogue coverage is broad enough for modern Pokemon TCG collections, or gaps are clearly handled.
- Pricing refreshes produce useful values for common card variants and sealed products.
- Plus gates, Stripe checkout, portal, and webhook entitlement updates work in test mode.
- Email notifications can be dry-run and sent safely.
- Basic privacy/terms/non-affiliation pages exist.
- There is a rollback or recovery plan for migrations and job failures.

Public launch should wait until:

- Beta feedback has been addressed.
- Production backups, monitoring, and error alerts are active.
- The catalogue import/pricing process is repeatable and documented.
- Legal/brand language has been reviewed.
- The app has had at least one full mobile QA pass on real devices.
