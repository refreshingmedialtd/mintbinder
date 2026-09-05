import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { packageNextRelease } from "../scripts/package-next-release.mjs";
import { planNextReleasePrune } from "../scripts/prune-next-releases.mjs";
import { selectMintBinderPm2App } from "../scripts/select-pm2-app.mjs";

const commit = (character) => character.repeat(40);
const release = (character, timestamp, pid) => `${commit(character)}-${timestamp}-${pid}`;

test("release pruning never selects the active or rollback build", () => {
  const active = release("a", "20260824160000", "100");
  const previous = release("b", "20260824150000", "99");
  const old = release("c", "20260820120000", "50");
  const plan = planNextReleasePrune({
    activeDistDir: `.next-releases/${active}`,
    previousDistDir: `.next-releases/${previous}`,
    keepCount: 1,
    entries: [
      { isDirectory: true, mtimeMs: 3, name: active },
      { isDirectory: true, mtimeMs: 2, name: previous },
      { isDirectory: true, mtimeMs: 1, name: old },
      { isDirectory: true, mtimeMs: 0, name: "not-a-release" },
    ],
  });

  assert.equal(plan.targets.includes(active), false);
  assert.equal(plan.targets.includes(previous), false);
  assert.deepEqual(plan.targets, [old]);
});

test("release pruning refuses an active path outside .next-releases", () => {
  assert.throws(
    () => planNextReleasePrune({ activeDistDir: "../.next", entries: [] }),
    /Active release directory is invalid/,
  );
});

test("release pruning tolerates legacy metadata without treating it as a rollback build", () => {
  const active = release("a", "20260824160000", "100");
  const old = release("b", "20260820120000", "50");
  const plan = planNextReleasePrune({
    activeDistDir: `.next-releases/${active}`,
    previousDistDir: ".next",
    keepCount: 1,
    entries: [
      { isDirectory: true, mtimeMs: 2, name: active },
      { isDirectory: true, mtimeMs: 1, name: old },
    ],
  });

  assert.deepEqual(plan.targets, [old]);
});

test("deployment requires the registered runtime before migration and supports project-local PM2", async () => {
  const { readFile } = await import("node:fs/promises");
  const script = await readFile(new URL("../scripts/deploy-20i.sh", import.meta.url), "utf8");
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");

  assert.match(script, /node_modules\/\.bin\/pm2/);
  assert.doesNotMatch(script, /git pull/);
  assert.doesNotMatch(script, /git fetch/);
  assert.doesNotMatch(script, /git merge/);
  assert.doesNotMatch(script, /git reset/);
  assert.match(script, /flock -n 9/);
  assert.match(script, /another Mint Binder deployment is already running/);
  assert.match(script, /git ls-remote --exit-code --refs origin "refs\/heads\/\$EXPECTED_DEPLOY_BRANCH"/);
  assert.match(script, /20i checked out \$MINTBINDER_COMMIT but origin\/\$EXPECTED_DEPLOY_BRANCH is \$MINTBINDER_REMOTE_COMMIT/);
  assert.match(script, /20i Git checkout attested at origin\/\$EXPECTED_DEPLOY_BRANCH/);
  assert.match(gitignore, /^\.mintbinder-deploy\.lock$/m);
  assert.ok(script.indexOf("20i Git checkout attested") < script.indexOf("git diff --quiet --"));
  assert.ok(script.indexOf("git diff --quiet --") < script.indexOf("git restore package.json package-lock.json"));
  assert.ok(script.indexOf("git diff --cached --quiet --") < script.indexOf("git restore package.json package-lock.json"));
  assert.ok(script.indexOf("git ls-files --others --exclude-standard") < script.indexOf("git restore package.json package-lock.json"));
  assert.ok(script.indexOf("git diff --quiet --") < script.indexOf("npm run build"));
  assert.ok(script.indexOf("git diff --cached --quiet --") < script.indexOf("npm run build"));
  assert.ok(script.indexOf("git diff --cached --quiet --") < script.indexOf("npm run db:deploy"));
  assert.ok(script.indexOf("git ls-files --others --exclude-standard") < script.indexOf("npm run build"));
  assert.match(gitignore, /^\.mintbinder-build\.previous\.json$/m);
  assert.match(gitignore, /^\.mintbinder-build\.json\.tmp$/m);
  assert.ok(script.indexOf('PM2_APP_NAME="$(PM2_SILENT=true "$PM2_BIN" jlist') < script.indexOf("npm run db:deploy"));
  assert.ok(script.indexOf("node scripts/package-next-release.mjs") < script.indexOf("npm run db:deploy"));
  assert.ok(script.indexOf("npm run lint") < script.indexOf("npm run build -- --no-lint"));
  assert.ok(script.indexOf("npm run qa:deployment-env") < script.indexOf("npm run lint"));
  assert.match(script, /npm run build -- --no-lint/);
  assert.doesNotMatch(script, /pm2 start ecosystem\.config\.js/);
  assert.doesNotMatch(script, /PREVIOUS_DIST_DIR="\.next"/);
  assert.match(script, /automatic rollback is disabled for this one transition/);
  assert.doesNotMatch(script, /PREVIOUS_DIST_DIR="\.next-releases\/\$PREVIOUS_COMMIT"/);
});

