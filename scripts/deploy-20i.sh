#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Mint Binder deployment started at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "Working directory: $(pwd)"

export NEXT_TELEMETRY_DISABLED=1
export MINTBINDER_DEPLOY_SCRIPT_VERSION="2026-08-24.5"
export MINTBINDER_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

if [ "$MINTBINDER_BRANCH" != "unknown" ] && [ "$MINTBINDER_BRANCH" != "HEAD" ]; then
  echo "Preparing clean Git checkout before deploy..."
  git restore package.json package-lock.json 2>/dev/null || true
  git fetch origin "$MINTBINDER_BRANCH"
  git pull --ff-only origin "$MINTBINDER_BRANCH"
fi

export MINTBINDER_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
PREVIOUS_BUILD_INFO_FILE=".mintbinder-build.previous.json"
PREVIOUS_COMMIT=""
PREVIOUS_DIST_DIR=""

if [ -f ".mintbinder-build.json" ]; then
  cp ".mintbinder-build.json" "$PREVIOUS_BUILD_INFO_FILE"
  PREVIOUS_COMMIT="$(node -e 'try { const value = require("./.mintbinder-build.json").commit; if (typeof value === "string") process.stdout.write(value); } catch {}')"
  PREVIOUS_DIST_DIR="$(node -e 'try { const value = require("./.mintbinder-build.json").distDir; if (typeof value === "string") process.stdout.write(value); } catch {}')"
  if [[ "$PREVIOUS_COMMIT" =~ ^[0-9a-f]{40}$ ]] && [ -z "$PREVIOUS_DIST_DIR" ] && [ -d ".next" ]; then
    # A legacy .next build shares root dependencies and is overwritten by the
    # standalone build staging directory. It is deliberately ineligible for
    # automatic rollback: treating the rebuilt .next as the old release could
    # falsely verify metadata while serving new code.
    echo "Legacy .next runtime detected; automatic rollback is disabled for this one transition." >&2
    PREVIOUS_DIST_DIR=""
  elif [[ -n "$PREVIOUS_DIST_DIR" ]] && [[ ! "$PREVIOUS_DIST_DIR" =~ ^\.next-releases/[0-9a-f]{40}(-[0-9]{14}-[0-9]+)?$ ]]; then
    echo "Ignoring unsafe previous build directory from deployment metadata." >&2
    PREVIOUS_DIST_DIR=""
  fi
fi
export MINTBINDER_PREVIOUS_COMMIT="$PREVIOUS_COMMIT"
export MINTBINDER_PREVIOUS_DIST_DIR="$PREVIOUS_DIST_DIR"

echo "Deploy script version: $MINTBINDER_DEPLOY_SCRIPT_VERSION"
echo "Deploying branch: $MINTBINDER_BRANCH"
echo "Deploying commit: $MINTBINDER_COMMIT"

# Seal the previous release with its own metadata before relying on it for
# rollback. This is a one-time compatibility step for builds created by the
# earlier root-pointer-only deployment script.
if [ -n "$PREVIOUS_COMMIT" ] && [[ "$PREVIOUS_DIST_DIR" =~ ^\.next-releases/[0-9a-f]{40}(-[0-9]{14}-[0-9]+)?$ ]] && [ -d "$PREVIOUS_DIST_DIR" ] && [ -f "$PREVIOUS_BUILD_INFO_FILE" ]; then
  node -e 'const fs = require("node:fs"); const path = require("node:path"); const commit = process.env.MINTBINDER_PREVIOUS_COMMIT || ""; const distDir = process.env.MINTBINDER_PREVIOUS_DIST_DIR || ""; if (!/^[0-9a-f]{40}$/.test(commit) || !/^\.next-releases\/[0-9a-f]{40}(?:-[0-9]{14}-[0-9]+)?$/.test(distDir)) throw new Error("Unsafe previous release metadata path."); const target = path.join(distDir, ".mintbinder-build.json"); const root = JSON.parse(fs.readFileSync(".mintbinder-build.previous.json", "utf8")); const info = { ...root, commit, distDir }; if (fs.existsSync(target)) { const existing = JSON.parse(fs.readFileSync(target, "utf8")); if (existing.commit !== commit || existing.distDir !== distDir) throw new Error("Previous immutable release metadata does not match rollback metadata."); } else { fs.writeFileSync(target, `${JSON.stringify(info, null, 2)}\n`, { flag: "wx" }); }'
fi

# Clean up package metadata if a previous build auto-installed missing dev tools on the server.
git restore package.json package-lock.json 2>/dev/null || true

# Build identity is the exact checked-out commit, never a mixture of that
# commit and server-side tracked edits. Preserve unexpected edits for operator
# recovery, but refuse to package or migrate them under the commit attestation.
if ! git diff --quiet --; then
  echo "Deployment preflight failed: tracked working-tree changes are present on the server." >&2
  echo "Review and preserve those changes explicitly before redeploying; this script will not discard them." >&2
  exit 1
fi
if ! git diff --cached --quiet --; then
  echo "Deployment preflight failed: staged server-side changes are present in the Git index." >&2
  echo "Review and preserve those changes explicitly before redeploying; this script will not discard them." >&2
  exit 1
fi
UNTRACKED_FILES="$(git ls-files --others --exclude-standard)"
if [ -n "$UNTRACKED_FILES" ]; then
  echo "Deployment preflight failed: non-ignored untracked files are present in the repository." >&2
  echo "Move, commit, or explicitly ignore them before redeploying so build identity remains attestable." >&2
  exit 1
fi

npm ci --include=dev --no-audit --no-fund
git restore package.json package-lock.json 2>/dev/null || true
npm run db:generate

