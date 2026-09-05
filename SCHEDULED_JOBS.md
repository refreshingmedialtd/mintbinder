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
TCGCSV_JAPAN_CARD_SOURCE="tcgcsv-japan-card"
TCGCSV_JAPAN_CARD_ONLY_UNPRICED_GROUPS="false"
TCGCSV_JAPAN_CARD_PRICE_ONLY_UNPRICED="false"
TCGCSV_SEALED_GROUP_LIMIT="1"
TCGCSV_SEALED_PRICE_ONLY_UNPRICED="false"
TCGCSV_SEALED_WRITE_PRICES="true"
TCGCSV_SEALED_WAIT_MS="120"
TCGDEX_SCHEDULE_LANGUAGES="ja,zh-tw,zh-cn,ko"
TCGDEX_SCHEDULE_PAGE_SIZE="100"
TCGDEX_SCHEDULE_MAX_PAGES="1"
CARDTRADER_API_TOKEN="<bearer token from CardTrader account settings>"
CARDTRADER_SEALED_SET_LIMIT="1"
CARDTRADER_SEALED_PRODUCT_LIMIT="5"
CARDTRADER_SEALED_PRICE_ONLY_UNPRICED="false"
CARDTRADER_SEALED_WRITE_PRICES="true"
PRICECHARTING_GRADED_ENABLED="false"
PRICECHARTING_GRADED_WRITE_PRICES="false"
PRICECHARTING_LICENCE_CONFIRMED="false"
PRICE_ALERT_DIGEST_DRY_RUN="true"
PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS="false"
JOB_MONITOR_DRY_RUN="true"
JOB_MONITOR_CATALOGUE_DISCOVERY_MAX_AGE_HOURS="30"
JOB_MONITOR_INTERNATIONAL_CATALOGUE_MAX_AGE_HOURS="14"
JOB_MONITOR_CARD_PRICING_MAX_AGE_HOURS="3"
JOB_MONITOR_ENGLISH_CARD_PRICING_MAX_AGE_HOURS="3"
JOB_MONITOR_JAPANESE_CARD_PRICING_MAX_AGE_HOURS="3"
JOB_MONITOR_SEALED_PRICING_MAX_AGE_HOURS="3"
JOB_MONITOR_PASSWORD_RESET_MAX_AGE_MINUTES="10"
JOB_MONITOR_BILLING_RETIREMENT_MAX_AGE_MINUTES="30"
OPERATIONAL_RETENTION_ACCOUNT_TOKEN_DAYS="30"
OPERATIONAL_RETENTION_AUTH_THROTTLE_DAYS="30"
OPERATIONAL_RETENTION_BILLING_CHECKOUT_INTENT_DAYS="730"
OPERATIONAL_RETENTION_BILLING_WEBHOOK_DAYS="730"
OPERATIONAL_RETENTION_JOB_RUN_DAYS="365"
OPERATIONAL_RETENTION_NOTIFICATION_DELIVERY_DAYS="365"
OPERATIONAL_RETENTION_PASSWORD_RESET_OUTBOX_DAYS="365"
OPERATIONAL_RETENTION_BATCH_SIZE="1000"
OPERATIONAL_RETENTION_ALLOW_DELETE="false"
OPERATIONAL_RETENTION_CRON_CONFIRM="false"
BILLING_CHECKOUT_RETIREMENT_BATCH_SIZE="100"
PASSWORD_RESET_DELIVERY_BATCH_SIZE="50"
```

`qa:deployment-env` deliberately allows safe beta gates such as sandbox billing,
dry-run monitoring, and draft legal copy. Before any unrestricted or paid public
launch, run `npm run qa:public-launch`. That stricter check requires the final
operator/address/support/privacy values and review flags, and also scans the
legal page source for unresolved draft/pre-launch wording. Environment flags do
not override draft copy; both must be complete.

The deployed English pricing wrapper also refreshes one oldest-priced TCGCSV English group per hourly run. Its timeout-safe defaults are built into the live helper (`groupLimit=1`, `priceOnlyUnpriced=false`, `writePrices=true`), so this does not require another scheduled task or any new environment value.

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
POKEMON_TCG_API_TIMEOUT_MS="15000"
POKEMON_TCG_API_RETRY_ATTEMPTS="3"
```

