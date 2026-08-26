import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { packageNextRelease } from "../scripts/package-next-release.mjs";
import { planNextReleasePrune } from "../scripts/prune-next-releases.mjs";

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
  assert.ok(script.indexOf('PM2_APP_NAME="$app_name"') < script.indexOf("npm run db:deploy"));
  assert.ok(script.indexOf("node scripts/package-next-release.mjs") < script.indexOf("npm run db:deploy"));
  assert.ok(script.indexOf("npm run lint") < script.indexOf("npm run build -- --no-lint"));
  assert.ok(script.indexOf("npm run qa:deployment-env") < script.indexOf("npm run lint"));
  assert.match(script, /npm run build -- --no-lint/);
  assert.doesNotMatch(script, /pm2 start ecosystem\.config\.js/);
  assert.doesNotMatch(script, /PREVIOUS_DIST_DIR="\.next"/);
  assert.match(script, /automatic rollback is disabled for this one transition/);
  assert.doesNotMatch(script, /PREVIOUS_DIST_DIR="\.next-releases\/\$PREVIOUS_COMMIT"/);
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