test("deployment recovers and verifies memory headroom before npm ci", async () => {
  const script = await readFile(new URL("../scripts/deploy-20i.sh", import.meta.url), "utf8");
  const guardStart = script.indexOf("ensure_npm_ci_memory_headroom() {");
  const guardCall = script.indexOf("if ! ensure_npm_ci_memory_headroom; then");
  const install = script.indexOf("npm ci --include=dev --no-audit --no-fund");
  const guardInvocation = script.slice(guardCall, install);
  const refreshStart = script.indexOf("refresh_previous_runtime_for_install() {");
  const refreshEnd = script.indexOf("\n}\n\nensure_npm_ci_memory_headroom()", refreshStart);
  const refresh = script.slice(refreshStart, refreshEnd);
  const verifier = await readFile(new URL("../scripts/verify-runtime-build.mjs", import.meta.url), "utf8");
  const verifierHelperStart = script.indexOf("verify_previous_runtime() {");
  const verifierHelperEnd = script.indexOf("\n}\n\nrefresh_previous_runtime_for_install()", verifierHelperStart);
  const verifierHelper = script.slice(verifierHelperStart, verifierHelperEnd);
  const preverify = refresh.indexOf("if ! verify_previous_runtime; then");
  const reload = refresh.indexOf('"$PM2_BIN" reload "$PM2_APP_NAME"');
  const postverify = refresh.indexOf("if ! verify_previous_runtime; then", preverify + 1);

  assert.ok(guardStart !== -1 && guardStart < guardCall);
  assert.ok(guardCall !== -1 && guardCall < install);
  assert.match(guardInvocation, /if ! ensure_npm_ci_memory_headroom; then\s+exit 1\s+fi/);
  assert.match(script, /NPM_CI_MIN_AVAILABLE_KIB=\$\(\(960 \* 1024\)\)/);
  assert.match(script, /PM2_REFRESH_MIN_AVAILABLE_KIB=\$\(\(384 \* 1024\)\)/);
  assert.match(script, /awk '\$1 == "MemAvailable:" \{ print \$2; exit \}' \/proc\/meminfo/);
  assert.match(refresh, /if ! find_registered_pm2_app; then[\s\S]*return 1[\s\S]*fi/);
  assert.match(refresh, /"\$PM2_BIN" reload "\$PM2_APP_NAME"/);
  assert.doesNotMatch(refresh, /--update-env/);
  assert.match(
    verifierHelper,
    /MINTBINDER_COMMIT="\$PREVIOUS_COMMIT"[\s\\\n]+MINTBINDER_NEXT_DIST_DIR="\$PREVIOUS_DIST_DIR"[\s\\\n]+node scripts\/verify-runtime-build\.mjs/,
  );
  assert.ok(preverify !== -1 && preverify < reload);
  assert.ok(reload < postverify && postverify !== -1);
  assert.ok(refreshStart + postverify < install);
  assert.ok(verifierHelperStart !== -1 && verifierHelperStart < refreshStart);
  assert.match(refresh, /refreshed current runtime could not be verified; npm ci was not started/);
  assert.match(refresh, /current immutable runtime did not match its authenticated release metadata; PM2 was not reloaded/);
  assert.match(refresh, /git diff --quiet "\$PREVIOUS_COMMIT" "\$MINTBINDER_COMMIT" -- app\.js/);
  assert.match(refresh, /app\.js changed between the current and incoming releases; refusing an automatic low-memory PM2 reload/);
  assert.match(script, /PM2_SILENT=true "\$PM2_BIN" jlist 2>\/dev\/null \| node scripts\/select-pm2-app\.mjs/);
  assert.match(script, /previous\?\.scripts\?\.start !== "node app\.js" \|\| current\?\.scripts\?\.start !== "node app\.js"/);
  assert.ok(refresh.indexOf("if ! verify_npm_start_contract; then") < preverify);
  assert.match(script, /available_kib < PM2_REFRESH_MIN_AVAILABLE_KIB/);
  assert.match(script, /if \(\( available_kib < NPM_CI_MIN_AVAILABLE_KIB \)\); then[\s\S]*return 1[\s\S]*fi/);
  assert.doesNotMatch(verifier, /dotenv\/config/);
  assert.match(verifier, /process\.loadEnvFile/);
});