For one-off manual recovery/debugging only, set `POKEMON_TCG_PRICING_STRATEGY="pages"` and optionally `POKEMON_TCG_PRICING_PAGE`. Do not use full-catalogue page rotation as the normal recurring schedule.

## First Manual Checks

Run these once from the deployed repository path before adding recurring schedules:

```sh
cd /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder
/usr/bin/bash scripts/cron-live-health.sh
/usr/bin/bash scripts/cron-live-daily.sh
/usr/bin/bash scripts/cron-live-pricing.sh
/usr/bin/bash scripts/cron-live-japan-card-pricing.sh
/usr/bin/bash scripts/cron-live-sealed-pricing.sh
/usr/bin/bash scripts/cron-live-international-catalogue.sh
/usr/bin/bash scripts/cron-password-reset-delivery.sh
/usr/bin/bash scripts/cron-monitor-jobs.sh
/usr/bin/bash scripts/cron-billing-checkout-retirement.sh
/usr/bin/bash scripts/cron-operational-retention.sh
```

Expected results:

- `job:live-health` returns `ok: true`.
- `cron-live-daily.sh` refreshes the slowly changing set catalogue and records a forced dry-run price-alert digest. The wrapper cannot email real users.
- `cron-live-pricing.sh` runs the Pokemon TCG set rotation, then refreshes one TCGCSV English group. Both calls create `pricing_refresh` job runs, and either may fail without preventing the other from being attempted.
- `job:live-japan-card-pricing` calls `/api/jobs/international-card-pricing`, creates a `pricing_refresh` job run, and reports `categoryId: 85` plus `language: "ja"`.
- `job:live-sealed-pricing` creates a `sealed_pricing_refresh` job run. With `CARDTRADER_API_TOKEN` configured, its result also contains a `secondSource` diagnostic object for `cardtrader-sealed`; treat the lane as healthy only when its status is `succeeded` and it is producing snapshots.
- `cron-live-international-catalogue.sh` refreshes one bounded 100-card TCGdex page. It chooses the least-recently visited configured language, advances that language's durable job-history cursor, and wraps only after reaching the provider total.
- `cron-password-reset-delivery.sh` processes a bounded outbox batch. Unknown-recipient decoys are discarded without email; once a real delivery crosses the attempt boundary, any error or crash leaves it unresolved and suppresses automatic resend.
- `monitor:jobs` prints a report. It can return a non-zero exit code when recent job failures exist, which is useful for alerting.
- `cron-billing-checkout-retirement.sh` checks provider truth and retires expired hosted checkout links in a bounded batch; completed or ambiguous attempts remain available for webhook reconciliation.
- `cron-operational-retention.sh` prints a structured retention report with per-table cutoffs and candidate counts. With both retention confirmation flags left at their defaults, it cannot delete rows.

## Recommended Initial Schedule

Start conservative while beta data volume is small:

| Job | Command | Suggested cadence |
| --- | --- | --- |
| Health smoke | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-health.sh` | Every 30 minutes |
| Daily discovery + alert dry run | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-daily.sh` | Daily around 08:00 UK time |
| Card pricing history | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-pricing.sh` | Hourly, with `POKEMON_TCG_SET_PRICING_LIMIT=8` |
| Japanese card pricing | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-japan-card-pricing.sh` | Hourly at `:40`, with `TCGCSV_JAPAN_CARD_GROUP_LIMIT=1` |
| International catalogue | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-international-catalogue.sh` | Every 6 hours; one bounded language/page per run |
| Sealed pricing history | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-sealed-pricing.sh` | Hourly at `:50`, with `TCGCSV_SEALED_GROUP_LIMIT=1` and `TCGCSV_SEALED_PRODUCT_LIMIT=40` |
| Password-reset delivery | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-password-reset-delivery.sh` | Every minute |
| Job monitor | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-monitor-jobs.sh` | Hourly |
| Billing checkout retirement | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-billing-checkout-retirement.sh` | Every 10 minutes |
| Operational retention audit | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-operational-retention.sh` | Monthly; keep both deletion flags false until reports and backups have been reviewed |

Keep `PRICE_ALERT_DIGEST_DRY_RUN=true` until beta recipients are approved. When ready, do one controlled live send with `PRICE_ALERT_DIGEST_TEST_RECIPIENT` before enabling `PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS=true`.

## 20i Scheduled Task Command Shape

