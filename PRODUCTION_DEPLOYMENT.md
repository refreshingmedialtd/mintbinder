# Mint Binder Production Deployment Runbook

Last updated: 2026-06-14

Mint Binder is not ready for a public production launch until production provider accounts, DNS, email, monitoring, and final legal details are complete. This runbook defines the deployment path so staging can be prepared without guessing.

## Recommended First Deployment Shape

- App host: 20i NodeJS Optimised Managed Cloud Server for `mintbinder.co.uk`.
- Database: Neon PostgreSQL in Europe/London region for deployment testing, upgraded before real beta users.
- Payments: Square production app, production access token, production location, production subscription plan variations, and a production webhook URL.
- Email: 20i SMTP mailbox with SPF/DKIM/DMARC configured, or Resend/equivalent transactional email if SMTP deliverability is not good enough.
- Jobs: protected app routes triggered manually from Operations at first, then scheduled by 20i or another trusted scheduler using `JOB_SECRET`.
- Monitoring: error tracking, uptime checks, job/webhook failure alerts, and database backup monitoring.

## Environment Validation

Run this before staging, before public beta, and after changing provider credentials:

```sh
npm run qa:production-env
```

The validator intentionally fails against local/sandbox values. It checks for production-grade app URLs, Auth.js secret, job secret, database URL, Square configuration, webhook URL/signature, email sender, and pricing exchange-rate readiness.

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
- `SCHEDULED_JOB_APP_URL=https://mintbinder.co.uk` for live scheduled job helpers.

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

- `EMAIL_PROVIDER`: `smtp` for 20i SMTP, or `resend` if using Resend instead.
- `EMAIL_FROM`: verified sender on `mintbinder.co.uk`, for example `Mint Binder <alerts@mintbinder.co.uk>`.
- `EMAIL_SMOKE_TO`: controlled recipient mailbox for the one-off email delivery smoke.
- `SMTP_HOST`: 20i outgoing SMTP host, usually `smtp.stackmail.com`.
- `SMTP_PORT`: secure SMTP port, usually `465` for SSL or `587` for STARTTLS.
- `SMTP_SECURE`: `true` for port 465, `false` for port 587.
- `SMTP_USER`: 20i mailbox username.
- `SMTP_PASSWORD`: 20i mailbox password.
- `RESEND_API_KEY`: required only when `EMAIL_PROVIDER=resend`.
- `JOB_MONITOR_DRY_RUN=true` until monitor emails are approved; set to `false` when ready to alert.
- `JOB_MONITOR_ALERT_TO`: mailbox for operational alerts. Falls back to `EMAIL_SMOKE_TO` if not set.
- `JOB_MONITOR_LOOKBACK_MINUTES`: failed-job lookback window, default `90`.
- `JOB_MONITOR_STALE_MINUTES`: running-job stale threshold, default `45`.
- `PRICE_ALERT_DIGEST_DRY_RUN=true` until the controlled live smoke is complete.
- `PRICE_ALERT_DIGEST_TEST_RECIPIENT`: controlled mailbox for first live smoke.
- `PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS=false` until real beta digests are approved.

Pricing:

- `EXCHANGE_RATES_PROVIDER`: `frankfurter` for automatic live GBP rates, or `manual` only if rates will be maintained in `.env`.
- `EXCHANGE_RATES_AUTO`: `true` for automatic live GBP rates.
- `EXCHANGE_RATES_ALLOW_ENV_FALLBACK`: `true` so optional `.env` rates can keep pricing jobs running during provider outages.
- `POKEMON_TCG_USD_TO_GBP_RATE`: optional fallback USD conversion rate.
- `POKEMON_TCG_EUR_TO_GBP_RATE`: optional fallback EUR conversion rate for Cardmarket fallback.
- `TCGCSV_USD_TO_GBP_RATE`: optional fallback USD conversion rate for TCGCSV imports.
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

1. Finalize support email, legal contact, and legal page copy for `mintbinder.co.uk`.
2. Create the production database and enable automated backups.
3. Add production env vars to the app host.
4. Run `npm run qa:production-env`; fix every blocker.
5. Run `npm run db:deploy`.
6. Deploy the app.
   - 20i Git Version Control should use `/home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/deploy-20i.sh` as the deployment script path. Verify each deploy by checking the expected route exists on `https://mintbinder.co.uk`.
   - The script should rebuild the app and reload the registered PM2 process. If the deploy output does not show `Reloading Mint Binder runtime via PM2`, restart the registered NodeJS app manually before testing.
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