test("only final activation reloads PM2 with the prospective environment", async () => {
  const script = await readFile(new URL("../scripts/deploy-20i.sh", import.meta.url), "utf8");
  const preinstallReload = script.indexOf('"$PM2_BIN" reload "$PM2_APP_NAME"');
  const install = script.indexOf("npm ci --include=dev --no-audit --no-fund");
  const activationReload = script.indexOf('"$PM2_BIN" reload "$PM2_APP_NAME" --update-env');

  assert.ok(preinstallReload !== -1 && preinstallReload < install);
  assert.ok(activationReload > install);
  assert.equal(script.match(/--update-env/g)?.length, 1);
  assert.match(script, /Deploy script version: \$MINTBINDER_DEPLOY_SCRIPT_VERSION/);
  assert.match(script, /MINTBINDER_DEPLOY_SCRIPT_VERSION="2026-09-05\.3"/);
});

test("PM2 selection accepts only one online npm start process in the deployment directory", () => {
  const cwd = "/home/virtual/example/mintbinder";
  const valid = {
    name: "MintBinder",
    pm2_env: {
      args: ["start"],
      pm_cwd: cwd,
      pm_exec_path: "/usr/bin/npm",
      status: "online",
    },
  };

  assert.equal(selectMintBinderPm2App([valid], { cwd }), "MintBinder");
  assert.throws(() => selectMintBinderPm2App([{ ...valid, pm2_env: { ...valid.pm2_env, status: "stopped" } }], { cwd }), /not online/);
  assert.throws(() => selectMintBinderPm2App([{ ...valid, pm2_env: { ...valid.pm2_env, pm_cwd: "/tmp" } }], { cwd }), /working directory/);
  assert.throws(() => selectMintBinderPm2App([{ ...valid, pm2_env: { ...valid.pm2_env, pm_exec_path: "/usr/bin/node" } }], { cwd }), /execute \/usr\/bin\/npm/);
  assert.throws(() => selectMintBinderPm2App([{ ...valid, pm2_env: { ...valid.pm2_env, args: ["run", "start"] } }], { cwd }), /npm start arguments/);
  assert.throws(() => selectMintBinderPm2App([valid, { ...valid, name: "Mint" }], { cwd }), /exactly one/);
});

test("PM2 selection CLI consumes a clean jlist JSON stream without project dependencies", async () => {
  const cwd = process.cwd();
  const result = await runNodeScript(
    new URL("../scripts/select-pm2-app.mjs", import.meta.url),
    JSON.stringify([{
      name: "mintbinder",
      pm2_env: {
        args: ["start"],
        pm_cwd: cwd,
        pm_exec_path: "/usr/bin/npm",
        status: "online",
      },
    }]),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "mintbinder");
  assert.equal(result.stderr, "");
});

