import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { setTimeout as wait } from "node:timers/promises";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import { startJobServer, stopServer, waitForServer } from "./job-server-runner.mjs";

const secret = process.env.JOB_SECRET?.trim();

if (!secret) {
  throw new Error("JOB_SECRET must be set before running the set bootstrap.");
}

const port = positiveInteger(process.env.JOB_SERVER_PORT, 3022);
const pageSize = positiveInteger(process.env.BOOTSTRAP_SET_PAGE_SIZE, 250);
const limit = positiveInteger(process.env.BOOTSTRAP_SET_LIMIT, Number.POSITIVE_INFINITY);
const retryLimit = positiveInteger(process.env.BOOTSTRAP_SET_RETRY_LIMIT, 2);
const waitMs = positiveInteger(process.env.BOOTSTRAP_SET_WAIT_MS, 1000);
const onlyMissing = booleanSetting(process.env.BOOTSTRAP_SET_ONLY_MISSING, true);
const onlyUnpriced = booleanSetting(process.env.BOOTSTRAP_SET_ONLY_UNPRICED, false);
const minUnpriced = positiveInteger(process.env.BOOTSTRAP_SET_MIN_UNPRICED, 1);
const runCatalogue = !booleanSetting(process.env.BOOTSTRAP_SET_SKIP_CATALOGUE, false);
const runPricing = booleanSetting(process.env.BOOTSTRAP_SET_RUN_PRICING, false);
const priceOnlyUnpriced = booleanSetting(process.env.BOOTSTRAP_SET_PRICE_ONLY_UNPRICED, true);
const requestedSetIds = csvSet(process.env.BOOTSTRAP_SET_IDS);
const requestedSeries = csvSet(process.env.BOOTSTRAP_SET_SERIES);

const prisma = new PrismaClient();
const { baseUrl, output, server } = startJobServer({ port });

try {
  const [providerSets, localCounts] = await Promise.all([
    fetchPokemonSets(),
    localProviderSetCounts(),
  ]);
  const targets = providerSets
    .filter((set) => requestedSetIds.size === 0 || requestedSetIds.has(set.id))
    .filter((set) => requestedSeries.size === 0 || requestedSeries.has(set.series))
    .filter((set) => !onlyMissing || needsImport(set, localCounts.get(set.id)))
    .filter((set) => !onlyUnpriced || needsPricing(localCounts.get(set.id)))
    .filter((set) => !onlyUnpriced || unpricedCount(localCounts.get(set.id)) >= minUnpriced)
    .sort((a, b) => onlyUnpriced
      ? unpricedCount(localCounts.get(b.id)) - unpricedCount(localCounts.get(a.id))
      : 0)
    .slice(0, limit);

  await waitForServer({ server, url: baseUrl, output });

  const results = [];

  for (const set of targets) {
    const current = localCounts.get(set.id) ?? { cardCount: 0, pricedCardCount: 0 };
    const maxPages = Math.max(1, Math.ceil((set.total || set.printedTotal || pageSize) / pageSize));
    const result = {
      cardCountBefore: current.cardCount,
      expectedTotal: set.total ?? set.printedTotal ?? null,
      id: set.id,
      name: set.name,
      pricedCardCountBefore: current.pricedCardCount,
      pricing: null,
      series: set.series,
    };

    console.error(`[set] ${set.id} ${set.name}: ${current.cardCount}/${result.expectedTotal ?? "?"} cards, ${current.pricedCardCount} priced`);

    if (runCatalogue) {
      result.catalogue = await postJob({
        body: {
          maxPages,
          page: 1,
          pageSize,
          q: `set.id:${set.id}`,
        },
        label: `catalogue ${set.id}`,
        path: "/api/jobs/catalogue-refresh",
      });
    }

    if (runPricing) {
      result.pricing = await postJob({
        body: {
          maxPages,
          page: 1,
          pageSize,
          priceOnlyUnpriced,
          q: `set.id:${set.id}`,
        },
        label: `pricing ${set.id}`,
        path: "/api/jobs/pricing-refresh",
      });
    }

    results.push(result);

    if (waitMs > 0) {
      await wait(waitMs);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    onlyMissing,
    onlyUnpriced,
    minUnpriced,
    providerSetCount: providerSets.length,
    targetsProcessed: targets.length,
    totals: {
      cardsFetched: sumResults(results, "cardsFetched"),
      cardsUpserted: sumResults(results, "cardsUpserted"),
      pricingSnapshotsCreated: sumResults(results, "pricingSnapshotsCreated"),
    },
    results,
  }, null, 2));
} finally {
  await Promise.allSettled([
    prisma.$disconnect(),
    stopServer(server),
  ]);
}

