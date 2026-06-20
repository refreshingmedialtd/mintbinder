import "dotenv/config";
import { pathToFileURL } from "node:url";

const knownJobs = new Set(["health", "pricing", "sealed-pricing", "price-alerts"]);

export async function runLiveScheduledJob({
  env = process.env,
  fetchImpl = fetch,
  job = process.argv[2] || env.SCHEDULED_JOB_KIND || "health",
} = {}) {
  const kind = normalizeJob(job);
  const baseUrl = appBaseUrl(env);

  if (kind === "health") {
    return requestJson({
      fetchImpl,
      method: "GET",
      url: new URL("/api/health", baseUrl),
    });
  }

  const secret = required(env.JOB_SECRET, "JOB_SECRET must be set before running a protected scheduled job.");
  const request = protectedJobRequest(kind, env);

  return requestJson({
    body: request.body,
    fetchImpl,
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    method: "POST",
    url: new URL(request.path, baseUrl),
  });
}

export function protectedJobRequest(kind, env = process.env) {
  if (kind === "pricing") {
    return {
      body: scheduledPricingBody(env),
      path: "/api/jobs/scheduled-pricing",
    };
  }

  if (kind === "sealed-pricing") {
    return {
      body: sealedPricingBody(env),
      path: "/api/jobs/sealed-pricing-refresh",
    };
  }

  if (kind === "price-alerts") {
    return {
      body: priceAlertsBody(env),
      path: "/api/jobs/price-alerts",
    };
  }

  throw new Error(`Unsupported scheduled job "${kind}".`);
}

export function appBaseUrl(env = process.env) {
  const raw =
    env.SCHEDULED_JOB_APP_URL ||
    env.NEXT_PUBLIC_APP_URL ||
    env.AUTH_URL ||
    "https://mintbinder.co.uk";
  const url = new URL(raw);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Scheduled job app URL must use http or https.");
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";

  return url;
}

function scheduledPricingBody(env) {
  const body = {};
  const page = optionalPositiveInteger(env.POKEMON_TCG_PRICING_PAGE);
  const pageSize = optionalPositiveInteger(env.POKEMON_TCG_PRICING_PAGE_SIZE);
  const maxPages = optionalPositiveInteger(env.POKEMON_TCG_PRICING_MAX_PAGES);
  const query = optionalString(env.POKEMON_TCG_PRICING_QUERY);
  const priceOnlyUnpriced = optionalBoolean(env.POKEMON_TCG_PRICE_ONLY_UNPRICED);

  if (page) {
    body.page = page;
  }

  if (pageSize) {
    body.pageSize = pageSize;
  }

  if (maxPages) {
    body.maxPages = maxPages;
  }

  if (query) {
    body.q = query;
  }

  if (priceOnlyUnpriced !== undefined) {
    body.priceOnlyUnpriced = priceOnlyUnpriced;
  }

  return body;
}

function sealedPricingBody(env) {
  const body = {};
  const groupIds = listSetting(env.TCGCSV_SEALED_GROUP_IDS);
  const groupLimit = optionalPositiveInteger(env.TCGCSV_SEALED_GROUP_LIMIT);
  const priceOnlyUnpriced = optionalBoolean(env.TCGCSV_SEALED_PRICE_ONLY_UNPRICED);
  const usdToGbpRate = optionalRate(env.TCGCSV_USD_TO_GBP_RATE);
  const waitMs = optionalPositiveInteger(env.TCGCSV_SEALED_WAIT_MS);
  const writePrices = optionalBoolean(env.TCGCSV_SEALED_WRITE_PRICES);

  if (groupIds.length) {
    body.groupIds = groupIds;
  }

  if (groupLimit) {
    body.groupLimit = groupLimit;
  }

  if (priceOnlyUnpriced !== undefined) {
    body.priceOnlyUnpriced = priceOnlyUnpriced;
  }

  if (usdToGbpRate) {
    body.usdToGbpRate = usdToGbpRate;
  }

  if (waitMs) {
    body.waitMs = waitMs;
  }

  if (writePrices !== undefined) {
    body.writePrices = writePrices;
  }

  return body;
}

function priceAlertsBody(env) {
  const body = {};
  const dryRun = optionalBoolean(env.PRICE_ALERT_DIGEST_DRY_RUN);
  const now = optionalString(env.PRICE_ALERT_DIGEST_NOW);
  const testRecipient = optionalString(env.PRICE_ALERT_DIGEST_TEST_RECIPIENT);

  body.dryRun = dryRun ?? true;

  if (now) {
    body.now = now;
  }

  if (testRecipient) {
    body.testRecipient = testRecipient;
  }

  return body;
}

async function requestJson({ body, fetchImpl, headers, method, url }) {
  const response = await fetchImpl(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method,
  });
  const payload = await response.json().catch(async () => ({
    text: await response.text().catch(() => ""),
  }));
  const result = {
    body: body ?? null,
    ok: response.ok,
    response: payload,
    status: response.status,
    url: url.toString(),
  };

  if (!response.ok) {
    throw new Error(payload.error ?? payload.message ?? `Scheduled job failed with HTTP ${response.status}.`);
  }

  return result;
}

function normalizeJob(value) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (!knownJobs.has(normalized)) {
    throw new Error(`Unknown scheduled job "${value}". Use one of: ${[...knownJobs].join(", ")}.`);
  }

  return normalized;
}

function required(value, message) {
  const trimmed = optionalString(value);

  if (!trimmed) {
    throw new Error(message);
  }

  return trimmed;
}

function optionalString(value) {
  const trimmed = String(value ?? "").trim();

  return trimmed || undefined;
}

function optionalPositiveInteger(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return undefined;
  }

  return Math.floor(number);
}

function optionalRate(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function optionalBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function listSetting(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runLiveScheduledJob();

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : "Scheduled job failed.",
      ok: false,
    }, null, 2));
    process.exitCode = 1;
  }
}
