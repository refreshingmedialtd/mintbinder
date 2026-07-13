import { prisma } from "@/lib/db/prisma";
import {
  syncPokemonTcgCardPages,
} from "@/lib/pricing/pokemon-tcg-api";
import type { ScheduledSetPricingInput } from "@/lib/jobs/scheduled-set-pricing-input";

type DbSetPricingTarget = {
  cardCount: number;
  id: string;
  latestAttemptAt: Date | null;
  latestSnapshotAt: Date | null;
  name: string;
  pricedCardCount: number;
  printedTotal: number | null;
  providerId: string | null;
  releaseDate: Date | null;
  total: number | null;
};

type SetPricingTarget = {
  cardCount: number;
  expectedPages: number;
  expectedTotal: number;
  id: string;
  latestAttemptAt: string | null;
  latestSnapshotAt: string | null;
  name: string;
  pricedCardCount: number;
  providerId: string;
  releaseDate: string | null;
};

class ScheduledSetPricingFailureError extends Error {
  resultPayload: unknown;

  constructor(message: string, resultPayload: unknown) {
    super(message);
    this.name = "ScheduledSetPricingFailureError";
    this.resultPayload = resultPayload;
  }
}

export async function runScheduledSetPricing(input: ScheduledSetPricingInput) {
  const targets = await nextPokemonTcgSetPricingTargets(input);
  const setResults = [];

  for (const target of targets) {
    const maxPages = Math.min(input.maxPagesPerSet, target.expectedPages);

    try {
      const result = await syncPokemonTcgCardPages({
        maxPages,
        page: 1,
        pageSize: input.pageSize,
        priceOnlyUnpriced: input.priceOnlyUnpriced,
        q: `set.id:${target.providerId}`,
        writePrices: true,
      });

      setResults.push({
        cardsFetched: result.cardsFetched,
        cardsUpserted: result.cardsUpserted,
        complete: result.complete,
        error: null,
        expectedPages: target.expectedPages,
        maxPages,
        name: target.name,
        nextPage: result.nextPage,
        pagesProcessed: result.pagesProcessed,
        pricedCardCountBeforeRun: target.pricedCardCount,
        pricingSnapshotsCreated: result.pricingSnapshotsCreated,
        providerId: target.providerId,
        query: result.query,
        status: "succeeded",
        totalCount: result.totalCount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Set pricing refresh failed.";
      await recordSetPricingAttempt(target, message);

      setResults.push({
        cardsFetched: 0,
        cardsUpserted: 0,
        complete: false,
        error: message,
        expectedPages: target.expectedPages,
        maxPages,
        name: target.name,
        nextPage: null,
        pagesProcessed: 0,
        pricedCardCountBeforeRun: target.pricedCardCount,
        pricingSnapshotsCreated: 0,
        providerId: target.providerId,
        query: `set.id:${target.providerId}`,
        status: "failed",
        totalCount: target.expectedTotal,
      });
    }

    if (input.waitMs > 0 && target !== targets.at(-1)) {
      await wait(input.waitMs);
    }
  }

  const failedSets = setResults.filter((result) => result.status === "failed");
  const result = {
    cardsFetched: sumResults(setResults, "cardsFetched"),
    cardsUpserted: sumResults(setResults, "cardsUpserted"),
    complete: targets.length === 0,
    excludedProviderIds: input.excludeProviderIds,
    failedSets: failedSets.length,
    maxPagesPerSet: input.maxPagesPerSet,
    pageSize: input.pageSize,
    pagesProcessed: sumResults(setResults, "pagesProcessed"),
    priceOnlyUnpriced: input.priceOnlyUnpriced,
    pricingSnapshotsCreated: sumResults(setResults, "pricingSnapshotsCreated"),
    query: "set-rotation",
    scheduled: true,
    selectedSets: targets.map((target) => ({
      cardCount: target.cardCount,
      expectedPages: target.expectedPages,
      latestAttemptAt: target.latestAttemptAt,
      latestSnapshotAt: target.latestSnapshotAt,
      name: target.name,
      pricedCardCount: target.pricedCardCount,
      providerId: target.providerId,
      releaseDate: target.releaseDate,
    })),
    setLimit: input.limit,
    setResults,
    setsProcessed: setResults.length,
    strategy: "set-rotation",
    succeededSets: setResults.length - failedSets.length,
    totalCount: sumResults(setResults, "totalCount"),
    waitMs: input.waitMs,
  };

  if (targets.length > 0 && failedSets.length === targets.length) {
    const firstError = failedSets[0]?.error ?? "Unknown set pricing error.";

    throw new ScheduledSetPricingFailureError(
      `Scheduled set pricing failed for all ${failedSets.length} selected sets. First error: ${firstError}`,
      result,
    );
  }

  return result;
}

export async function nextPokemonTcgSetPricingTargets(
  input: Pick<ScheduledSetPricingInput, "excludeProviderIds" | "limit" | "pageSize">,
) {
  const excludedProviderIds = input.excludeProviderIds.length
    ? input.excludeProviderIds
    : ["__mintbinder_no_excluded_provider_ids__"];

  const rows = await prisma.$queryRaw<DbSetPricingTarget[]>`
    SELECT
      cs.id,
      cs.name,
      cs.provider_ids->>'pokemon_tcg_api' AS "providerId",
      cs.printed_total AS "printedTotal",
      cs.total,
      cs.release_date AS "releaseDate",
      COUNT(DISTINCT cp.id)::int AS "cardCount",
      COUNT(DISTINCT ps.card_printing_id)::int AS "pricedCardCount",
      MAX(ps.observed_at) AS "latestSnapshotAt",
      GREATEST(
        COALESCE(MAX(ps.observed_at), cs.updated_at),
        COALESCE(MAX(cp.updated_at), cs.updated_at),
        cs.updated_at
      ) AS "latestAttemptAt"
    FROM card_sets cs
    LEFT JOIN card_printings cp ON cp.card_set_id = cs.id
    LEFT JOIN price_snapshots ps
      ON ps.card_printing_id = cp.id
      AND ps.item_type = 'card'::item_type
    WHERE cs.provider_ids->>'pokemon_tcg_api' IS NOT NULL
      AND NOT (cs.provider_ids->>'pokemon_tcg_api' = ANY(${excludedProviderIds}::text[]))
    GROUP BY cs.id
    ORDER BY
      GREATEST(
        COALESCE(MAX(ps.observed_at), cs.updated_at),
        COALESCE(MAX(cp.updated_at), cs.updated_at),
        cs.updated_at
      ) ASC NULLS FIRST,
      cs.release_date DESC NULLS LAST,
      cs.name ASC
    LIMIT ${input.limit}
  `;

  return rows
    .filter((row) => row.providerId)
    .map((row): SetPricingTarget => {
      const expectedTotal = Math.max(row.total ?? 0, row.printedTotal ?? 0, row.cardCount ?? 0, 1);

      return {
        cardCount: row.cardCount,
        expectedPages: Math.max(1, Math.ceil(expectedTotal / input.pageSize)),
        expectedTotal,
        id: row.id,
        latestAttemptAt: toIso(row.latestAttemptAt),
        latestSnapshotAt: toIso(row.latestSnapshotAt),
        name: row.name,
        pricedCardCount: row.pricedCardCount,
        providerId: row.providerId as string,
        releaseDate: toIso(row.releaseDate),
      };
    });
}

async function recordSetPricingAttempt(target: SetPricingTarget, message: string) {
  const attemptedAt = new Date().toISOString();
  const metadata = JSON.stringify({
    scheduledPricingLastAttemptAt: attemptedAt,
    scheduledPricingLastError: message,
    scheduledPricingLastErrorStatus: providerErrorStatus(message),
  });

  await prisma.$executeRaw`
    UPDATE card_sets
    SET
      metadata = COALESCE(metadata, '{}'::jsonb) || ${metadata}::jsonb,
      updated_at = NOW()
    WHERE id = ${target.id}::uuid
  `;
}

function providerErrorStatus(message: string) {
  const match = message.match(/\b(4\d\d|5\d\d)\b/);

  return match ? Number(match[1]) : undefined;
}

function sumResults(results: Array<Record<string, unknown>>, key: string) {
  return results.reduce((total, result) => total + (optionalPositiveInteger(result[key]) ?? 0), 0);
}

function optionalPositiveInteger(value: unknown, max = Number.POSITIVE_INFINITY) {
  const normalized = typeof value === "string" && value.trim() === "" ? NaN : Number(value);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return undefined;
  }

  return Math.min(max, Math.max(1, Math.floor(normalized)));
}

function toIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

async function wait(ms: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