## Production Catalogue Bootstrap

Status on 2026-06-14:

- Live card catalogue: 20,359 cards across 173 Pokemon TCG sets.
- Card images: 100% coverage.
- Set deficits: 0.
- Duplicate Pokemon TCG provider groups: 0.
- Card pricing: 19,302 priced cards, 94.8% coverage, using Pokemon TCG API plus TCGCSV.
- Sealed catalogue: 1,936 sealed products, 100% image coverage.
- Sealed pricing: 1,457 priced sealed products, 75.3% coverage from TCGCSV.

Use the production bootstrap helpers when a fresh hosted database needs catalogue data:

```sh
npm run job:production-bootstrap
npm run job:production-set-bootstrap
```

For set-by-set production card pricing, use the unpriced-set controls so repeat runs target the largest gaps first:

```sh
BOOTSTRAP_SET_ONLY_MISSING=false \
BOOTSTRAP_SET_ONLY_UNPRICED=true \
BOOTSTRAP_SET_MIN_UNPRICED=25 \
BOOTSTRAP_SET_SKIP_CATALOGUE=true \
BOOTSTRAP_SET_RUN_PRICING=true \
npm run job:production-set-bootstrap
```

For high-volume TCGCSV card pricing enrichment, target only matched sets that still have unpriced cards:

```sh
TCGCSV_CARD_ONLY_UNPRICED_GROUPS=true \
TCGCSV_CARD_MIN_UNPRICED=25 \
TCGCSV_CARD_PRICE_ONLY_UNPRICED=true \
npm run job:tcgcsv-card-pricing
```

For sealed product import and pricing:

```sh
TCGCSV_SEALED_PRICE_ONLY_UNPRICED=true npm run job:sealed-tcgcsv
```

After any production catalogue or pricing import, run:

```sh
npm run report:catalogue-gaps
```

Expected remaining gaps: older/legacy card pricing, selected promos, and sealed products without usable TCGCSV prices. Use PriceCharting or another sealed-price provider for the next major sealed-pricing lift.

For recurring pricing maintenance, use [SCHEDULED_JOBS.md](SCHEDULED_JOBS.md). The preferred card-pricing schedule calls `npm run job:live-pricing`, which posts to `/api/jobs/scheduled-pricing`; that route selects the next pricing page from recent successful `pricing_refresh` runs, writes new snapshots, and cycles back to page 1 after a full pass.

## Square Domain Batch

For `mintbinder.co.uk`:

- Set `NEXT_PUBLIC_APP_URL` and `AUTH_URL` to the final HTTPS origin.
- Create or update the Square production webhook subscription at `/api/billing/webhook`.
- Copy the production `SQUARE_WEBHOOK_SIGNATURE_KEY`.
- Copy the production `SQUARE_WEBHOOK_SUBSCRIPTION_ID`.
- Confirm Square events include `subscription.created`, `subscription.updated`, and `invoice.payment_made`.
- Complete one monthly and one yearly hosted checkout smoke.
- Confirm cancellation keeps Plus active until the paid-through date.

## Email Domain Batch

For `mintbinder.co.uk`:

- Create a 20i mailbox for app notifications, such as `alerts@mintbinder.co.uk`.
- Confirm SPF, DKIM, and DMARC DNS records are configured for the sending domain.
- Set `EMAIL_FROM` to the verified sender.
- Set `EMAIL_PROVIDER=smtp` plus the 20i `SMTP_*` values.
- Set `EMAIL_SMOKE_TO` to a mailbox you control and run `npm run email:smoke`.
- After deployment, run `npm run email:production-smoke` to send through the live app's protected email-smoke route.
- Run `npm run job:price-alerts` with dry-run mode.
- If no eligible Plus users exist yet, run `npm run job:price-alert-fixture -- setup --confirm` to create one disposable alert fixture.
- Run one controlled live smoke with `PRICE_ALERT_DIGEST_TEST_RECIPIENT`; if that is not set, the job uses `EMAIL_SMOKE_TO` while live recipients remain disabled.
- Run `npm run job:price-alert-fixture -- cleanup --confirm` after the smoke passes.
- Clear the test recipient only when ready for real beta digests.

