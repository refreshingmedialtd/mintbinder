# Mint Binder Scheduled Jobs

This runbook covers the production jobs that should run after the app is deployed to `mintbinder.co.uk`.

## Required Environment

Confirm these values exist in the production `.env` file before scheduling anything:

```sh
SCHEDULED_JOB_APP_URL="https://mintbinder.co.uk"
JOB_SECRET="..."
EXCHANGE_RATES_PROVIDER="frankfurter"
EXCHANGE_RATES_AUTO="true"
EXCHANGE_RATES_ALLOW_ENV_FALLBACK="true"
TCGCSV_JAPAN_CARD_GROUP_LIMIT="1"
TCGCSV_JAPAN_CARD_ONLY_UNPRICED_GROUPS="false"
TCGCSV_JAPAN_CARD_PRICE_ONLY_UNPRICED="false"
TCGCSV_SEALED_GROUP_LIMIT="1"
TCGCSV_SEALED_PRICE_ONLY_UNPRICED="false"
TCGCSV_SEALED_WRITE_PRICES="true"
TCGCSV_SEALED_WAIT_MS="120"
PRICE_ALERT_DIGEST_DRY_RUN="true"
PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS="false"
JOB_MONITOR_DRY_RUN="true"
```

Pricing jobs fetch fresh GBP exchange rates from Frankfurter by default. Keep `POKEMON_TCG_USD_TO_GBP_RATE`, `POKEMON_TCG_EUR_TO_GBP_RATE`, and `TCGCSV_USD_TO_GBP_RATE` only as optional fallback values in case the exchange-rate provider is temporarily unavailable. Set `EXCHANGE_RATES_PROVIDER="manual"` only if you deliberately want to disable automatic exchange rates.

Use `POKEMON_TCG_PRICING_STRATEGY="sets"` or leave it unset. Set rotation is the default because the Pokemon TCG API can reject deep full-catalogue page requests once the scheduler reaches later pages. The live helper asks Mint Binder to select the least-recently refreshed Pokemon TCG sets from the local database and refreshes those sets in small batches.

Use `POKEMON_TCG_SET_PRICING_LIMIT="8"` with an hourly schedule for normal card-pricing maintenance. The live helper splits this into one-set HTTP calls by default with `POKEMON_TCG_SET_PRICING_REQUEST_LIMIT="1"`, avoiding 20i gateway timeouts and provider deep-page failures. With roughly 173 Pokemon TCG sets in production, eight sets per hour is enough to touch the full set list in about a day. Keep `POKEMON_TCG_PRICING_BATCH_WAIT_MS="1500"` and `POKEMON_TCG_API_RETRY_ATTEMPTS="3"` unless provider stability changes.

Keep these values in production unless there is a specific reason to change them:

```sh
POKEMON_TCG_PRICING_STRATEGY="sets"
POKEMON_TCG_SET_PRICING_LIMIT="8"
POKEMON_TCG_SET_PRICING_REQUEST_LIMIT="1"
POKEMON_TCG_SET_PRICING_MAX_PAGES_PER_SET="4"
POKEMON_TCG_SET_PRICING_PAGE_SIZE="250"
POKEMON_TCG_PRICING_BATCH_WAIT_MS="1500"
POKEMON_TCG_API_RETRY_ATTEMPTS="3"
```

For one-off manual recovery/debugging only, set `POKEMON_TCG_PRICING_STRATEGY="pages"` and optionally `POKEMON_TCG_PRICING_PAGE`. Do not use full-catalogue page rotation as the normal recurring schedule.

## First Manual Checks

Run these once from the deployed repository path before adding recurring schedules:

```sh
cd /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder
/usr/bin/bash scripts/cron-live-health.sh
/usr/bin/bash scripts/cron-live-pricing.sh
/usr/bin/bash scripts/cron-live-japan-card-pricing.sh
/usr/bin/bash scripts/cron-live-sealed-pricing.sh
/usr/bin/bash scripts/cron-monitor-jobs.sh
```

Expected results:

- `job:live-health` returns `ok: true`.
- `job:live-pricing` calls `/api/jobs/scheduled-set-pricing`, creates `pricing_refresh` job runs, and reports `strategy: "set-rotation"` plus the selected sets.
- `job:live-japan-card-pricing` calls `/api/jobs/international-card-pricing`, creates a `pricing_refresh` job run, and reports `categoryId: 85` plus `language: "ja"`.
- `job:live-sealed-pricing` creates a `sealed_pricing_refresh` job run.
- `monitor:jobs` prints a report. It can return a non-zero exit code when recent job failures exist, which is useful for alerting.

