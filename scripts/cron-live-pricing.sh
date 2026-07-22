#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

status=0

npm run job:live-pricing || status=$?
npm run job:live-english-card-pricing || status=$?

exit "$status"
