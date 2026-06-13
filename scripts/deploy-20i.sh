#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Mint Binder deployment started at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "Working directory: $(pwd)"

export NODE_ENV=production
export NEXT_TELEMETRY_DISABLED=1

npm ci
npm run db:generate
npm run db:deploy
npm run build

echo "Mint Binder deployment finished at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