## Recommended Initial Schedule

Start conservative while beta data volume is small:

| Job | Command | Suggested cadence |
| --- | --- | --- |
| Health smoke | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-health.sh` | Every 30 minutes |
| Card pricing history | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-pricing.sh` | Hourly, with `POKEMON_TCG_SET_PRICING_LIMIT=8` |
| Japanese card pricing | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-japan-card-pricing.sh` | Hourly at `:40`, with `TCGCSV_JAPAN_CARD_GROUP_LIMIT=1` |
| Sealed pricing history | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-sealed-pricing.sh` | Hourly at `:50`, with `TCGCSV_SEALED_GROUP_LIMIT=1` |
| Job monitor | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-monitor-jobs.sh` | Hourly |
| Price alert digest dry run | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-price-alerts.sh` | Daily around 08:00 UK time |

Keep `PRICE_ALERT_DIGEST_DRY_RUN=true` until beta recipients are approved. When ready, do one controlled live send with `PRICE_ALERT_DIGEST_TEST_RECIPIENT` before enabling `PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS=true`.

## 20i Scheduled Task Command Shape

If 20i provides a scheduled task or cron command field, use one command per schedule. Prefer the wrapper scripts below because some hosting control panels do not reliably save shell chains such as `cd ... && npm ...`.

```sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-pricing.sh
```

Use the same shape for the other commands:

```sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-sealed-pricing.sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-japan-card-pricing.sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-monitor-jobs.sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-price-alerts.sh
```

If 20i does not expose scheduled shell commands for this package, use an HTTPS scheduler that can send headers. The preferred card pricing endpoint is:

```text
POST https://mintbinder.co.uk/api/jobs/scheduled-set-pricing
Authorization: Bearer <JOB_SECRET>
Content-Type: application/json

{"limit":1}
```

The legacy full-catalogue page endpoint remains available for manual debugging only:

```text
POST https://mintbinder.co.uk/api/jobs/scheduled-pricing
```

The sealed pricing and price-alert endpoints are:

```text
POST https://mintbinder.co.uk/api/jobs/sealed-pricing-refresh
POST https://mintbinder.co.uk/api/jobs/international-card-pricing
POST https://mintbinder.co.uk/api/jobs/price-alerts
```

They use the same `Authorization: Bearer <JOB_SECRET>` header. Keep the request bodies small and explicit while beta testing, for example:

```json
{"groupLimit":5,"priceOnlyUnpriced":false}
```

```json
{"groupLimit":4,"priceOnlyUnpriced":true}
```

```json
{"dryRun":true}
```

## Operating Notes

- Scheduled card pricing writes new snapshots over time, so price history charts become more useful the longer the job runs.
- `POKEMON_TCG_SET_PRICING_LIMIT` controls how many sets a live pricing run refreshes. `POKEMON_TCG_SET_PRICING_REQUEST_LIMIT` defaults to `1`, so the live helper sends several small set-refresh requests rather than one long request. `POKEMON_TCG_PRICING_BATCH_WAIT_MS` pauses between those calls, and `POKEMON_TCG_API_RETRY_ATTEMPTS` retries transient Pokemon TCG API `429`/`5xx` responses before an individual set attempt is marked failed. Keep the hourly job history clean before raising set batch sizes further.
- Keep `TCGCSV_SEALED_GROUP_LIMIT=1`, `TCGCSV_SEALED_PRICE_ONLY_UNPRICED=false`, and `TCGCSV_SEALED_WRITE_PRICES=true` for hourly sealed pricing history. This mirrors the English and Japanese card pricing pattern: each run refreshes one matched TCGCSV group, fills blanks, and writes fresh snapshots for products that already have prices.
- Japanese single-card pricing uses TCGCSV's `Pokemon Japan` category (`TCGCSV_JAPAN_CARD_CATEGORY_ID=85`) and writes source `tcgcsv-japan-card` snapshots for `language=ja`. Use `TCGCSV_JAPAN_CARD_GROUP_LIMIT=1`, `TCGCSV_JAPAN_CARD_ONLY_UNPRICED_GROUPS=false`, and `TCGCSV_JAPAN_CARD_PRICE_ONLY_UNPRICED=false` for hourly production runs so each run fills missing Japanese prices and also creates fresh price-history snapshots for the oldest Japanese group.
- Traditional Chinese, Simplified Chinese, and Korean pricing should stay as visible gaps until a reviewed CSV/licensed source is available. Do not scrape official pages or require Cardmarket personal/business verification for this lane.
- Review Operations job history after the first few scheduled runs. Do not enable live recipient emails until pricing and monitor jobs are consistently clean.
