import "dotenv/config";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import { startJobServer, stopServer, waitForServer } from "./job-server-runner.mjs";

const port = positiveInteger(process.env.JOB_SERVER_PORT, 3020);
const limit = positiveInteger(process.env.VARIANT_METADATA_REPAIR_LIMIT, 500);
const fetchTimeoutMs = positiveInteger(process.env.VARIANT_METADATA_REPAIR_FETCH_TIMEOUT_MS, 10000);
const waitMs = nonNegativeInteger(process.env.VARIANT_METADATA_REPAIR_WAIT_MS, 120);
const dryRun = booleanSetting(process.env.VARIANT_METADATA_REPAIR_DRY_RUN);
const secret = process.env.JOB_SECRET?.trim();

if (!secret) {
  throw new Error("JOB_SECRET must be set before running variant metadata repair.");
}

const { baseUrl, output, server } = startJobServer({ port });

try {
  await waitForServer({ server, url: baseUrl, output });

  const response = await fetch(`${baseUrl}/api/jobs/variant-metadata-repair`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ dryRun, fetchTimeoutMs, limit, waitMs }),
  });
  const result = await response.json();

  console.log(JSON.stringify(result, null, 2));

  if (!response.ok) {
    throw new Error(result.error ?? `Variant metadata repair failed with ${response.status}.`);
  }
} finally {
  await stopServer(server);
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}