Status on 2026-06-13: local and production 20i SMTP smoke tests passed for `alerts@mintbinder.co.uk`; SPF, DKIM selector `s1`, and DMARC are visible publicly. A disposable fixture script is available for creating one safe Plus test user and alert when the live database has no eligible recipients. The controlled price-alert digest dry run and live send smoke both passed, and the disposable fixture rows were cleaned up afterwards.

## 20i Deployment Script Setup

Observed on 2026-06-13:

- Git Version Control history shows new commits are pulled correctly.
- The deployment modal output only shows Git checkout/fetch status.
- It does not show `npm ci`, `npm run db:generate`, `npm run build`, or Next.js build output.
- New Next route handlers remained unavailable until a temporary `app.js` server-level fallback was added.

Resolved on 2026-06-14:

- 20i support confirmed the Git Version Control deployment script field expects a path to a bash script, not inline shell commands.
- The path-based deployment script now runs successfully.
- The temporary custom-server API fallbacks have been removed from `app.js`; the custom server now delegates API traffic to Next route handlers.

The deployment script is in the repository at:

```sh
scripts/deploy-20i.sh
```

For the 20i deployment script field, use the absolute path:

```sh
/home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/deploy-20i.sh
```

The script runs:

```sh
npm install --include=dev --no-audit --no-fund
npm run db:generate
npm run db:deploy
npm run build
pm2 reload <registered app> --update-env
```

Expected behaviour: after Git deploy, 20i should run the script from the repository root, apply pending Prisma migrations, rebuild `.next`, and restart or refresh the registered NodeJS app so new Next routes are available. The custom `app.js` entrypoint pins Next's runtime directory to the repository folder so 20i's working directory cannot make the app read the wrong `.next` output.

The custom server also forces `Cache-Control: no-store` headers on normal app/API routes so the HTML app shell is not cached across deploys. Hashed Next static assets under `/_next/static/` remain cacheable.

Note: the first successful script run auto-installed missing build-time dev dependencies because `NODE_ENV=production` had been set before dependency installation, leaving `package.json` and `package-lock.json` modified on the server. The script now restores those files and installs with dev dependencies before building. Avoid `npm ci` or `rm -rf .next` in the live app directory: both can temporarily remove files that the currently running Node process may still need.

Follow-up to confirm with support if needed: whether 20i exposes a preferred restart command if the PM2 reload fallback does not refresh the registered NodeJS app.

## Monitoring And Recovery

Minimum beta monitoring:

- Public uptime check for `/api/health`.
- Error monitoring for app/API exceptions.
- Alert when Square webhook failures occur.
- Run `npm run monitor:jobs` on a schedule to alert when `job_runs` records fail or stall. Keep `JOB_MONITOR_DRY_RUN=true` for the first dry run, then set it to `false` when alert emails are approved. Schedule the live pricing helpers from [SCHEDULED_JOBS.md](SCHEDULED_JOBS.md) once the first manual run passes.
- Daily database backup completion alert.
- Manual runbook for disabling checkout, pausing email digests, and reverting a deployment.

## Current Open Items

- Production Square app/webhook must be configured for `mintbinder.co.uk`.
- Keep the 20i Git deployment script path set to `/home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/deploy-20i.sh` and verify runtime routes after future deploys, including the PM2 reload output.
- Controlled live price-alert digest smoke is complete; decide the real digest schedule before enabling beta recipient emails.
- Production catalogue and pricing bootstrap is complete enough for beta; keep the new bootstrap helpers for future fresh databases and new-set refreshes.
- `/api/health`, `/api/jobs/scheduled-pricing`, the live job helpers, and `npm run monitor:jobs` are available for first-pass uptime, pricing history, and job-run monitoring; schedule them before beta.
- Legal pages are beta drafts and need final company/address review plus active support email verification.
- 20i hosting and Neon database are active; Neon should be upgraded before real beta users.
- Production monitoring and backup provider choices are still open.