If 20i provides a scheduled task or cron command field, use one command per schedule. Prefer the wrapper scripts below because some hosting control panels do not reliably save shell chains such as `cd ... && npm ...`.

```sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-pricing.sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-daily.sh
```

Use the same shape for the other commands:

```sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-sealed-pricing.sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-japan-card-pricing.sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-international-catalogue.sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-monitor-jobs.sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-price-alerts.sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-password-reset-delivery.sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-billing-checkout-retirement.sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-operational-retention.sh
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
POST https://mintbinder.co.uk/api/jobs/billing-checkout-retirement
POST https://mintbinder.co.uk/api/jobs/password-reset-delivery
```

They use the same `Authorization: Bearer <JOB_SECRET>` header. Keep the request bodies small and explicit while beta testing, for example:

```json
{"groupLimit":1,"productLimit":40,"priceOnlyUnpriced":false}
```

```json
{"groupLimit":4,"priceOnlyUnpriced":true}
```

```json
{"dryRun":true}
```

## Operating Notes

- Scheduled card pricing writes new snapshots over time, so price history charts become more useful the longer the job runs. UK-facing valuation selects current UK evidence first, then current European evidence, then converted US references. Converted US data is labelled as a reference and cannot receive a Strong UK confidence rating.
- The existing `cron-live-pricing.sh` command covers Pokemon TCG API set rotation and one TCGCSV English group. Set discovery is deliberately decoupled into the daily wrapper so it does not add another request to the hourly provider burst. Do not add a second 20i task for English TCGCSV pricing.
- `POKEMON_TCG_SET_PRICING_LIMIT` controls how many sets a live pricing run refreshes. `POKEMON_TCG_SET_PRICING_REQUEST_LIMIT` defaults to `1`, so the live helper sends several small set-refresh requests rather than one long request. `POKEMON_TCG_PRICING_BATCH_WAIT_MS` pauses between those calls; `POKEMON_TCG_API_TIMEOUT_MS` bounds each provider attempt; and `POKEMON_TCG_API_RETRY_ATTEMPTS` retries transient Pokemon TCG API `408`/`425`/`429`/`5xx` or transport failures before the affected set is marked degraded and rotation continues. Credentials and other structural `4xx` responses remain fatal. Keep the hourly job history clean before raising set batch sizes further.
- Keep `TCGCSV_SEALED_GROUP_LIMIT=1`, `TCGCSV_SEALED_PRODUCT_LIMIT=40`, `TCGCSV_SEALED_PRICE_ONLY_UNPRICED=false`, and `TCGCSV_SEALED_WRITE_PRICES=true` for hourly sealed pricing history. The live helper defaults to a 40-product batch when `TCGCSV_SEALED_PRODUCT_LIMIT` is not set, records a per-set sealed cursor, fills blanks, and writes fresh snapshots for products that already have prices without making one long web request. A successfully scanned group with no sealed products receives a 30-day cooldown so card-only promo/subset catalogues do not consume hourly rotation slots; an explicit `TCGCSV_SEALED_GROUP_IDS` request bypasses that cooldown for manual rechecks.
- CardTrader is the independent European sealed source. Keep its scheduled batch at one set and five products until observed latency is established. Marketplace references use eligible English listings and are stored as a separate `cardtrader-sealed` series.
- CardTrader mapping first honors reviewed `CARDTRADER_SEALED_ALIASES_JSON` entries, then an unambiguous TCGplayer ID, exact UPC/EAN, or exact normalized product-name and compatible sealed-type match inside the already-matched expansion. A final conservative fallback accepts reordered names only when the complete normalized token multiset and product type match exactly and the expansion contains one unique candidate. Ambiguous or unmatched candidates are returned in `mappingReview`; they are never guessed. A configured CardTrader lane with no snapshots is degraded in pricing health.
- PriceCharting sealed and graded pricing are not in the default schedule. Keep `PRICECHARTING_LICENCE_CONFIRMED=false`, `PRICECHARTING_SEALED_WRITE_PRICES=false`, `PRICECHARTING_GRADED_ENABLED=false`, and `PRICECHARTING_GRADED_WRITE_PRICES=false` until written commercial display permission is confirmed and retained. Both persistence and customer-facing selection fail closed while the permission flag is false. The protected `npm run job:live-graded-card-pricing` helper is available for a deliberately enabled, non-writing small batch. It imports only company-explicit PSA 10, BGS 10, and CGC 10 fields; generic graded fields and special Pristine/Black Label qualifiers are reported but never written. Exact set/name/number/variant matching is mandatory, and ambiguous products require a reviewed `PRICECHARTING_GRADED_ALIASES_JSON` entry.
- Job starts use a bounded same-type overlap lease backed by the existing `job_runs` table. `JOB_RUN_OVERLAP_LEASE_MINUTES=45` prevents scheduler/manual overlaps while allowing an abandoned stale row to expire. Active jobs renew a JSON heartbeat three times per lease without changing their original start time; both overlap detection and stale-run monitoring use that heartbeat. A crashed worker stops renewing automatically, so the lease still expires and the monitor reports the abandoned RUNNING row.
- Hosted checkout URLs have a 30-minute application lease. The ten-minute retirement schedule is provider-aware: it retrieves payment-link/session truth before closing anything, leaves completed or ambiguous attempts correlatable, and only marks a provider-confirmed closed attempt retired. Do not rely on a later customer request to clean these links up.
- The public password-reset request validates with the same account-email normalizer used at registration, then writes an outbox row for both known and unknown recipients. Unknown raw addresses are never persisted. The one-minute protected worker creates reset tokens only after a real row is claimed; stale claims and all post-attempt errors are unresolved, monitored, and never retried automatically because the provider may already have accepted the message.
- The job monitor treats provider warnings, failed/partial set counts, degraded second sources, successful CardTrader runs with zero output, and recent failed billing-webhook events as operational degradation. Billing failures include a total count and bounded provider/event/error details in both the report and alert email.
- Cadence monitoring fingerprints each independent schedule from its request payload, so a healthy English price run cannot hide a stalled Japanese lane and a manual catalogue repair cannot hide a stopped international rotation. Defaults require daily catalogue discovery within 30 hours, international catalogue rotation within 14 hours, each hourly pricing lane within 3 hours, password-reset delivery within 10 minutes, billing checkout retirement within 30 minutes, and price alerts within `JOB_MONITOR_PRICE_ALERT_MAX_AGE_HOURS` (36 by default). Age is based on the last successful run; a newer failed attempt is also reported.
- The job monitor cannot detect its own scheduler being stopped. Keep an independent uptime/heartbeat service outside 20i and alert when the monitor task itself does not report on schedule.
- Japanese single-card pricing uses TCGCSV's `Pokemon Japan` category (`TCGCSV_JAPAN_CARD_CATEGORY_ID=85`) and writes source `tcgcsv-japan-card` snapshots for `language=ja`. Use `TCGCSV_JAPAN_CARD_GROUP_LIMIT=1`, `TCGCSV_JAPAN_CARD_ONLY_UNPRICED_GROUPS=false`, and `TCGCSV_JAPAN_CARD_PRICE_ONLY_UNPRICED=false` for hourly production runs so each run fills missing Japanese prices and also creates fresh price-history snapshots for the oldest Japanese group.
- Traditional Chinese, Simplified Chinese, and Korean pricing should stay as visible gaps until a reviewed CSV/licensed source is available. Do not scrape official pages or require Cardmarket personal/business verification for this lane.
- Review Operations job history after the first few scheduled runs. Do not enable live recipient emails until pricing and monitor jobs are consistently clean.

