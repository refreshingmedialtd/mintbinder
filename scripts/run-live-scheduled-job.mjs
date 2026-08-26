import "dotenv/config";
import { pathToFileURL } from "node:url";
import { priceAlertScheduleSettings } from "./price-alert-schedule.mjs";

const knownJobs = new Set([
  "health",
  "billing-checkout-retirement",
  "password-reset-delivery",
  "pricing",
  "catalogue-discovery",
  "english-card-pricing",
  "graded-card-pricing",
  "sealed-pricing",
  "japan-card-pricing",
  "price-alerts",
]);

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

  if (kind === "pricing") {
    return runPricingJobBatches({
      baseUrl,
      env,
      fetchImpl,
      secret,
    });
  }

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
  if (kind === "billing-checkout-retirement") {
    return {
      body: {
        batchSize: optionalPositiveInteger(env.BILLING_CHECKOUT_RETIREMENT_BATCH_SIZE) ?? 100,
        scheduled: true,
      },
      path: "/api/jobs/billing-checkout-retirement",
    };
  }

  if (kind === "password-reset-delivery") {
    return {
      body: {
        batchSize: optionalPositiveInteger(env.PASSWORD_RESET_DELIVERY_BATCH_SIZE) ?? 50,
        scheduled: true,
      },
      path: "/api/jobs/password-reset-delivery",
    };
  }

  if (kind === "catalogue-discovery") {
    return {
      body: {
        backfillNewestMissingSet: true,
        scheduled: true,
        setPageSize: 25,
        setsOnly: true,
      },
      path: "/api/jobs/catalogue-refresh",
    };
  }

  if (kind === "pricing") {
    if (pricingStrategy(env) === "sets") {
      return {
        body: scheduledSetPricingBody(env),
        path: "/api/jobs/scheduled-set-pricing",
        strategy: "sets",
      };
    }

    return {
      body: scheduledPricingBody(env),
      path: "/api/jobs/scheduled-pricing",
      strategy: "pages",
    };
  }

  if (kind === "sealed-pricing") {
    return {
      body: sealedPricingBody(env),
      path: "/api/jobs/sealed-pricing-refresh",
    };
  }

  if (kind === "english-card-pricing") {
    return {
      body: englishCardPricingBody(env),
      path: "/api/jobs/international-card-pricing",
    };
  }

  if (kind === "graded-card-pricing") {
    return {
      body: gradedCardPricingBody(env),
      path: "/api/jobs/graded-card-pricing",
    };
  }

  if (kind === "japan-card-pricing") {
    return {
      body: japanCardPricingBody(env),
      path: "/api/jobs/international-card-pricing",
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

async function runPricingJobBatches({ baseUrl, env, fetchImpl, secret }) {
  const request = protectedJobRequest("pricing", env);
  const headers = {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };
  const url = new URL(request.path, baseUrl);

  if (request.strategy === "sets") {
    return runSetPricingJobBatches({
      env,
      fetchImpl,
      headers,
      request,
      url,
    });
  }

  const totalMaxPages = optionalPositiveInteger(request.body.maxPages);
  const requestMaxPages = optionalPositiveInteger(env.POKEMON_TCG_PRICING_REQUEST_MAX_PAGES) ?? 1;
  const batchWaitMs = optionalNonNegativeInteger(env.POKEMON_TCG_PRICING_BATCH_WAIT_MS) ?? 1500;
  const shouldSplit =
    totalMaxPages &&
    totalMaxPages > requestMaxPages &&
    requestMaxPages > 0 &&
    request.body.page === undefined;
  if (!shouldSplit) {
    return requestJson({
      body: request.body,
      fetchImpl,
      headers,
      method: "POST",
      url,
    });
  }

  const batches = [];
  let pagesRemaining = totalMaxPages;

  while (pagesRemaining > 0) {
    const maxPages = Math.min(requestMaxPages, pagesRemaining);
    const batch = await requestJson({
      body: {
        ...request.body,
        maxPages,
      },
      fetchImpl,
      headers,
      method: "POST",
      url,
    });

    batches.push(batch);
    pagesRemaining -= optionalPositiveInteger(batch.response?.pagesProcessed) ?? maxPages;

    if (batch.response?.complete === true) {
      break;
    }

    if (pagesRemaining > 0) {
      await wait(batchWaitMs);
    }
  }

  const response = combinedPricingBatchResponse({
    batches,
    requestedBody: request.body,
  });

  return {
    body: request.body,
    ok: batches.every((batch) => batch.ok),
    response,
    status: batches.at(-1)?.status ?? 200,
    url: url.toString(),
  };
}

async function runSetPricingJobBatches({ env, fetchImpl, headers, request, url }) {
  const totalSetLimit = optionalPositiveInteger(request.body.limit) ?? 1;
  const requestSetLimit = optionalPositiveInteger(env.POKEMON_TCG_SET_PRICING_REQUEST_LIMIT) ?? 1;
  const batchWaitMs =
    optionalNonNegativeInteger(env.POKEMON_TCG_SET_PRICING_BATCH_WAIT_MS) ??
    optionalNonNegativeInteger(env.POKEMON_TCG_PRICING_BATCH_WAIT_MS) ??
    1500;
  const shouldSplit = totalSetLimit > requestSetLimit && requestSetLimit > 0;

  if (!shouldSplit) {
    return requestJson({
      body: request.body,
      fetchImpl,
      headers,
      method: "POST",
      url,
    });
  }

  const batches = [];
  const excludedProviderIds = new Set();
  let setsRemaining = totalSetLimit;

  while (setsRemaining > 0) {
    const limit = Math.min(requestSetLimit, setsRemaining);
    const batch = await requestJson({
      body: {
        ...request.body,
        excludeProviderIds: [...excludedProviderIds],
        limit,
      },
      fetchImpl,
      headers,
      method: "POST",
      url,
    });
    const setsProcessed = optionalPositiveInteger(batch.response?.setsProcessed) ?? 0;

    batches.push(batch);
    for (const providerId of responseProviderIds(batch.response)) {
      excludedProviderIds.add(providerId);
    }
    setsRemaining -= setsProcessed || limit;

    if (batch.response?.complete === true || setsProcessed === 0) {
      break;
    }

    if (setsRemaining > 0) {
      await wait(batchWaitMs);
    }
  }

  const response = combinedSetPricingBatchResponse({
    batches,
    requestedBody: request.body,
  });

  return {
    body: request.body,
    ok: batches.every((batch) => batch.ok),
    response,
    status: batches.at(-1)?.status ?? 200,
    url: url.toString(),
  };
}

function combinedSetPricingBatchResponse({ batches, requestedBody }) {
  const responses = batches.map((batch) => batch.response ?? {});
  const selectedSets = responses.flatMap((response) => response.selectedSets ?? []);
  const setResults = responses.flatMap((response) => response.setResults ?? []);

  return {
    batched: true,
    batchCount: batches.length,
    cardsFetched: sumResponses(responses, "cardsFetched"),
    cardsUpserted: sumResponses(responses, "cardsUpserted"),
    complete: responses.at(-1)?.complete === true,
    failedSets: sumResponses(responses, "failedSets"),
    maxPagesPerSet: responses.at(-1)?.maxPagesPerSet ?? requestedBody.maxPagesPerSet,
    pageSize: responses.at(-1)?.pageSize ?? requestedBody.pageSize,
    pagesProcessed: sumResponses(responses, "pagesProcessed"),
    priceOnlyUnpriced: responses.at(-1)?.priceOnlyUnpriced ?? requestedBody.priceOnlyUnpriced,
    pricingSnapshotsCreated: sumResponses(responses, "pricingSnapshotsCreated"),
    query: "set-rotation",
    scheduled: true,
    selectedSets,
    setLimit: requestedBody.limit,
    setResults,
    setsProcessed: sumResponses(responses, "setsProcessed"),
    strategy: "set-rotation",
    succeededSets: sumResponses(responses, "succeededSets"),
    totalCount: sumResponses(responses, "totalCount"),
  };
}

function responseProviderIds(response) {
  const selectedSets = Array.isArray(response?.selectedSets) ? response.selectedSets : [];
  const setResults = Array.isArray(response?.setResults) ? response.setResults : [];

  return [...selectedSets, ...setResults]
    .map((set) => optionalString(set?.providerId))
    .filter(Boolean);
}

function combinedPricingBatchResponse({ batches, requestedBody }) {
  const responses = batches.map((batch) => batch.response ?? {});
  const first = responses[0] ?? {};
  const last = responses.at(-1) ?? {};

  return {
    batched: true,
    batchCount: batches.length,
    batches: responses.map((response) => ({
      cardsFetched: response.cardsFetched,
      cardsUpserted: response.cardsUpserted,
      complete: response.complete,
      jobRunId: response.jobRun?.id,
      maxPages: response.maxPages,
      nextPage: response.nextPage,
      page: response.page,
      pagesProcessed: response.pagesProcessed,
      pricingSnapshotsCreated: response.pricingSnapshotsCreated,
      selectedPage: response.selectedPage,
      setsUpserted: response.setsUpserted,
    })),
    cardsFetched: sumResponses(responses, "cardsFetched"),
    cardsUpserted: sumResponses(responses, "cardsUpserted"),
    complete: last.complete === true,
    maxPages: requestedBody.maxPages,
    nextPage: last.nextPage,
    page: first.page,
    pageSize: last.pageSize ?? first.pageSize ?? requestedBody.pageSize,
    pagesProcessed: sumResponses(responses, "pagesProcessed"),
    pricingSnapshotsCreated: sumResponses(responses, "pricingSnapshotsCreated"),
    query: last.query ?? first.query,
    scheduled: true,
    selectedPage: first.selectedPage,
    setsUpserted: sumResponses(responses, "setsUpserted"),
    totalCount: last.totalCount ?? first.totalCount,
  };
}

export function appBaseUrl(env = process.env) {
  const raw =
    env.SCHEDULED_JOB_APP_URL ||
    env.NEXT_PUBLIC_APP_URL ||
    env.AUTH_URL ||
    "https://mintbinder.co.uk";
  const url = new URL(raw);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Scheduled job app URL must use HTTPS, or HTTP on loopback for local development.");
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new Error("Scheduled job app URL must use HTTPS outside local loopback development.");
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";

  return url;
}

function isLoopbackHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function scheduledPricingBody(env) {
  const body = { scheduled: true };
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

function scheduledSetPricingBody(env) {
  const body = { scheduled: true };
  const limit =
    optionalPositiveInteger(env.POKEMON_TCG_SET_PRICING_LIMIT) ??
    optionalPositiveInteger(env.POKEMON_TCG_PRICING_MAX_PAGES);
  const maxPagesPerSet = optionalPositiveInteger(env.POKEMON_TCG_SET_PRICING_MAX_PAGES_PER_SET);
  const pageSize =
    optionalPositiveInteger(env.POKEMON_TCG_SET_PRICING_PAGE_SIZE) ??
    optionalPositiveInteger(env.POKEMON_TCG_PRICING_PAGE_SIZE);
  const priceOnlyUnpriced =
    optionalBoolean(env.POKEMON_TCG_SET_PRICING_PRICE_ONLY_UNPRICED) ??
    optionalBoolean(env.POKEMON_TCG_PRICE_ONLY_UNPRICED);
  const waitMs = optionalNonNegativeInteger(env.POKEMON_TCG_SET_PRICING_WAIT_MS);

  body.limit = limit ?? 8;

  if (maxPagesPerSet) {
    body.maxPagesPerSet = maxPagesPerSet;
  }

  if (pageSize) {
    body.pageSize = pageSize;
  }

  if (priceOnlyUnpriced !== undefined) {
    body.priceOnlyUnpriced = priceOnlyUnpriced;
  }

  if (waitMs !== undefined) {
    body.waitMs = waitMs;
  }

  return body;
}

function pricingStrategy(env) {
  const explicit = optionalString(env.POKEMON_TCG_PRICING_STRATEGY)?.toLowerCase();

  if (["page", "pages", "catalogue-pages"].includes(explicit)) {
    return "pages";
  }

  if (["set", "sets", "set-rotation"].includes(explicit)) {
    return "sets";
  }

  if (optionalPositiveInteger(env.POKEMON_TCG_PRICING_PAGE) || optionalString(env.POKEMON_TCG_PRICING_QUERY)) {
    return "pages";
  }

  return "sets";
}

function sealedPricingBody(env) {
  const body = { scheduled: true };
  const groupIds = listSetting(env.TCGCSV_SEALED_GROUP_IDS);
  const groupLimit = optionalPositiveInteger(env.TCGCSV_SEALED_GROUP_LIMIT) ?? 1;
  const priceOnlyUnpriced = optionalBoolean(env.TCGCSV_SEALED_PRICE_ONLY_UNPRICED) ?? false;
  const productLimit = optionalPositiveInteger(env.TCGCSV_SEALED_PRODUCT_LIMIT) ?? 40;
  const usdToGbpRate = optionalRate(env.TCGCSV_USD_TO_GBP_RATE);
  const waitMs = optionalPositiveInteger(env.TCGCSV_SEALED_WAIT_MS) ?? 120;
  const writePrices = optionalBoolean(env.TCGCSV_SEALED_WRITE_PRICES) ?? true;

  if (groupIds.length) {
    body.groupIds = groupIds;
  }

  body.groupLimit = groupLimit;

  body.priceOnlyUnpriced = priceOnlyUnpriced;

  body.productLimit = productLimit;

  if (usdToGbpRate) {
    body.usdToGbpRate = usdToGbpRate;
  }

  body.waitMs = waitMs;

  body.writePrices = writePrices;

  return body;
}

function japanCardPricingBody(env) {
  const body = { scheduled: true };
  const categoryId = optionalPositiveInteger(env.TCGCSV_JAPAN_CARD_CATEGORY_ID) ?? 85;
  const groupIds = listSetting(env.TCGCSV_JAPAN_CARD_GROUP_IDS);
  const groupLimit = optionalPositiveInteger(env.TCGCSV_JAPAN_CARD_GROUP_LIMIT);
  const language = optionalString(env.TCGCSV_JAPAN_CARD_LANGUAGE) ?? "ja";
  const minUnpricedCards = optionalPositiveInteger(env.TCGCSV_JAPAN_CARD_MIN_UNPRICED);
  const onlyUnpricedGroups = optionalBoolean(env.TCGCSV_JAPAN_CARD_ONLY_UNPRICED_GROUPS);
  const priceOnlyUnpriced = optionalBoolean(env.TCGCSV_JAPAN_CARD_PRICE_ONLY_UNPRICED);
  const source = optionalString(env.TCGCSV_JAPAN_CARD_SOURCE) ?? "tcgcsv-japan-card";
  const usdToGbpRate =
    optionalRate(env.TCGCSV_JAPAN_USD_TO_GBP_RATE) ??
    optionalRate(env.TCGCSV_USD_TO_GBP_RATE);
  const waitMs = optionalPositiveInteger(env.TCGCSV_JAPAN_CARD_WAIT_MS);
  const writePrices = optionalBoolean(env.TCGCSV_JAPAN_CARD_WRITE_PRICES) ?? true;

  body.categoryId = categoryId;

  if (groupIds.length) {
    body.groupIds = groupIds;
  }

  if (groupLimit) {
    body.groupLimit = groupLimit;
  }

  body.language = language;

  if (minUnpricedCards) {
    body.minUnpricedCards = minUnpricedCards;
  }

  if (onlyUnpricedGroups !== undefined) {
    body.onlyUnpricedGroups = onlyUnpricedGroups;
  }

  if (priceOnlyUnpriced !== undefined) {
    body.priceOnlyUnpriced = priceOnlyUnpriced;
  }

  body.source = source;

  if (usdToGbpRate) {
    body.usdToGbpRate = usdToGbpRate;
  }

  if (waitMs) {
    body.waitMs = waitMs;
  }

  body.writePrices = writePrices;

  return body;
}

function englishCardPricingBody(env) {
  const body = {
    categoryId: optionalPositiveInteger(env.TCGCSV_CARD_CATEGORY_ID) ?? 3,
    groupLimit: optionalPositiveInteger(env.TCGCSV_CARD_GROUP_LIMIT) ?? 1,
    language: optionalString(env.TCGCSV_CARD_LANGUAGE) ?? "en",
    minUnpricedCards: optionalPositiveInteger(env.TCGCSV_CARD_MIN_UNPRICED) ?? 1,
    onlyUnpricedGroups: false,
    priceOnlyUnpriced: false,
    scheduled: true,
    source: optionalString(env.TCGCSV_CARD_SOURCE) ?? "tcgcsv-card",
    waitMs: optionalNonNegativeInteger(env.TCGCSV_CARD_WAIT_MS) ?? 120,
    writePrices: true,
  };
  const groupIds = listSetting(env.TCGCSV_CARD_GROUP_IDS);
  const usdToGbpRate = optionalRate(env.TCGCSV_USD_TO_GBP_RATE);

  if (groupIds.length) {
    body.groupIds = groupIds;
  }

  if (usdToGbpRate) {
    body.usdToGbpRate = usdToGbpRate;
  }

  return body;
}

function gradedCardPricingBody(env) {
  const body = {
    limit: optionalPositiveInteger(env.PRICECHARTING_GRADED_LIMIT) ?? 5,
    priceOnlyUnpriced: optionalBoolean(env.PRICECHARTING_GRADED_PRICE_ONLY_UNPRICED) ?? false,
    scheduled: true,
    waitMs: optionalNonNegativeInteger(env.PRICECHARTING_GRADED_WAIT_MS) ?? 1_100,
    writePrices: optionalBoolean(env.PRICECHARTING_GRADED_WRITE_PRICES) ?? false,
  };
  const retryAttempts = optionalPositiveInteger(env.PRICECHARTING_API_RETRY_ATTEMPTS);
  const retryWaitMs = optionalNonNegativeInteger(env.PRICECHARTING_API_RETRY_WAIT_MS);
  const timeoutMs = optionalPositiveInteger(env.PRICECHARTING_API_TIMEOUT_MS);
  const usdToGbpRate = optionalRate(env.PRICECHARTING_USD_TO_GBP_RATE);

  if (retryAttempts) body.retryAttempts = retryAttempts;
  if (retryWaitMs !== undefined) body.retryWaitMs = retryWaitMs;
  if (timeoutMs) body.timeoutMs = timeoutMs;
  if (usdToGbpRate) body.usdToGbpRate = usdToGbpRate;

  return body;
}

function priceAlertsBody(env) {
  const body = { scheduled: true };
  const settings = priceAlertScheduleSettings(env);
  const now = optionalString(env.PRICE_ALERT_DIGEST_NOW);

  if (!settings.ok) {
    throw new Error(settings.problems.join(" "));
  }

  body.dryRun = settings.dryRun;

  if (now) {
    body.now = now;
  }

  if (settings.testRecipient) {
    body.testRecipient = settings.testRecipient;
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
  const degradation = scheduledResponseDegradation(payload);
  const result = {
    body: body ?? null,
    degradation,
    ok: response.ok && !degradation,
    response: payload,
    status: response.status,
    url: url.toString(),
  };

  if (!response.ok) {
    throw new Error(payload.error ?? payload.message ?? `Scheduled job failed with HTTP ${response.status}.`);
  }

  return result;
}

export function scheduledResponseDegradation(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const reasons = [];
  const warning = optionalString(payload.warning);

  if (warning) reasons.push(warning);

  const topLevelStatus = optionalString(payload.status);
  const provider = optionalString(payload.provider) ?? "scheduled provider";

  if (topLevelStatus && !["succeeded", "healthy", "not_configured"].includes(topLevelStatus)) {
    reasons.push(`${provider} reported ${topLevelStatus}.`);
  }

  for (const [key, label] of [
    ["failedSets", "provider set refresh(es) failed"],
    ["partialSets", "provider set refresh(es) were partial"],
    ["failedGroups", "provider group refresh(es) failed"],
  ]) {
    const count = optionalPositiveInteger(payload[key]);

    if (count) reasons.push(`${count} ${label}.`);
  }

  const secondSource = payload.secondSource;

  if (secondSource && typeof secondSource === "object") {
    const status = optionalString(secondSource.status);
    const provider = optionalString(secondSource.provider) ?? "second source";
    const candidatesChecked = optionalPositiveInteger(secondSource.candidatesChecked) ?? 0;
    const output = (optionalPositiveInteger(secondSource.pricingSnapshotsCreated) ?? 0) +
      (optionalPositiveInteger(secondSource.pricingSnapshotsUpdated) ?? 0);

    if (status && !["succeeded", "not_configured"].includes(status)) {
      reasons.push(`${provider} reported ${status}.`);
    } else if (status === "succeeded" && candidatesChecked > 0 && output === 0) {
      reasons.push(`${provider} checked ${candidatesChecked} candidate(s) but produced no price snapshots.`);
    }
  }

  return [...new Set(reasons)].join(" ") || null;
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

function optionalNonNegativeInteger(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return undefined;
  }

  return Math.floor(number);
}

async function wait(ms) {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sumResponses(responses, key) {
  return responses.reduce((total, response) => total + (optionalPositiveInteger(response?.[key]) ?? 0), 0);
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
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : "Scheduled job failed.",
      ok: false,
    }, null, 2));
    process.exitCode = 1;
  }
}
