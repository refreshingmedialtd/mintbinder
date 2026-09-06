import { prisma } from "@/lib/db/prisma";
import {
  PokemonTcgPartialSyncError,
  PricingProviderConfigError,
  syncPokemonTcgCardPages,
} from "@/lib/pricing/pokemon-tcg-api";
import {
  isSkippablePokemonTcgSetPricingError,
  PokemonTcgApiRequestError,
  pokemonTcgSetRetryAfter,
} from "@/lib/pricing/pokemon-tcg-request-policy";
import {
  scheduledSetPricingNextPage,
  type ScheduledSetPricingInput,
} from "@/lib/jobs/scheduled-set-pricing-input";

type DbSetPricingTarget = {
  cardCount: number;
  consecutiveFailures: number;
  id: string;
  latestAttemptAt: Date | null;
  latestSnapshotAt: Date | null;
  name: string;
  pricedCardCount: number;
  printedTotal: number | null;
  providerId: string | null;
  releaseDate: Date | null;
  scheduledPricingNextPage: number | null;
  scheduledPricingPageSize: number | null;
  scheduledPricingRetryAfter: Date | null;
  total: number | null;
};

type SetPricingTarget = {
  cardCount: number;
  consecutiveFailures: number;
  expectedPages: number;
  expectedTotal: number;
  id: string;
  latestAttemptAt: string | null;
  latestSnapshotAt: string | null;
  name: string;
  nextPage: number;
  pageSize: number;
  pricedCardCount: number;
  providerId: string;
  releaseDate: string | null;
  retryAfter: string | null;
};

type PokemonTcgCardPagesResult = Awaited<ReturnType<typeof syncPokemonTcgCardPages>>;
type SetPricingProgressResult = PokemonTcgCardPagesResult | PokemonTcgPartialSyncError["resultPayload"];

