import { prisma } from "@/lib/db/prisma";
import { recentJobRuns, type JobRunRecord } from "@/lib/jobs/runs";
import { normalizeCatalogueResult, summarizeCatalogueStatus } from "@/lib/jobs/catalogue-status-summary";

type CountRow = {
  count: number;
};

type PricingCoverageRow = {
  pricedCardCount: number;
};

export async function catalogueStatus() {
  const [counts, catalogueRuns, pricingRuns] = await Promise.all([
    catalogueCounts(),
    recentJobRuns({ limit: 25, type: "catalogue_refresh" }),
    recentJobRuns({ limit: 25, type: "pricing_refresh" }),
  ]);
  const latestCatalogueRun = latestUsefulCatalogueRun(catalogueRuns, "");
  const latestPricingRun = latestSucceeded(pricingRuns);

  return {
    latestCatalogueRun,
    latestPricingRun,
    status: summarizeCatalogueStatus({
      ...counts,
      latestCatalogueResult: latestCatalogueRun?.resultPayload,
      latestPricingResult: latestPricingRun?.resultPayload,
    }),
  };
}

async function catalogueCounts() {
  const [
    cardRows,
    duplicateRows,
    pricingCoverageRows,
    priceSnapshotCount,
    sealedProductCount,
    setCount,
  ] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int AS count
      FROM card_printings
      WHERE provider_ids ? 'pokemon_tcg_api'
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT provider_ids->>'pokemon_tcg_api' AS provider_id
        FROM card_printings
        WHERE provider_ids ? 'pokemon_tcg_api'
        GROUP BY 1
        HAVING COUNT(*) > 1
      ) duplicates
    `,
    prisma.$queryRaw<PricingCoverageRow[]>`
      SELECT COUNT(DISTINCT card_printing_id)::int AS "pricedCardCount"
      FROM price_snapshots
      WHERE card_printing_id IS NOT NULL
    `,
    prisma.priceSnapshot.count(),
    prisma.sealedProduct.count(),
    prisma.cardSet.count(),
  ]);

  return {
    cardCount: cardRows[0]?.count ?? 0,
    duplicateProviderIdCount: duplicateRows[0]?.count ?? 0,
    priceSnapshotCount,
    pricedCardCount: pricingCoverageRows[0]?.pricedCardCount ?? 0,
    sealedProductCount,
    setCount,
  };
}

function latestSucceeded(runs: JobRunRecord[]) {
  return runs.find((run) => run.status === "succeeded") ?? null;
}

function latestUsefulCatalogueRun(runs: JobRunRecord[], query: string) {
  return runs.find((run) => {
    const result = normalizeCatalogueResult(run.resultPayload);

    return (
      (run.status === "succeeded" || hasCatalogueProgress(run.resultPayload)) &&
      (result?.query ?? "") === query
    );
  }) ?? null;
}

function hasCatalogueProgress(payload: unknown) {
  const result = normalizeCatalogueResult(payload);

  return Boolean(result?.nextPage || result?.totalCount);
}
