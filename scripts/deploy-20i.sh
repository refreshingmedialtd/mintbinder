#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Mint Binder deployment started at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "Working directory: $(pwd)"

export NEXT_TELEMETRY_DISABLED=1

# Clean up package metadata if a previous build auto-installed missing dev tools on the server.
git restore package.json package-lock.json 2>/dev/null || true

npm ci --include=dev
npm run db:generate
npm run db:deploy

export NODE_ENV=production
npm run build

echo "Mint Binder deployment finished at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
