import { prisma } from "@/lib/db/prisma";
import { recentJobRuns, type JobRunRecord } from "@/lib/jobs/runs";
import { summarizeCatalogueStatus } from "@/lib/jobs/catalogue-status-summary";

type CountRow = {
  count: number;
};

export async function catalogueStatus() {
  const [counts, catalogueRuns, pricingRuns] = await Promise.all([
    catalogueCounts(),
    recentJobRuns({ limit: 25, type: "catalogue_refresh" }),
    recentJobRuns({ limit: 25, type: "pricing_refresh" }),
  ]);
  const latestCatalogueRun = latestSucceeded(catalogueRuns);
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
    prisma.priceSnapshot.count(),
    prisma.sealedProduct.count(),
    prisma.cardSet.count(),
  ]);

  return {
    cardCount: cardRows[0]?.count ?? 0,
    duplicateProviderIdCount: duplicateRows[0]?.count ?? 0,
    priceSnapshotCount,
    sealedProductCount,
    setCount,
  };
}

function latestSucceeded(runs: JobRunRecord[]) {
  return runs.find((run) => run.status === "succeeded") ?? null;
}
