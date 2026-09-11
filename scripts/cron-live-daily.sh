#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

status=0

# A small product-ID allowlist fills source gaps and preserves exact stamped
# variants without importing TCGCSV's broad miscellaneous catalogue.
npm run job:live-reviewed-card-catalogue || status=$?

# Set discovery changes slowly and no longer shares the hourly pricing burst.
npm run job:live-catalogue-discovery || status=$?

# This maintenance schedule is intentionally incapable of emailing users. Use
# cron-live-price-alerts.sh only after a separately approved live-send change.
PRICE_ALERT_DIGEST_DRY_RUN=true \
PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS=false \
npm run job:live-price-alerts || status=$?

exit "$status"
