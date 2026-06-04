import "dotenv/config";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import { startJobServer, stopServer, waitForServer } from "./job-server-runner.mjs";

const port = positiveInteger(process.env.JOB_SERVER_PORT, 3019);
const queries = queryList(process.env.POKEMON_TCG_PRICING_QUERIES);
const pageSize = positiveInteger(process.env.POKEMON_TCG_PRICING_PAGE_SIZE, 250);
const priceOnlyUnpriced = booleanSetting(process.env.POKEMON_TCG_PRICE_ONLY_UNPRICED, true);
const secret = process.env.JOB_SECRET?.trim();

if (!secret) {
  throw new Error("JOB_SECRET must be set before running pricing targets.");
}

if (!queries.length) {
  throw new Error("Set POKEMON_TCG_PRICING_QUERIES to a comma-separated list such as set.id:sm1,set.id:sm5.");
}

const { baseUrl, output, server } = startJobServer({ port });

try {
  await waitForServer({ server, url: baseUrl, output });

  const results = [];

  for (const query of queries) {
    const response = await fetch(`${baseUrl}/api/jobs/pricing-refresh`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        maxPages: 1,
        page: 1,
        pageSize,
        priceOnlyUnpriced,
        q: query,
      }),
    });
    const result = await response.json();

    results.push({
      cardsFetched: result.cardsFetched ?? 0,
      complete: result.complete ?? false,
      error: response.ok ? undefined : result.error ?? `Pricing target failed with ${response.status}.`,
      jobRunId: result.jobRun?.id,
      pricingSnapshotsCreated: result.pricingSnapshotsCreated ?? 0,
      query,
      status: response.ok ? "succeeded" : "failed",
    });

    if (!response.ok) {
      throw new Error(result.error ?? `Pricing target ${query} failed with ${response.status}.`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    priceOnlyUnpriced,
    queriesProcessed: results.length,
    results,
    totalPricingSnapshotsCreated: results.reduce((total, result) => total + result.pricingSnapshotsCreated, 0),
  }, null, 2));
} finally {
  await stopServer(server);
}

function queryList(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