## Deferred constraint audit

The binder/billing migration installed seven check constraints as `NOT VALID` so
new writes were protected without making the original production migration scan
all existing rows. Audit them read-only before creating a later validation-only
migration:

```sh
npm run db:audit-constraints
```

The command lists every non-validated production constraint, runs explicit
violation counts for the seven known checks, and exits non-zero on violations or
an unknown unaudited constraint. It never runs `ALTER TABLE`, never repairs rows,
and never marks a constraint valid. Retain a zero-violation report and take a
database backup before adding a reviewed `VALIDATE CONSTRAINT` migration.

Image coverage in the catalogue status means that a plausible URL is present;
it is not a claim that every remote object currently responds. Run the bounded,
read-only sample probe separately when auditing provider/CDN health:

```sh
npm run report:image-health
```

By default it probes at most 20 oldest-updated card URLs and 20 sealed URLs with
five concurrent byte-range requests and a five-second timeout. Its reachability
percentages are explicitly sample-scoped and never replace total URL-presence
coverage.

## Price-snapshot capacity and retention

`npm run report:pricing-health` reports the snapshot row count, seven- and thirty-day growth, current table/index storage, average bytes per snapshot, and one-year row/storage forecasts. The monitor treats these defaults as degradation thresholds:

```sh
PRICING_HEALTH_MAX_SNAPSHOT_DAILY_GROWTH="50000"
PRICING_HEALTH_MAX_SNAPSHOT_ANNUAL_ROWS="15000000"
PRICING_HEALTH_MAX_SNAPSHOT_ANNUAL_STORAGE_BYTES="10737418240"
PRICING_HEALTH_MAX_PRICECHARTING_GRADED_AGE_HOURS="720"
PRICING_HEALTH_MIN_PRICECHARTING_GRADED_COVERAGE_PERCENT="80"
PRICING_HEALTH_MIN_PRICECHARTING_GRADED_FRESH_PERCENT="75"
```