export async function runScheduledSetPricing(input: ScheduledSetPricingInput) {
  const targets = await nextPokemonTcgSetPricingTargets(input);
  const setResults = [];

  for (const target of targets) {
    const remainingPages = Math.max(1, target.expectedPages - target.nextPage + 1);
    const maxPages = Math.min(input.maxPagesPerSet, remainingPages);

    try {
      const result = await syncPokemonTcgCardPages({
        maxPages,
        page: target.nextPage,
        pageSize: input.pageSize,
        priceOnlyUnpriced: input.priceOnlyUnpriced,
        q: `set.id:${target.providerId}`,
        writePrices: true,
      });

      await recordSetPricingProgress(target, result);

      setResults.push({
        cardsFetched: result.cardsFetched,
        cardsUpserted: result.cardsUpserted,
        complete: result.complete,
        error: null,
        expectedPages: target.expectedPages,
        maxPages,
        name: target.name,
        nextPage: result.nextPage,
        page: result.page,
        pagesProcessed: result.pagesProcessed,
        pricedCardCountBeforeRun: target.pricedCardCount,
        pricingSnapshotsCreated: result.pricingSnapshotsCreated,
        providerId: target.providerId,
        query: result.query,
        status: "succeeded",
        totalCount: result.totalCount,
      });
    } catch (error) {
      if (error instanceof PricingProviderConfigError) {
        throw error;
      }

      if (error instanceof PokemonTcgPartialSyncError) {
        const result = error.resultPayload;

        const failure = await recordSetPricingPartialProgress(target, result, error.originalError);

        setResults.push({
          cardsFetched: result.cardsFetched,
          cardsUpserted: result.cardsUpserted,
          complete: false,
          consecutiveFailures: failure.consecutiveFailures,
          error: result.error,
          expectedPages: target.expectedPages,
          failedPage: result.failedPage,
          maxPages,
          name: target.name,
          nextPage: result.nextPage,
          page: result.page,
          pagesProcessed: result.pagesProcessed,
          pricedCardCountBeforeRun: target.pricedCardCount,
          pricingSnapshotsCreated: result.pricingSnapshotsCreated,
          providerId: target.providerId,
          query: result.query,
          retryAfter: failure.retryAfter,
          status: "partial",
          statusCode: failure.status,
          totalCount: result.totalCount,
        });
      } else {
        if (!isSkippablePokemonTcgSetPricingError(error)) {
          throw error;
        }

        const message = error instanceof Error ? error.message : "Set pricing refresh failed.";
        const failure = await recordSetPricingAttempt(target, error, message);

        setResults.push({
          cardsFetched: 0,
          cardsUpserted: 0,
          complete: false,
          consecutiveFailures: failure.consecutiveFailures,
          error: message,
          expectedPages: target.expectedPages,
          maxPages,
          name: target.name,
          nextPage: target.nextPage,
          page: target.nextPage,
          pagesProcessed: 0,
          pricedCardCountBeforeRun: target.pricedCardCount,
          pricingSnapshotsCreated: 0,
          providerId: target.providerId,
          query: `set.id:${target.providerId}`,
          retryAfter: failure.retryAfter,
          status: "failed",
          statusCode: failure.status,
          totalCount: target.expectedTotal,
        });
      }
    }

    if (input.waitMs > 0 && target !== targets.at(-1)) {
      await wait(input.waitMs);
    }
  }

  const failedSets = setResults.filter((result) => result.status === "failed");
  const partialSets = setResults.filter((result) => result.status === "partial");
  const succeededSets = setResults.filter((result) => result.status === "succeeded");
  const result = {
    cardsFetched: sumResults(setResults, "cardsFetched"),
    cardsUpserted: sumResults(setResults, "cardsUpserted"),
    complete: targets.length === 0,
    excludedProviderIds: input.excludeProviderIds,
    failedSets: failedSets.length,
    maxPagesPerSet: input.maxPagesPerSet,
    pageSize: input.pageSize,
    pagesProcessed: sumResults(setResults, "pagesProcessed"),
    partialSets: partialSets.length,
    priceOnlyUnpriced: input.priceOnlyUnpriced,
    pricingSnapshotsCreated: sumResults(setResults, "pricingSnapshotsCreated"),
    query: "set-rotation",
    scheduled: true,
    selectedSets: targets.map((target) => ({
      cardCount: target.cardCount,
      consecutiveFailures: target.consecutiveFailures,
      expectedPages: target.expectedPages,
      latestAttemptAt: target.latestAttemptAt,
      latestSnapshotAt: target.latestSnapshotAt,
      name: target.name,
      nextPage: target.nextPage,
      pricedCardCount: target.pricedCardCount,
      providerId: target.providerId,
      releaseDate: target.releaseDate,
      retryAfter: target.retryAfter,
    })),
    setLimit: input.limit,
    setResults,
    setsProcessed: setResults.length,
    strategy: "set-rotation",
    succeededSets: succeededSets.length,
    totalCount: sumResults(setResults, "totalCount"),
    waitMs: input.waitMs,
    warning: failedSets.length || partialSets.length
      ? `Set pricing completed with ${failedSets.length} failed set(s) and ${partialSets.length} partial set(s).`
      : null,
  };

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
      CASE
        WHEN cs.metadata->>'scheduledPricingNextPage' ~ '^[0-9]+$'
        THEN (cs.metadata->>'scheduledPricingNextPage')::int
        ELSE NULL
      END AS "scheduledPricingNextPage",
      CASE
        WHEN cs.metadata->>'scheduledPricingPageSize' ~ '^[0-9]+$'
        THEN (cs.metadata->>'scheduledPricingPageSize')::int
        ELSE NULL
      END AS "scheduledPricingPageSize",
      CASE
        WHEN NULLIF(cs.metadata->>'scheduledPricingRetryAfter', '') IS NOT NULL
        THEN (cs.metadata->>'scheduledPricingRetryAfter')::timestamptz
        ELSE NULL
      END AS "scheduledPricingRetryAfter",
      CASE
        WHEN cs.metadata->>'scheduledPricingConsecutiveFailures' ~ '^[0-9]+$'
        THEN (cs.metadata->>'scheduledPricingConsecutiveFailures')::int
        ELSE 0
      END AS "consecutiveFailures",
      CASE
        WHEN (
          CASE
            WHEN cs.metadata->>'scheduledPricingNextPage' ~ '^[0-9]+$'
            THEN (cs.metadata->>'scheduledPricingNextPage')::int
            ELSE 1
          END
        ) > 1 THEN 0
        ELSE 1
      END AS "cursorPriority",
      COUNT(DISTINCT cp.id)::int AS "cardCount",
      COUNT(DISTINCT ps.card_printing_id)::int AS "pricedCardCount",
      MAX(ps.observed_at) AS "latestSnapshotAt",
      GREATEST(
        COALESCE(
          CASE
            WHEN NULLIF(cs.metadata->>'scheduledPricingLastAttemptAt', '') IS NOT NULL
            THEN (cs.metadata->>'scheduledPricingLastAttemptAt')::timestamptz
            ELSE NULL
          END,
          cs.updated_at
        ),
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
      AND (
        NULLIF(cs.metadata->>'scheduledPricingRetryAfter', '') IS NULL
        OR (cs.metadata->>'scheduledPricingRetryAfter')::timestamptz <= NOW()
      )
    GROUP BY cs.id
    ORDER BY
      "cursorPriority" ASC,
      GREATEST(
        COALESCE(
          CASE
            WHEN NULLIF(cs.metadata->>'scheduledPricingLastAttemptAt', '') IS NOT NULL
            THEN (cs.metadata->>'scheduledPricingLastAttemptAt')::timestamptz
            ELSE NULL
          END,
          cs.updated_at
        ),
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
      const expectedPages = Math.max(1, Math.ceil(expectedTotal / input.pageSize));
      const nextPage = scheduledSetPricingNextPage({
        currentPageSize: input.pageSize,
        expectedPages,
        storedPage: row.scheduledPricingNextPage,
        storedPageSize: row.scheduledPricingPageSize,
      });

      return {
        cardCount: row.cardCount,
        consecutiveFailures: row.consecutiveFailures,
        expectedPages,
        expectedTotal,
        id: row.id,
        latestAttemptAt: toIso(row.latestAttemptAt),
        latestSnapshotAt: toIso(row.latestSnapshotAt),
        name: row.name,
        nextPage,
        pageSize: input.pageSize,
        pricedCardCount: row.pricedCardCount,
        providerId: row.providerId as string,
        releaseDate: toIso(row.releaseDate),
        retryAfter: toIso(row.scheduledPricingRetryAfter),
      };
    });
}

