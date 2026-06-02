import "dotenv/config";
import { booleanSetting, pageSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import { startJobServer, stopServer, waitForServer } from "./job-server-runner.mjs";

const port = positiveInteger(process.env.JOB_SERVER_PORT, 3017);
const page = pageSetting(process.env.POKEMON_TCG_PRICING_PAGE, 1);
const pageSize = positiveInteger(process.env.POKEMON_TCG_PRICING_PAGE_SIZE, 250);
const maxPages = positiveInteger(process.env.POKEMON_TCG_PRICING_MAX_PAGES, 5);
const query = process.env.POKEMON_TCG_PRICING_QUERY?.trim();
const priceOnlyUnpriced = booleanSetting(process.env.POKEMON_TCG_PRICE_ONLY_UNPRICED);
const secret = process.env.JOB_SECRET?.trim();

if (!secret) {
  throw new Error("JOB_SECRET must be set before running a pricing batch.");
}

if (page === "auto") {
  throw new Error("POKEMON_TCG_PRICING_PAGE=auto is not supported yet. Set an explicit pricing page.");
}

const { baseUrl, output, server } = startJobServer({ port });

try {
  await waitForServer({ server, url: baseUrl, output });

  const response = await fetch(`${baseUrl}/api/jobs/pricing-refresh`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      maxPages,
      page,
      pageSize,
      priceOnlyUnpriced,
      q: query || undefined,
    }),
  });
  const result = await response.json();

  console.log(JSON.stringify(result, null, 2));

  if (!response.ok) {
    throw new Error(result.error ?? `Pricing batch failed with ${response.status}.`);
  }
} finally {
  await stopServer(server);
}
