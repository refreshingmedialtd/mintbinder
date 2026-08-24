import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_DIRECTORY = /^\.next-releases\/[0-9a-f]{40}-[0-9]{14}-[0-9]+$/;

export async function packageNextRelease({
  cwd = process.cwd(),
  releaseDirectory = process.env.MINTBINDER_NEXT_DIST_DIR,
} = {}) {
  const normalizedReleaseDirectory = String(releaseDirectory ?? "").trim().replaceAll("\\", "/");

  if (!RELEASE_DIRECTORY.test(normalizedReleaseDirectory)) {
    throw new Error("Immutable release directory is invalid.");
  }

  const releaseRoot = path.resolve(cwd, normalizedReleaseDirectory);
  const releasesRoot = path.resolve(cwd, ".next-releases");
  const relativeRelease = path.relative(releasesRoot, releaseRoot).replaceAll("\\", "/");

  if (!relativeRelease || relativeRelease.includes("/") || path.isAbsolute(relativeRelease)) {
    throw new Error("Immutable release directory escapes .next-releases.");
  }

  const sourceRoot = path.resolve(cwd, ".next", "standalone");
  const sourceServer = path.join(sourceRoot, "server.js");
  const runtimeRoot = path.join(releaseRoot, "runtime");

  await access(sourceServer).catch(() => {
    throw new Error("Next standalone output is missing; ensure output: 'standalone' is configured.");
  });
  await access(releaseRoot).then(
    () => {
      throw new Error("Immutable release directory already exists; refusing to overwrite it.");
    },
    (error) => {
      if (error?.code !== "ENOENT") throw error;
    },
  );

  await mkdir(releasesRoot, { recursive: true });
  await mkdir(releaseRoot, { recursive: false });

  try {
    await cp(sourceRoot, runtimeRoot, { errorOnExist: true, force: false, recursive: true });
    // Next may already trace runtime-read public files into standalone output.
    // Merge the authoritative build assets so both traced and conventional
    // standalone layouts are complete.
    await cp(path.resolve(cwd, ".next", "static"), path.join(runtimeRoot, ".next", "static"), {
      force: true,
      recursive: true,
    });
    await cp(path.resolve(cwd, "public"), path.join(runtimeRoot, "public"), {
      force: true,
      recursive: true,
    });

    const packageJson = JSON.parse(await readFile(path.join(runtimeRoot, "package.json"), "utf8"));
    const releaseManifest = {
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      packagedAt: new Date().toISOString(),
      releaseDirectory: normalizedReleaseDirectory,
      runtimeEntry: `${normalizedReleaseDirectory}/runtime/server.js`,
    };

    await writeFile(
      path.join(releaseRoot, ".mintbinder-runtime.json"),
      `${JSON.stringify(releaseManifest, null, 2)}\n`,
      { flag: "wx" },
    );

    return releaseManifest;
  } catch (error) {
    await rm(releaseRoot, { force: true, recursive: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await packageNextRelease(), null, 2));
}