# 20i's non-login Git deployment shell may not expose its global PM2 binary.
# The locked project dependency provides the same CLI and connects to the
# registered application's PM2 daemon without relying on shell PATH setup.
PM2_BIN=""
PM2_APP_NAME=""

if command -v pm2 >/dev/null 2>&1; then
  PM2_BIN="$(command -v pm2)"
elif [ -x "./node_modules/.bin/pm2" ]; then
  PM2_BIN="./node_modules/.bin/pm2"
else
  echo "Deployment preflight failed: neither global nor project-local PM2 is available." >&2
  exit 1
fi

for app_name in MintBinder Mint mintbinder; do
  if "$PM2_BIN" describe "$app_name" >/dev/null 2>&1; then
    PM2_APP_NAME="$app_name"
    break
  fi
done

if [ -z "$PM2_APP_NAME" ]; then
  echo "Deployment preflight failed: the registered Mint Binder PM2 application was not found." >&2
  echo "Rediscover/register the application in 20i before applying a database migration." >&2
  exit 1
fi

echo "Registered runtime preflight passed for PM2 app: $PM2_APP_NAME"

export NODE_ENV=production
export MINTBINDER_RELEASE_ID="$MINTBINDER_COMMIT-$(date -u +"%Y%m%d%H%M%S")-$$"
export MINTBINDER_NEXT_DIST_DIR=".next-releases/$MINTBINDER_RELEASE_ID"

# Validate all required production configuration before building or migrating.
npm run qa:deployment-env

echo "Preparing isolated standalone release: $MINTBINDER_NEXT_DIST_DIR"
node -e 'const fs = require("node:fs"); const path = require("node:path"); const release = process.env.MINTBINDER_RELEASE_ID || ""; const target = process.env.MINTBINDER_NEXT_DIST_DIR || ""; if (!/^[0-9a-f]{40}-[0-9]{14}-[0-9]+$/.test(release) || target !== `.next-releases/${release}`) throw new Error("Unsafe release directory."); const build = path.resolve(".next"); if (path.basename(build) !== ".next" || path.dirname(build) !== process.cwd()) throw new Error("Unsafe Next build cleanup target."); fs.rmSync(build, { force: true, recursive: true });'
npm run build
git restore package.json package-lock.json 2>/dev/null || true
node scripts/package-next-release.mjs

# The build and environment are known-good before the additive migration is
# applied. Activation follows immediately so schema/runtime skew is brief.
npm run db:deploy

# Publish identical metadata inside the immutable release and through the root
# pointer immediately before activation. app.js refuses to start unless the
# selected directory and both metadata records agree.
node -e 'const fs = require("node:fs"); const path = require("node:path"); const distDir = process.env.MINTBINDER_NEXT_DIST_DIR || ""; if (!/^\.next-releases\/[0-9a-f]{40}-[0-9]{14}-[0-9]+$/.test(distDir)) throw new Error("Unsafe release metadata path."); const info = { branch: process.env.MINTBINDER_BRANCH || "unknown", commit: process.env.MINTBINDER_COMMIT || "unknown", deployScriptVersion: process.env.MINTBINDER_DEPLOY_SCRIPT_VERSION || "unknown", distDir, generatedAt: new Date().toISOString(), nodeVersion: process.version }; const contents = `${JSON.stringify(info, null, 2)}\n`; fs.writeFileSync(path.join(distDir, ".mintbinder-build.json"), contents, { flag: "wx" }); const temporary = ".mintbinder-build.json.tmp"; fs.writeFileSync(temporary, contents); fs.renameSync(temporary, ".mintbinder-build.json");'

restart_app() {
  echo "Reloading Mint Binder runtime via PM2..."

  if ! "$PM2_BIN" reload "$PM2_APP_NAME" --update-env; then
    echo "PM2 reload failed for $PM2_APP_NAME." >&2
    return 1
  fi
  "$PM2_BIN" save >/dev/null 2>&1 || true
}

rollback_runtime() {
  if [ -z "$PREVIOUS_DIST_DIR" ] || [ ! -d "$PREVIOUS_DIST_DIR" ] || [ ! -f "$PREVIOUS_BUILD_INFO_FILE" ]; then
    echo "Automatic rollback unavailable: no verified previous release metadata/build was found." >&2
    return 1
  fi

  echo "Activation failed; rolling back to $PREVIOUS_COMMIT..." >&2
  cp "$PREVIOUS_BUILD_INFO_FILE" ".mintbinder-build.json"
  export MINTBINDER_COMMIT="$PREVIOUS_COMMIT"
  export MINTBINDER_NEXT_DIST_DIR="$PREVIOUS_DIST_DIR"
  if ! restart_app; then
    echo "Rollback reload failed." >&2
    return 1
  fi
  if ! node scripts/verify-runtime-build.mjs; then
    echo "Rollback runtime verification failed." >&2
    return 1
  fi
  echo "Rollback verified at commit $PREVIOUS_COMMIT." >&2
}

if ! restart_app || ! node scripts/verify-runtime-build.mjs; then
  if rollback_runtime; then
    echo "Deployment failed, but the previous runtime was restored and verified." >&2
  else
    echo "Deployment failed and automatic runtime rollback could not be verified." >&2
  fi
  exit 1
fi

# Only a verified activation may prune older immutable builds. The planner logs
# every target before applying the same path-validated plan, and always keeps
# the active build, rollback build, and the newest configured release set.
node scripts/prune-next-releases.mjs
node scripts/prune-next-releases.mjs --apply

echo "Mint Binder deployment finished at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
