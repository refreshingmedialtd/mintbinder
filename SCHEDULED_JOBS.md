# Mint Binder Scheduled Jobs

This runbook covers the production jobs that should run after the app is deployed to `mintbinder.co.uk`.

## Required Environment

Confirm these values exist in the production `.env` file before scheduling anything:

```sh
SCHEDULED_JOB_APP_URL="https://mintbinder.co.uk"
JOB_SECRET="..."
POKEMON_TCG_USD_TO_GBP_RATE="..."
POKEMON_TCG_EUR_TO_GBP_RATE="..."
TCGCSV_USD_TO_GBP_RATE="..."
PRICE_ALERT_DIGEST_DRY_RUN="true"
PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS="false"
JOB_MONITOR_DRY_RUN="true"
```

Use `POKEMON_TCG_PRICING_PAGE="auto"` or leave it unset. Auto mode lets the scheduled pricing route inspect recent successful `pricing_refresh` runs and choose the next page. If a full pass completes, the next run starts back at page 1 so historical snapshots continue to build.

## First Manual Checks

Run these once from the deployed repository path before adding recurring schedules:

```sh
cd /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder
/usr/bin/bash scripts/cron-live-health.sh
/usr/bin/bash scripts/cron-live-pricing.sh
/usr/bin/bash scripts/cron-live-sealed-pricing.sh
/usr/bin/bash scripts/cron-monitor-jobs.sh
```

Expected results:

- `job:live-health` returns `ok: true`.
- `job:live-pricing` calls `/api/jobs/scheduled-pricing`, creates a `pricing_refresh` job run, and reports `selectedPage`.
- `job:live-sealed-pricing` creates a `sealed_pricing_refresh` job run.
- `monitor:jobs` prints a report. It can return a non-zero exit code when recent job failures exist, which is useful for alerting.

## Recommended Initial Schedule

Start conservative while beta data volume is small:

| Job | Command | Suggested cadence |
| --- | --- | --- |
| Health smoke | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-health.sh` | Every 30 minutes |
| Card pricing history | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-pricing.sh` | Daily around 02:10 UK time |
| Sealed pricing history | `/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-sealed-pricing.sh` | Daily around 03:10 UK time |
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
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-monitor-jobs.sh
/usr/bin/bash /home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder/scripts/cron-live-price-alerts.sh
```

If 20i does not expose scheduled shell commands for this package, use an HTTPS scheduler that can send headers. The card pricing endpoint is:

```text
POST https://mintbinder.co.uk/api/jobs/scheduled-pricing
Authorization: Bearer <JOB_SECRET>
Content-Type: application/json

{}
```

The sealed pricing and price-alert endpoints are:

```text
POST https://mintbinder.co.uk/api/jobs/sealed-pricing-refresh
POST https://mintbinder.co.uk/api/jobs/price-alerts
```

They use the same `Authorization: Bearer <JOB_SECRET>` header. Keep the request bodies small and explicit while beta testing, for example:

```json
{"groupLimit":5,"priceOnlyUnpriced":false}
```

```json
{"dryRun":true}
```

## Operating Notes

- Scheduled card pricing writes new snapshots over time, so price history charts become more useful the longer the job runs.
- `POKEMON_TCG_PRICING_MAX_PAGES` defaults to `2` for scheduled runs to avoid long jobs. Increase slowly after the job history is clean.
- Keep `TCGCSV_SEALED_GROUP_LIMIT` small at first. Sealed pricing can become expensive in provider calls if run too broadly.
- Review Operations job history after the first few scheduled runs. Do not enable live recipient emails until pricing and monitor jobs are consistently clean.
