#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# The Node command loads .env itself. Scheduled deletion only occurs when both
# OPERATIONAL_RETENTION_CRON_CONFIRM and OPERATIONAL_RETENTION_ALLOW_DELETE are true.
npm run ops:operational-retention -- --scheduled
