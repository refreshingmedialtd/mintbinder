import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_NAME = /^[0-9a-f]{40}(?:-[0-9]{14}-[0-9]+)?$/;

export function planNextReleasePrune({
  activeDistDir,
  entries,
  keepCount = 5,
  previousDistDir,
}) {
  const activeName = releaseName(activeDistDir, true);
  const previousName = releaseName(previousDistDir, false);
  const safeKeepCount = Number.isSafeInteger(keepCount) && keepCount > 0 ? keepCount : 5;
  const validEntries = entries
    .filter((entry) => entry?.isDirectory !== false && RELEASE_NAME.test(entry.name))
    .sort((left, right) => (right.mtimeMs ?? 0) - (left.mtimeMs ?? 0) || right.name.localeCompare(left.name));
  const preserved = new Set([
    activeName,
    previousName,
    ...validEntries.slice(0, safeKeepCount).map((entry) => entry.name),
  ].filter(Boolean));

  return {
    preserved: validEntries.filter((entry) => preserved.has(entry.name)).map((entry) => entry.name),
    targets: validEntries.filter((entry) => !preserved.has(entry.name)).map((entry) => entry.name),
  };
}

export async function pruneNextReleases({
  apply = false,
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const releaseRoot = path.resolve(cwd, ".next-releases");
  const directoryEntries = await readdir(releaseRoot, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const entries = await Promise.all(directoryEntries.map(async (entry) => ({
    isDirectory: entry.isDirectory(),
    name: entry.name,
    mtimeMs: entry.isDirectory()
      ? (await stat(path.join(releaseRoot, entry.name))).mtimeMs
      : 0,
  })));
  const plan = planNextReleasePrune({
    activeDistDir: env.MINTBINDER_NEXT_DIST_DIR,
    entries,
    keepCount: positiveInteger(env.MINTBINDER_RELEASE_KEEP_COUNT, 5),
    previousDistDir: env.MINTBINDER_PREVIOUS_DIST_DIR,
  });

  console.log(JSON.stringify({
    operation: "next-release-prune",
    apply,
    preserved: plan.preserved,
    targets: plan.targets,
  }));

  if (apply) {
    for (const name of plan.targets) {
      const target = path.resolve(releaseRoot, name);
      const relative = path.relative(releaseRoot, target);

      if (!RELEASE_NAME.test(name) || relative !== name || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Refusing to remove unsafe release path: ${name}`);
      }

      await rm(target, { recursive: true, force: false });
    }
  }

  return plan;
}

function releaseName(distDir, required) {
  const value = typeof distDir === "string" ? distDir.trim().replaceAll("\\", "/") : "";

  if (!value && !required) return null;
  if (value === ".next" && !required) return null;
  const match = /^\.next-releases\/([^/]+)$/.exec(value);

  if (!match || !RELEASE_NAME.test(match[1])) {
    throw new Error(`${required ? "Active" : "Previous"} release directory is invalid.`);
  }

  return match[1];
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await pruneNextReleases({ apply: process.argv.includes("--apply") });
}
