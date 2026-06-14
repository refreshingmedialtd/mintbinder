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

restart_app() {
  if ! command -v pm2 >/dev/null 2>&1; then
    echo "PM2 is not available in this deploy shell; restart the registered 20i Node app manually."
    return 0
  fi

  echo "Reloading Mint Binder runtime via PM2..."

  for app_name in MintBinder Mint mintbinder; do
    if pm2 describe "$app_name" >/dev/null 2>&1; then
      echo "Reloading existing PM2 app: $app_name"
      pm2 reload "$app_name" --update-env
      pm2 save >/dev/null 2>&1 || true
      return 0
    fi
  done

  echo "No existing PM2 app found by name; starting from ecosystem.config.js"
  pm2 start ecosystem.config.js --update-env
  pm2 save >/dev/null 2>&1 || true
}

restart_app

echo "Mint Binder deployment finished at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
