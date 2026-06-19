import { readFile } from "node:fs/promises";
import { join } from "node:path";

type BuildInfoFile = {
  branch?: string;
  commit?: string;
  deployScriptVersion?: string;
  generatedAt?: string;
  nodeVersion?: string;
};

const runtimeStartedAt = new Date().toISOString();

export async function getDeploymentInfo() {
  const [buildInfo, gitCommit, nextBuildId] = await Promise.all([
    readBuildInfoFile(),
    readGitCommit(),
    readOptionalText(".next/BUILD_ID"),
  ]);

  return {
    branch: firstValue(process.env.MINTBINDER_BRANCH, buildInfo?.branch, "unknown"),
    buildId: firstValue(nextBuildId, "unknown"),
    commit: firstValue(process.env.MINTBINDER_COMMIT, buildInfo?.commit, gitCommit, "unknown"),
    deployScriptVersion: firstValue(buildInfo?.deployScriptVersion, "unknown"),
    generatedAt: firstValue(buildInfo?.generatedAt, "unknown"),
    nodeEnv: firstValue(process.env.NODE_ENV, "unknown"),
    nodeVersion: firstValue(buildInfo?.nodeVersion, process.version, "unknown"),
    runtimeStartedAt,
  };
}

async function readBuildInfoFile(): Promise<BuildInfoFile | null> {
  const contents = await readOptionalText(".mintbinder-build.json");

  if (!contents) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(contents);

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as Record<string, unknown>;

    return {
      branch: stringValue(record.branch),
      commit: stringValue(record.commit),
      deployScriptVersion: stringValue(record.deployScriptVersion),
      generatedAt: stringValue(record.generatedAt),
      nodeVersion: stringValue(record.nodeVersion),
    };
  } catch {
    return null;
  }
}

async function readGitCommit() {
  const head = await readOptionalText(".git/HEAD");

  if (!head) {
    return null;
  }

  const trimmedHead = head.trim();

  if (!trimmedHead.startsWith("ref:")) {
    return trimmedHead;
  }

  const refPath = trimmedHead.slice("ref:".length).trim();

  if (!refPath || refPath.includes("..")) {
    return null;
  }

  return readOptionalText(join(".git", refPath));
}

async function readOptionalText(relativePath: string) {
  try {
    return (await readFile(join(process.cwd(), relativePath), "utf8")).trim() || null;
  } catch {
    return null;
  }
}

function firstValue(...values: Array<string | null | undefined>) {
  return values.find((value) => value && value.trim())?.trim() ?? "unknown";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
