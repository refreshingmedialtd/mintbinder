# PokeStop Production Deployment Runbook

Last updated: 2026-06-04

PokeStop is not ready for a public production launch until the final name/domain and production provider accounts are chosen. This runbook defines the deployment path so staging can be prepared without guessing.

## Recommended First Deployment Shape

- App host: a managed Next.js host or Node host that supports Next.js 15, API routes, environment variables, build logs, and HTTPS.
- Database: managed PostgreSQL with backups, restore testing, and connection pooling suitable for serverless or autoscaled app hosting.
- Payments: Square production app, production access token, production location, production subscription plan variations, and a production webhook URL.
- Email: Resend or equivalent transactional email provider with a verified sending domain or subdomain.
- Jobs: protected app routes triggered manually from Operations at first, then scheduled later by a trusted scheduler using `JOB_SECRET`.
- Monitoring: error tracking, uptime checks, job/webhook failure alerts, and database backup monitoring.

## Environment Validation

Run this before staging, before public beta, and after changing provider credentials:

```sh
npm run qa:production-env
```

The validator intentionally fails against local/sandbox values. It checks for production-grade app URLs, Auth.js secret, job secret, database URL, Square configuration, webhook URL/signature, email sender, and pricing conversion-rate readiness.

Use JSON output for automation:

```sh
node scripts/validate-production-env.mjs --json
```

Do not paste real secret values into logs, screenshots, tickets, or documentation.

## Required Production Environment

Core app:

- `DATABASE_URL`: hosted PostgreSQL connection string.
- `AUTH_SECRET`: high-entropy secret, at least 32 characters.
- `AUTH_URL`: final production app origin, HTTPS.
- `AUTH_TRUST_HOST=true`.
- `NEXT_PUBLIC_APP_URL`: same HTTPS origin as `AUTH_URL`.
- `JOB_SECRET`: high-entropy secret for protected Operations/job routes.

Billing:

- `BILLING_PROVIDER=square`.
- `SQUARE_ENVIRONMENT=production`.
- `SQUARE_ACCESS_TOKEN`: production Square access token.
- `SQUARE_LOCATION_ID`: production business location ID.
- `SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID`: production Plus monthly plan variation.
- `SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID`: production Plus yearly plan variation.
- `SQUARE_PLUS_MONTHLY_AMOUNT_MINOR=249`.
- `SQUARE_PLUS_YEARLY_AMOUNT_MINOR=1999`.
- `SQUARE_CURRENCY=GBP`.
- `SQUARE_WEBHOOK_NOTIFICATION_URL`: `https://final-domain/api/billing/webhook`.
- `SQUARE_WEBHOOK_SIGNATURE_KEY`: production webhook signature key.
- `SQUARE_WEBHOOK_SUBSCRIPTION_ID`: production webhook subscription ID.

Email and alerts:

- `RESEND_API_KEY`: production sending key.
- `EMAIL_FROM`: verified sender on the final domain or subdomain.
- `PRICE_ALERT_DIGEST_DRY_RUN=true` until the controlled live smoke is complete.
- `PRICE_ALERT_DIGEST_TEST_RECIPIENT`: controlled mailbox for first live smoke.
- `PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS=false` until real beta digests are approved.

Pricing:

- `POKEMON_TCG_USD_TO_GBP_RATE`: positive current conversion rate.
- `POKEMON_TCG_EUR_TO_GBP_RATE`: positive current conversion rate for Cardmarket fallback.
- `TCGCSV_USD_TO_GBP_RATE`: positive current conversion rate for TCGCSV imports.
- `PRICECHARTING_API_TOKEN`: optional until that paid source is available.
- `PRICECHARTING_USD_TO_GBP_RATE`: positive current conversion rate when PriceCharting is active.

## First Staging Deploy Order

1. Choose the staging host and managed PostgreSQL provider.
2. Create the staging database and add `DATABASE_URL`.
3. Add all non-payment production-like env vars with staging-safe values.
4. Run `npm run db:deploy`.
5. Seed or create one admin user.
6. Run `npm run build`.
7. Run `npm run qa:beta` against staging with `BETA_QA_BASE_URL`.
8. Run `npm run qa:admin` against staging data.
9. Configure Square sandbox or production-like staging credentials for the staging domain.
10. Configure the staging webhook URL in Square and run a webhook delivery smoke.
11. Configure a verified email sender or test sender and run a controlled price-alert live smoke.

## Public Production Deploy Order

1. Finalize product name, domain, support email, legal contact, and legal page copy.
2. Create the production database and enable automated backups.
3. Add production env vars to the app host.
4. Run `npm run qa:production-env`; fix every blocker.
5. Run `npm run db:deploy`.
6. Deploy the app.
7. Run `npm run qa:beta` against the production URL.
8. Run `npm run qa:admin` against production data.
9. Run Square hosted-checkout browser smoke for monthly and yearly plans.
10. Confirm Square webhook delivery updates the in-app subscription state.
11. Run price-alert dry run, then controlled live smoke with `PRICE_ALERT_DIGEST_TEST_RECIPIENT`.
12. Keep `PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS=false` until the first beta group is approved.
13. Turn on uptime/error/job/webhook alerts.

## Database Migration Policy

- Development: use `npm run db:migrate` to create and apply migrations locally.
- Production/staging: use `npm run db:deploy` to apply committed migrations only.
- Before public launch, confirm backups are enabled and run at least one restore test.
- Never run destructive schema changes against production without a rollback plan and tested backup.

## Square Domain Batch

When the final domain is chosen:

- Set `NEXT_PUBLIC_APP_URL` and `AUTH_URL` to the final HTTPS origin.
- Create or update the Square production webhook subscription at `/api/billing/webhook`.
- Copy the production `SQUARE_WEBHOOK_SIGNATURE_KEY`.
- Copy the production `SQUARE_WEBHOOK_SUBSCRIPTION_ID`.
- Confirm Square events include `subscription.created`, `subscription.updated`, and `invoice.payment_made`.
- Complete one monthly and one yearly hosted checkout smoke.
- Confirm cancellation keeps Plus active until the paid-through date.

## Email Domain Batch

When the final domain is chosen:

- Verify the Resend sending domain or subdomain.
- Add required DNS records.
- Set `EMAIL_FROM` to the verified sender.
- Run `npm run job:price-alerts` with dry-run mode.
- Run one controlled live smoke with `PRICE_ALERT_DIGEST_TEST_RECIPIENT`.
- Clear the test recipient only when ready for real beta digests.

## Monitoring And Recovery

Minimum beta monitoring:

- Public uptime check for `/`.
- Error monitoring for app/API exceptions.
- Alert when Square webhook failures occur.
- Alert when `job_runs` records fail or stall.
- Daily database backup completion alert.
- Manual runbook for disabling checkout, pausing email digests, and reverting a deployment.

## Current Open Items

- Final product name and domain are not chosen.
- Production Square app/webhook cannot be finalized without that domain.
- Resend sender verification cannot be finalized without that domain.
- Legal pages are beta drafts and need final contact/entity/domain details.
- Production hosting/database provider has not been selected.
- Production monitoring and backup provider choices are still open.
