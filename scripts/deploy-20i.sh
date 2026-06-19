#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Mint Binder deployment started at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "Working directory: $(pwd)"

export NEXT_TELEMETRY_DISABLED=1
export MINTBINDER_DEPLOY_SCRIPT_VERSION="2026-06-19.1"
export MINTBINDER_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
export MINTBINDER_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

echo "Deploy script version: $MINTBINDER_DEPLOY_SCRIPT_VERSION"
echo "Deploying branch: $MINTBINDER_BRANCH"
echo "Deploying commit: $MINTBINDER_COMMIT"

# Clean up package metadata if a previous build auto-installed missing dev tools on the server.
git restore package.json package-lock.json 2>/dev/null || true

node -e 'const fs = require("node:fs"); const info = { branch: process.env.MINTBINDER_BRANCH || "unknown", commit: process.env.MINTBINDER_COMMIT || "unknown", deployScriptVersion: process.env.MINTBINDER_DEPLOY_SCRIPT_VERSION || "unknown", generatedAt: new Date().toISOString(), nodeVersion: process.version }; fs.writeFileSync(".mintbinder-build.json", `${JSON.stringify(info, null, 2)}\n`);'

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