async function fetchPokemonSets() {
  const sets = [];
  const fetchPageSize = 250;

  for (let page = 1; page < 20; page += 1) {
    const url = new URL("https://api.pokemontcg.io/v2/sets");
    const apiKey = process.env.POKEMON_TCG_API_KEY;

    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", String(fetchPageSize));
    url.searchParams.set("orderBy", "-releaseDate,id");

    const headers = { accept: "application/json" };

    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    const response = await fetch(url, { headers });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || !Array.isArray(body.data)) {
      throw new Error(body.error?.message ?? `Pokemon TCG sets request failed with ${response.status}.`);
    }

    sets.push(...body.data.map((set) => ({
      id: String(set.id),
      name: String(set.name ?? set.id),
      printedTotal: positiveNumberOrNull(set.printedTotal),
      releaseDate: set.releaseDate,
      series: String(set.series ?? "Unknown"),
      total: positiveNumberOrNull(set.total),
    })));

    if (sets.length >= Number(body.totalCount ?? 0) || body.data.length < fetchPageSize) {
      break;
    }
  }

  return sets;
}

async function localProviderSetCounts() {
  const sets = await prisma.$queryRaw`
    SELECT
      card_sets.provider_ids->>'pokemon_tcg_api' AS "providerId",
      COUNT(card_printings.id)::int AS "cardCount",
      COUNT(DISTINCT price_snapshots.card_printing_id)::int AS "pricedCardCount"
    FROM card_sets
    LEFT JOIN card_printings
      ON card_printings.card_set_id = card_sets.id
    LEFT JOIN price_snapshots
      ON price_snapshots.card_printing_id = card_printings.id
    WHERE card_sets.provider_ids ? 'pokemon_tcg_api'
    GROUP BY card_sets.id
  `;
  const counts = new Map();

  for (const set of sets) {
    const providerId = typeof set.providerId === "string" ? set.providerId : null;

    if (providerId) {
      counts.set(providerId, {
        cardCount: Number(set.cardCount ?? 0),
        pricedCardCount: Number(set.pricedCardCount ?? 0),
      });
    }
  }

  return counts;
}

async function postJob({
  body,
  label,
  path,
}) {
  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      const payload = result?.jobRun?.resultPayload && typeof result.jobRun.resultPayload === "object"
        ? result.jobRun.resultPayload
        : result;

      if (response.ok) {
        return summarizeJob(payload, result.jobRun?.id, "succeeded");
      }

      if (attempt < retryLimit) {
        console.error(`[set] ${label} retry ${attempt + 1}/${retryLimit}: ${result.error ?? response.status}`);
        await wait(waitMs * (attempt + 1));
        continue;
      }

      return {
        ...summarizeJob(payload, result.jobRun?.id, "failed"),
        error: result.error ?? `${label} failed with ${response.status}.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (attempt < retryLimit) {
        console.error(`[set] ${label} retry ${attempt + 1}/${retryLimit}: ${message}`);
        await wait(waitMs * (attempt + 1));
        continue;
      }

      return {
        ...summarizeJob({}, undefined, "failed"),
        error: `${label} failed: ${message}`,
      };
    }
  }
}

function summarizeJob(payload, jobRunId, status) {
  return {
    cardsFetched: Number(payload.cardsFetched ?? 0),
    cardsUpserted: Number(payload.cardsUpserted ?? 0),
    complete: Boolean(payload.complete),
    jobRunId,
    nextPage: payload.nextPage ?? null,
    pagesProcessed: Number(payload.pagesProcessed ?? 0),
    pricingSnapshotsCreated: Number(payload.pricingSnapshotsCreated ?? 0),
    status,
    totalCount: Number(payload.totalCount ?? 0),
  };
}

function needsImport(providerSet, local) {
  if (!local) {
    return true;
  }

  const expected = providerSet.total ?? providerSet.printedTotal;

  return expected ? local.cardCount < expected : local.cardCount === 0;
}

function needsPricing(local) {
  return !local || local.cardCount > Number(local.pricedCardCount ?? 0);
}

function unpricedCount(local) {
  if (!local) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.max(0, Number(local.cardCount ?? 0) - Number(local.pricedCardCount ?? 0));
}

function sumResults(results, key) {
  return results.reduce((total, result) =>
    total + Number(result.catalogue?.[key] ?? 0) + Number(result.pricing?.[key] ?? 0), 0);
}

function csvSet(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function positiveNumberOrNull(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : null;
}
