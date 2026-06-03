import "dotenv/config";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import { startJobServer, stopServer, waitForServer } from "./job-server-runner.mjs";

const port = positiveInteger(process.env.JOB_SERVER_PORT, 3018);
const groupIds = idList(process.env.TCGCSV_SEALED_GROUP_IDS);
const groupLimit = positiveInteger(process.env.TCGCSV_SEALED_GROUP_LIMIT, 5);
const priceOnlyUnpriced = booleanSetting(process.env.TCGCSV_SEALED_PRICE_ONLY_UNPRICED, true);
const secret = process.env.JOB_SECRET?.trim();
const usdToGbpRate = optionalRate(process.env.TCGCSV_USD_TO_GBP_RATE);
const waitMs = positiveInteger(process.env.TCGCSV_SEALED_WAIT_MS, 120);
const writePrices = booleanSetting(process.env.TCGCSV_SEALED_WRITE_PRICES, true);

if (!secret) {
  throw new Error("JOB_SECRET must be set before running a sealed pricing batch.");
}

const { baseUrl, output, server } = startJobServer({ port });

try {
  await waitForServer({ server, url: baseUrl, output });

  const response = await fetch(`${baseUrl}/api/jobs/sealed-pricing-refresh`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      groupIds: groupIds.length ? groupIds : undefined,
      groupLimit,
      priceOnlyUnpriced,
      usdToGbpRate,
      waitMs,
      writePrices,
    }),
  });
  const result = await response.json();

  console.log(JSON.stringify(result, null, 2));

  if (!response.ok) {
    throw new Error(result.error ?? `Sealed pricing batch failed with ${response.status}.`);
  }
} finally {
  await stopServer(server);
}

function idList(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function optionalRate(value) {
  const rate = Number(value);

  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}
