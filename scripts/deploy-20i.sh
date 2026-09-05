#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DEPLOY_LOCK_FILE=".mintbinder-deploy.lock"
if ! command -v flock >/dev/null 2>&1; then
  echo "Deployment preflight failed: flock is required to prevent overlapping deployments." >&2
  exit 1
fi
exec 9>"$DEPLOY_LOCK_FILE"
if ! flock -n 9; then
  echo "Deployment preflight failed: another Mint Binder deployment is already running." >&2
  exit 1
fi

echo "Mint Binder deployment started at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "Working directory: $(pwd)"

export NEXT_TELEMETRY_DISABLED=1
export MINTBINDER_DEPLOY_SCRIPT_VERSION="2026-09-05.3"
EXPECTED_DEPLOY_BRANCH="main"
export MINTBINDER_BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
export MINTBINDER_COMMIT="$(git rev-parse --verify "HEAD^{commit}" 2>/dev/null || true)"

if [ "$MINTBINDER_BRANCH" != "$EXPECTED_DEPLOY_BRANCH" ]; then
  echo "Deployment preflight failed: expected branch $EXPECTED_DEPLOY_BRANCH, found ${MINTBINDER_BRANCH:-detached HEAD}." >&2
  exit 1
fi
if ! [[ "$MINTBINDER_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Deployment preflight failed: HEAD is not a valid commit." >&2
  exit 1
fi

REMOTE_STATE=""
if ! REMOTE_STATE="$(git ls-remote --exit-code --refs origin "refs/heads/$EXPECTED_DEPLOY_BRANCH")"; then
  echo "Deployment preflight failed: could not resolve origin/$EXPECTED_DEPLOY_BRANCH." >&2
  exit 1
fi
if [[ "$REMOTE_STATE" == *$'\n'* ]]; then
  echo "Deployment preflight failed: origin returned multiple branch candidates." >&2
  exit 1
fi
IFS=$'\t' read -r MINTBINDER_REMOTE_COMMIT MINTBINDER_REMOTE_REF <<< "$REMOTE_STATE"
if ! [[ "$MINTBINDER_REMOTE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || [ "$MINTBINDER_REMOTE_REF" != "refs/heads/$EXPECTED_DEPLOY_BRANCH" ]; then
  echo "Deployment preflight failed: origin branch response was invalid." >&2
  exit 1
fi
if [ "$MINTBINDER_COMMIT" != "$MINTBINDER_REMOTE_COMMIT" ]; then
  echo "Deployment preflight failed: 20i checked out $MINTBINDER_COMMIT but origin/$EXPECTED_DEPLOY_BRANCH is $MINTBINDER_REMOTE_COMMIT." >&2
  echo "Let 20i fast-forward the checkout, then redeploy; this script will not merge or reset server files." >&2
  exit 1
fi
echo "20i Git checkout attested at origin/$EXPECTED_DEPLOY_BRANCH: $MINTBINDER_COMMIT"

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

# npm ci has a measured peak close to 850 MiB on the 20i host. Keep enough
# genuinely available memory for it without weakening npm's clean, locked
# install. A long-lived Next process can retain substantially more memory than
# a freshly reloaded copy of the same immutable release, so refresh the current
# verified runtime first when installation headroom is tight.
NPM_CI_MIN_AVAILABLE_KIB=$((960 * 1024))
PM2_REFRESH_MIN_AVAILABLE_KIB=$((384 * 1024))
PM2_BIN=""
PM2_APP_NAME=""

read_mem_available_kib() {
  local available_kib=""

  if [ ! -r "/proc/meminfo" ]; then
    return 1
  fi

  available_kib="$(awk '$1 == "MemAvailable:" { print $2; exit }' /proc/meminfo)"
  if ! [[ "$available_kib" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  printf '%s\n' "$available_kib"
}

find_registered_pm2_app() {
  PM2_BIN=""
  PM2_APP_NAME=""

  if command -v pm2 >/dev/null 2>&1; then
    PM2_BIN="$(command -v pm2)"
  elif [ -x "./node_modules/.bin/pm2" ]; then
    PM2_BIN="./node_modules/.bin/pm2"
  else
    echo "Deployment preflight failed: neither global nor project-local PM2 is available." >&2
    return 1
  fi

  # PM2 can write a CLI-version warning to stdout before its JSON. Silent mode
  # keeps the machine-readable stream clean; suppress PM2 stderr so a failed
  # query cannot print process environment data into deployment logs.
  if ! PM2_APP_NAME="$(PM2_SILENT=true "$PM2_BIN" jlist 2>/dev/null | node scripts/select-pm2-app.mjs)"; then
    echo "Deployment preflight failed: no unique, online Mint Binder PM2 application matched this directory and the registered npm start command." >&2
    return 1
  fi
}

verify_npm_start_contract() {
  node -e 'const fs = require("node:fs"); const { execFileSync } = require("node:child_process"); const commit = process.env.MINTBINDER_PREVIOUS_COMMIT || ""; try { if (!/^[0-9a-f]{40}$/.test(commit)) process.exit(1); const previous = JSON.parse(execFileSync("git", ["show", `${commit}:package.json`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); const current = JSON.parse(fs.readFileSync("package.json", "utf8")); if (previous?.scripts?.start !== "node app.js" || current?.scripts?.start !== "node app.js") process.exit(1); } catch { process.exit(1); }'
}

verify_previous_runtime() {
  MINTBINDER_COMMIT="$PREVIOUS_COMMIT" \
  MINTBINDER_NEXT_DIST_DIR="$PREVIOUS_DIST_DIR" \
  node scripts/verify-runtime-build.mjs
}

refresh_previous_runtime_for_install() {
  if [ -z "$PREVIOUS_COMMIT" ] || [ -z "$PREVIOUS_DIST_DIR" ] || [ ! -d "$PREVIOUS_DIST_DIR" ] || [ ! -f "$PREVIOUS_DIST_DIR/.mintbinder-build.json" ]; then
    echo "Deployment preflight failed: installation memory is low and no verified immutable current release is available to refresh." >&2
    return 1
  fi

  if ! git cat-file -e "${PREVIOUS_COMMIT}^{commit}" 2>/dev/null; then
    echo "Deployment preflight failed: the current runtime commit is unavailable locally, so its startup code cannot be compared safely." >&2
    return 1
  fi
  if ! git diff --quiet "$PREVIOUS_COMMIT" "$MINTBINDER_COMMIT" -- app.js; then
    echo "Deployment preflight failed: app.js changed between the current and incoming releases; refusing an automatic low-memory PM2 reload." >&2
    return 1
  fi
  if ! verify_npm_start_contract; then
    echo "Deployment preflight failed: the current and incoming releases must both use the verified 'node app.js' npm start command for an automatic low-memory PM2 reload." >&2
    return 1
  fi

  if ! find_registered_pm2_app; then
    echo "Deployment preflight failed: installation memory is low and the current runtime could not be refreshed safely." >&2
    return 1
  fi

  if ! verify_previous_runtime; then
    echo "Deployment preflight failed: the current immutable runtime did not match its authenticated release metadata; PM2 was not reloaded." >&2
    return 1
  fi

  echo "Refreshing current Mint Binder runtime via PM2 to recover installation memory..."
  # Deliberately retain the registered process environment. The checked-out
  # commit is the prospective release; refreshing that environment here could
  # point the live process at it before the release has been built and verified.
  if ! "$PM2_BIN" reload "$PM2_APP_NAME"; then
    echo "Deployment preflight failed: PM2 could not reload the current Mint Binder runtime." >&2
    return 1
  fi

  if ! verify_previous_runtime; then
    echo "Deployment preflight failed: the refreshed current runtime could not be verified; npm ci was not started." >&2
    return 1
  fi
}

ensure_npm_ci_memory_headroom() {
  local available_kib=""

  if ! available_kib="$(read_mem_available_kib)"; then
    echo "Deployment preflight failed: unable to read MemAvailable from /proc/meminfo; npm ci was not started." >&2
    return 1
  fi

  echo "Available memory before npm ci: $((available_kib / 1024)) MiB (minimum $((NPM_CI_MIN_AVAILABLE_KIB / 1024)) MiB)."
  if (( available_kib >= NPM_CI_MIN_AVAILABLE_KIB )); then
    return 0
  fi

  if (( available_kib < PM2_REFRESH_MIN_AVAILABLE_KIB )); then
    echo "Deployment preflight failed: only $((available_kib / 1024)) MiB is available, which is below the $((PM2_REFRESH_MIN_AVAILABLE_KIB / 1024)) MiB minimum for a safe PM2 refresh; npm ci was not started." >&2
    return 1
  fi

  echo "Available memory is below the safe npm ci threshold; attempting a verified refresh of the current immutable runtime."
  if ! refresh_previous_runtime_for_install; then
    return 1
  fi

  if ! available_kib="$(read_mem_available_kib)"; then
    echo "Deployment preflight failed: unable to re-read MemAvailable after the runtime refresh; npm ci was not started." >&2
    return 1
  fi

  echo "Available memory after verified runtime refresh: $((available_kib / 1024)) MiB."
  if (( available_kib < NPM_CI_MIN_AVAILABLE_KIB )); then
    echo "Deployment preflight failed: only $((available_kib / 1024)) MiB is available after the verified runtime refresh; at least $((NPM_CI_MIN_AVAILABLE_KIB / 1024)) MiB is required for npm ci." >&2
    return 1
  fi
}

if ! ensure_npm_ci_memory_headroom; then
  exit 1
fi

npm ci --include=dev --no-audit --no-fund
git restore package.json package-lock.json 2>/dev/null || true
npm run db:generate

# 20i's non-login Git deployment shell may not expose its global PM2 binary.
# The locked project dependency provides the same CLI and connects to the
# registered application's PM2 daemon without relying on shell PATH setup.
if ! find_registered_pm2_app; then
  exit 1
fi

echo "Registered runtime preflight passed for PM2 app: $PM2_APP_NAME"

export NODE_ENV=production
export MINTBINDER_RELEASE_ID="$MINTBINDER_COMMIT-$(date -u +"%Y%m%d%H%M%S")-$$"
export MINTBINDER_NEXT_DIST_DIR=".next-releases/$MINTBINDER_RELEASE_ID"

# Validate all required production configuration before building or migrating.
npm run qa:deployment-env

# Run ESLint separately so Next does not overlap its lint and TypeScript workers
# on memory-constrained production hosts. Type validation remains enforced by
# the subsequent Next build.
npm run lint

echo "Preparing isolated standalone release: $MINTBINDER_NEXT_DIST_DIR"
node -e 'const fs = require("node:fs"); const path = require("node:path"); const release = process.env.MINTBINDER_RELEASE_ID || ""; const target = process.env.MINTBINDER_NEXT_DIST_DIR || ""; if (!/^[0-9a-f]{40}-[0-9]{14}-[0-9]+$/.test(release) || target !== `.next-releases/${release}`) throw new Error("Unsafe release directory."); const build = path.resolve(".next"); if (path.basename(build) !== ".next" || path.dirname(build) !== process.cwd()) throw new Error("Unsafe Next build cleanup target."); fs.rmSync(build, { force: true, recursive: true });'
npm run build -- --no-lint
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
