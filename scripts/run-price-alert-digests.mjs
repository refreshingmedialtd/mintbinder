import "dotenv/config";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import { startJobServer, stopServer, waitForServer } from "./job-server-runner.mjs";

const port = positiveInteger(process.env.JOB_SERVER_PORT, 3015);
const dryRun = booleanSetting(process.env.PRICE_ALERT_DIGEST_DRY_RUN, true);
const now = optionalDate(process.env.PRICE_ALERT_DIGEST_NOW);
const secret = process.env.JOB_SECRET?.trim();

if (!secret) {
  throw new Error("JOB_SECRET must be set before running price alert digests.");
}

if (!dryRun && !isEmailConfigured()) {
  throw new Error("Set RESEND_API_KEY and EMAIL_FROM before running a live price alert send.");
}

const { baseUrl, output, server } = startJobServer({ port });

try {
  await waitForServer({ server, url: baseUrl, output });

  const response = await fetch(`${baseUrl}/api/jobs/price-alerts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      dryRun,
      now: now?.toISOString(),
    }),
  });
  const result = await response.json();

  console.log(JSON.stringify(result, null, 2));

  if (!response.ok) {
    throw new Error(result.error ?? `Price alert digest job failed with ${response.status}.`);
  }
} finally {
  await stopServer(server);
}

function optionalDate(value) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const date = new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    throw new Error("PRICE_ALERT_DIGEST_NOW must be a valid ISO date/time.");
  }

  return date;
}

function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}