async function recordSetPricingProgress(target: SetPricingTarget, result: SetPricingProgressResult) {
  const attemptedAt = new Date().toISOString();
  const nextPage = result.complete
    ? 1
    : optionalPositiveInteger(result.nextPage) ?? target.nextPage;
  const metadata = JSON.stringify({
    scheduledPricingConsecutiveFailures: 0,
    scheduledPricingLastAttemptAt: attemptedAt,
    scheduledPricingLastError: null,
    scheduledPricingLastErrorStatus: null,
    scheduledPricingLastFailedAt: null,
    scheduledPricingLastPage: result.page,
    scheduledPricingLastPagesProcessed: result.pagesProcessed,
    scheduledPricingLastSnapshotCount: result.pricingSnapshotsCreated,
    scheduledPricingLastSucceededAt: attemptedAt,
    scheduledPricingLastTotalCount: result.totalCount,
    scheduledPricingNextPage: nextPage,
    scheduledPricingPageSize: result.pageSize ?? target.pageSize,
    scheduledPricingRetryAfter: null,
  });

  await prisma.$executeRaw`
    UPDATE card_sets
    SET
      metadata = COALESCE(metadata, '{}'::jsonb) || ${metadata}::jsonb,
      updated_at = NOW()
    WHERE id = ${target.id}::uuid
  `;
}

async function recordSetPricingPartialProgress(
  target: SetPricingTarget,
  result: PokemonTcgPartialSyncError["resultPayload"],
  error: unknown,
) {
  const attemptedAt = new Date().toISOString();
  const status = providerErrorStatus(error, result.error);
  const consecutiveFailures = target.consecutiveFailures + 1;
  const retryAfter = pokemonTcgSetRetryAfter({
    attemptedAt,
    consecutiveFailures,
    retryAfterMs: error instanceof PokemonTcgApiRequestError ? error.retryAfterMs : undefined,
    status,
  });
  const metadata = JSON.stringify({
    scheduledPricingConsecutiveFailures: consecutiveFailures,
    scheduledPricingLastAttemptAt: attemptedAt,
    scheduledPricingLastError: result.error,
    scheduledPricingLastErrorStatus: status,
    scheduledPricingLastFailedAt: attemptedAt,
    scheduledPricingLastPage: result.page,
    scheduledPricingLastPagesProcessed: result.pagesProcessed,
    scheduledPricingLastSnapshotCount: result.pricingSnapshotsCreated,
    scheduledPricingLastTotalCount: result.totalCount,
    scheduledPricingNextPage: optionalPositiveInteger(result.nextPage) ?? target.nextPage,
    scheduledPricingPageSize: result.pageSize ?? target.pageSize,
    scheduledPricingRetryAfter: retryAfter,
  });

  await prisma.$executeRaw`
    UPDATE card_sets
    SET
      metadata = COALESCE(metadata, '{}'::jsonb) || ${metadata}::jsonb,
      updated_at = NOW()
    WHERE id = ${target.id}::uuid
  `;

  return { consecutiveFailures, retryAfter, status };
}

async function recordSetPricingAttempt(target: SetPricingTarget, error: unknown, message: string) {
  const attemptedAt = new Date().toISOString();
  const status = providerErrorStatus(error, message);
  const consecutiveFailures = target.consecutiveFailures + 1;
  const retryAfter = pokemonTcgSetRetryAfter({
    attemptedAt,
    consecutiveFailures,
    retryAfterMs: error instanceof PokemonTcgApiRequestError ? error.retryAfterMs : undefined,
    status,
  });
  const metadata = JSON.stringify({
    scheduledPricingConsecutiveFailures: consecutiveFailures,
    scheduledPricingLastAttemptAt: attemptedAt,
    scheduledPricingLastError: message,
    scheduledPricingLastErrorStatus: status,
    scheduledPricingLastFailedAt: attemptedAt,
    scheduledPricingNextPage: target.nextPage,
    scheduledPricingPageSize: target.pageSize,
    scheduledPricingRetryAfter: retryAfter,
  });

  await prisma.$executeRaw`
    UPDATE card_sets
    SET
      metadata = COALESCE(metadata, '{}'::jsonb) || ${metadata}::jsonb,
      updated_at = NOW()
    WHERE id = ${target.id}::uuid
  `;

  return { consecutiveFailures, retryAfter, status };
}

function providerErrorStatus(error: unknown, message: string) {
  if (error instanceof PokemonTcgApiRequestError && error.status > 0) {
    return error.status;
  }

  const match = message.match(/\b(4\d\d|5\d\d)\b/);

  return match ? Number(match[1]) : null;
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
