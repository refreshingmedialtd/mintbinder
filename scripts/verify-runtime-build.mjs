import "dotenv/config";

const expectedCommit = required(process.env.MINTBINDER_COMMIT, "MINTBINDER_COMMIT is required for runtime verification.");
const expectedDistDir = required(process.env.MINTBINDER_NEXT_DIST_DIR, "MINTBINDER_NEXT_DIST_DIR is required for runtime verification.");
const port = positiveInteger(process.env.PORT || process.env.NODE_PORT, 3000);
const healthUrl = secureHealthUrl(
  process.env.MINTBINDER_DEPLOY_HEALTH_URL?.trim() || `http://127.0.0.1:${port}/api/health`,
);
const jobSecret = required(process.env.JOB_SECRET, "JOB_SECRET is required for runtime verification.");
const attempts = positiveInteger(process.env.MINTBINDER_DEPLOY_VERIFY_ATTEMPTS, 20);
const waitMs = positiveInteger(process.env.MINTBINDER_DEPLOY_VERIFY_WAIT_MS, 1_000);
let latestProblem = "Runtime health check did not run.";

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const response = await fetch(healthUrl, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${jobSecret}`,
      },
      signal: AbortSignal.timeout(3_000),
    });
    const body = await response.json().catch(() => ({}));
    const runtimeCommit = body?.build?.commit;

    const runtimeDistDir = body?.build?.distDir;

    if (response.ok && body?.ok === true && runtimeCommit === expectedCommit && runtimeDistDir === expectedDistDir) {
      console.log(`Verified Mint Binder runtime commit ${expectedCommit} from ${expectedDistDir} at ${healthUrl}.`);
      process.exit(0);
    }

    latestProblem = `HTTP ${response.status}; runtime commit ${runtimeCommit || "unknown"} from ${runtimeDistDir || "unknown"}; expected ${expectedCommit} from ${expectedDistDir}.`;
  } catch (error) {
    latestProblem = error instanceof Error ? error.message : "Runtime health request failed.";
  }

  if (attempt < attempts) {
    await wait(waitMs);
  }
}

throw new Error(`Mint Binder runtime verification failed: ${latestProblem}`);

function required(value, message) {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function secureHealthUrl(value) {
  const url = new URL(value);
  const loopback = new Set(["127.0.0.1", "[::1]", "localhost"]).has(url.hostname);

  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("MINTBINDER_DEPLOY_HEALTH_URL must use HTTPS outside local loopback.");
  }

  return url;
}

function positiveInteger(value, fallback) {
  const number = Number(value);

  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