Adjust them only after checking the database plan and hosting capacity. Forecasts are deliberately conservative: the seven-day creation rate is projected for a full year.

Retention is a manual, dry-run-first operation and is not scheduled. First inspect a report; this makes no changes:

```sh
npm run ops:price-snapshot-retention -- --days=365 --batch=5000
```

The plan preserves all snapshots inside the retention window and, before the cutoff, preserves the newest observation in each UTC week for every full price identity (item, source/reference, condition, language, variant, and grade). It reports the number of older duplicate weekly rows that would be removed. Review that output and take a database backup before considering an apply run.

An apply is deliberately double-gated and deletes at most one bounded batch:

```sh
PRICE_SNAPSHOT_RETENTION_ALLOW_DELETE=true npm run ops:price-snapshot-retention -- --days=365 --batch=5000 --confirm
```

The script enforces a 90-day minimum even when a lower value is requested. Run another dry-run after every batch; do not schedule deletion until several reviewed production reports establish an appropriate policy.

## Operational record retention

Operational retention is separate from price history and never touches `price_snapshots`, account-owned collection data, wishlists, binders, or subscriptions. Its current conservative defaults make these rows eligible:

- Account tokens more than 30 days past expiry.
- Authentication throttle rows not updated for 30 days, provided they are not currently blocking requests.
- Completed, failed, or provider-retired checkout attempts more than 730 days old. Live and ambiguous attempts are never candidates, and this window can never be shorter than webhook retention because the intent holds the durable provider-payment correlation claim.
- Succeeded or failed billing webhook events processed more than 730 days ago. Processing rows are never candidates.
- Succeeded or failed job runs finished more than 365 days ago. Running rows are never candidates.
- Successfully sent notification-delivery claims more than 365 days old. Claimed or ambiguous deliveries are never routine-deletion candidates and remain visible to the job monitor until reconciled.
- Sent or discarded password-reset outbox rows more than 365 days old. Queued, claimed, or unresolved rows are excluded from routine deletion and remain visible to the job monitor.

All windows and the per-table batch limit are configurable through the `OPERATIONAL_RETENTION_*` values above. The command enforces minimum windows of one day for expired tokens and stale throttles, 90 days for completed billing webhook events and checkout attempts, and 30 days for completed job runs, sent-notification claims, and completed password-reset outbox rows. Checkout intent retention is automatically raised to at least the configured webhook window (730 days by default). Longer periods may be required for a specific payment, accounting, fraud-prevention, dispute, or legal need; confirm the applicable policy before enabling deletion.

Run and retain the structured JSON report first:

```sh
npm run ops:operational-retention
```

The report contains a unique run ID, generation time, exact UTC cutoffs, eligibility rules, candidate counts, and deletion counts without exposing token hashes or row identifiers. Applying one bounded batch requires both gates:

```sh
OPERATIONAL_RETENTION_ALLOW_DELETE=true npm run ops:operational-retention -- --confirm
```

Take a database backup and retain the reviewed dry-run output before applying. After an apply, run a fresh dry-run rather than repeatedly issuing `--confirm` against an old report.

`scripts/cron-operational-retention.sh` passes a scheduled-run marker. It remains a dry-run while `OPERATIONAL_RETENTION_CRON_CONFIRM=false`. Scheduled deletion occurs only when both `OPERATIONAL_RETENTION_CRON_CONFIRM=true` and `OPERATIONAL_RETENTION_ALLOW_DELETE=true` are deliberately configured; start with the monthly audit-only schedule shown above.