test("legacy build cleanup can never be certified as a successful rollback", async () => {
  const { readFile } = await import("node:fs/promises");
  const script = await readFile(new URL("../scripts/deploy-20i.sh", import.meta.url), "utf8");
  const legacyDetection = script.indexOf("Legacy .next runtime detected");
  const buildCleanup = script.indexOf('fs.rmSync(build, { force: true, recursive: true })');
  const rollbackGuard = script.indexOf('if [ -z "$PREVIOUS_DIST_DIR" ]');

  assert.ok(legacyDetection !== -1 && legacyDetection < buildCleanup);
  assert.ok(rollbackGuard !== -1);
  assert.match(script, /PREVIOUS_DIST_DIR=""/);
  assert.match(script, /Automatic rollback unavailable: no verified previous release metadata\/build was found/);
});

test("rollback cannot report success when reload or runtime verification fails", async () => {
  const { readFile } = await import("node:fs/promises");
  const script = await readFile(new URL("../scripts/deploy-20i.sh", import.meta.url), "utf8");
  const rollbackStart = script.indexOf("rollback_runtime() {");
  const rollbackEnd = script.indexOf("\n}\n\nif ! restart_app", rollbackStart);
  const rollback = script.slice(rollbackStart, rollbackEnd);

  assert.match(rollback, /if ! restart_app; then[\s\S]*return 1[\s\S]*fi/);
  assert.match(rollback, /if ! node scripts\/verify-runtime-build\.mjs; then[\s\S]*return 1[\s\S]*fi/);
  assert.ok(rollback.indexOf("return 1") < rollback.indexOf("Rollback verified at commit"));
});

test("standalone release packaging keeps each dependency tree immutable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mintbinder-release-package-"));
  const first = `.next-releases/${release("d", "20260824170000", "201")}`;
  const second = `.next-releases/${release("e", "20260824171000", "202")}`;

  try {
    await writeMockStandaloneBuild(directory, "dependency-v1");
    await packageNextRelease({ cwd: directory, releaseDirectory: first });

    await rm(join(directory, ".next"), { force: true, recursive: true });
    await writeMockStandaloneBuild(directory, "dependency-v2");
    await packageNextRelease({ cwd: directory, releaseDirectory: second });

    assert.equal(
      await readFile(join(directory, first, "runtime", "node_modules", "mock-runtime", "version.txt"), "utf8"),
      "dependency-v1",
    );
    assert.equal(
      await readFile(join(directory, second, "runtime", "node_modules", "mock-runtime", "version.txt"), "utf8"),
      "dependency-v2",
    );
    await access(join(directory, first, "runtime", ".next", "static", "chunk.js"));
    await access(join(directory, first, "runtime", "public", "icon.svg"));
    await access(join(directory, first, "runtime", "public", "icons", "icon-192.png"));
    await access(join(directory, first, "runtime", "public", "offline.html"));
    await access(join(directory, first, "runtime", "public", "robots.txt"));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

async function writeMockStandaloneBuild(directory, dependencyVersion) {
  await mkdir(join(directory, ".next", "standalone", "node_modules", "mock-runtime"), { recursive: true });
  await mkdir(join(directory, ".next", "static"), { recursive: true });
  await mkdir(join(directory, "public", "icons"), { recursive: true });
  await writeFile(join(directory, ".next", "standalone", "server.js"), "// fixture\n");
  await writeFile(join(directory, ".next", "standalone", "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
  await writeFile(join(directory, ".next", "standalone", "node_modules", "mock-runtime", "version.txt"), dependencyVersion);
  await writeFile(join(directory, ".next", "static", "chunk.js"), "// chunk\n");
  await writeFile(join(directory, "public", "icon.svg"), "<svg/>\n");
  await writeFile(join(directory, "public", "icons", "icon-192.png"), "png fixture\n");
  await writeFile(join(directory, "public", "offline.html"), "<!doctype html>\n");
  await writeFile(join(directory, "public", "robots.txt"), "User-agent: *\n");
}

function runNodeScript(scriptUrl, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(scriptUrl)], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stderr, stdout }));
    child.stdin.end(input);
  });
}
