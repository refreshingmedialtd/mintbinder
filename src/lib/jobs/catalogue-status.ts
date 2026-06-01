import { prisma } from "@/lib/db/prisma";
import { recentJobRuns, type JobRunRecord } from "@/lib/jobs/runs";
import {
  normalizeCatalogueResult,
  percent,
  summarizeCatalogueStatus,
  type PricingBySeriesGap,
  type SealedPricingByProductTypeGap,
} from "@/lib/jobs/catalogue-status-summary";

type CountRow = {
  count: number;
};

type PricingCoverageRow = {
  pricedCardCount: number;
};

type SealedPricingCoverageRow = {
  pricedSealedProductCount: number;
  sealedPriceSnapshotCount: number;
};

type PricingBySeriesRow = {
  series: string | null;
  cardCount: number;
  pricedCardCount: number;
};

type PricingBySourceRow = {
  source: string;
  itemType: string;
  priceSnapshotCount: number;
  pricedItemCount: number;
};

type SealedPricingByProductTypeRow = {
  productType: string;
  sealedProductCount: number;
  pricedSealedProductCount: number;
  sealedPriceSnapshotCount: number;
};

export async function catalogueStatus() {
  const [counts, catalogueRuns, pricingRuns, sealedPricingRuns] = await Promise.all([
    catalogueCounts(),
    recentJobRuns({ limit: 25, type: "catalogue_refresh" }),
    recentJobRuns({ limit: 25, type: "pricing_refresh" }),
    recentJobRuns({ limit: 25, type: "sealed_pricing_refresh" }),
  ]);
  const latestCatalogueRun = latestUsefulCatalogueRun(catalogueRuns, "");
  const latestPricingRun = latestSucceeded(pricingRuns);
  const latestSealedPricingRun = latestSucceeded(sealedPricingRuns);

  return {
    latestCatalogueRun,
    latestPricingRun,
    latestSealedPricingRun,
    status: summarizeCatalogueStatus({
      ...counts,
      latestCatalogueResult: latestCatalogueRun?.resultPayload,
      latestPricingResult: latestPricingRun?.resultPayload,
      latestSealedPricingResult: latestSealedPricingRun?.resultPayload,
    }),
  };
}

async function catalogueCounts() {
  const [
    cardRows,
    duplicateRows,
    pricingCoverageRows,
    pricingBySeriesRows,
    pricingBySourceRows,
    sealedPricingByProductTypeRows,
    sealedPricingCoverageRows,
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
    prisma.$queryRaw<PricingBySeriesRow[]>`
      SELECT
        COALESCE(cs.series, 'Other') AS series,
        COUNT(cp.id)::int AS "cardCount",
        COUNT(DISTINCT ps.card_printing_id)::int AS "pricedCardCount"
      FROM card_printings cp
      JOIN card_sets cs ON cs.id = cp.card_set_id
      LEFT JOIN price_snapshots ps
        ON ps.card_printing_id = cp.id
        AND ps.item_type = 'card'
      GROUP BY COALESCE(cs.series, 'Other')
      ORDER BY (COUNT(cp.id) - COUNT(DISTINCT ps.card_printing_id)) DESC, COALESCE(cs.series, 'Other')
    `,
    prisma.$queryRaw<PricingBySourceRow[]>`
      SELECT
        source,
        item_type AS "itemType",
        COUNT(id)::int AS "priceSnapshotCount",
        COUNT(DISTINCT COALESCE(card_printing_id::text, sealed_product_id::text))::int AS "pricedItemCount"
      FROM price_snapshots
      GROUP BY source, item_type
      ORDER BY "priceSnapshotCount" DESC, source
    `,
    prisma.$queryRaw<SealedPricingByProductTypeRow[]>`
      SELECT
        sp.product_type AS "productType",
        COUNT(DISTINCT sp.id)::int AS "sealedProductCount",
        COUNT(DISTINCT ps.sealed_product_id)::int AS "pricedSealedProductCount",
        COUNT(ps.id)::int AS "sealedPriceSnapshotCount"
      FROM sealed_products sp
      LEFT JOIN price_snapshots ps
        ON ps.sealed_product_id = sp.id
        AND ps.item_type = 'sealed_product'
      GROUP BY sp.product_type
      ORDER BY (COUNT(DISTINCT sp.id) - COUNT(DISTINCT ps.sealed_product_id)) DESC, sp.product_type
    `,
    prisma.$queryRaw<SealedPricingCoverageRow[]>`
      SELECT
        COUNT(DISTINCT sealed_product_id)::int AS "pricedSealedProductCount",
        COUNT(id)::int AS "sealedPriceSnapshotCount"
      FROM price_snapshots
      WHERE sealed_product_id IS NOT NULL
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
    pricedSealedProductCount: sealedPricingCoverageRows[0]?.pricedSealedProductCount ?? 0,
    pricingBySeries: pricingBySeriesRows.map(mapPricingBySeries),
    pricingBySource: pricingBySourceRows,
    sealedPricingByProductType: sealedPricingByProductTypeRows.map(mapSealedPricingByProductType),
    sealedPriceSnapshotCount: sealedPricingCoverageRows[0]?.sealedPriceSnapshotCount ?? 0,
    sealedProductCount,
    setCount,
  };
}

function mapPricingBySeries(row: PricingBySeriesRow): PricingBySeriesGap {
  return {
    cardCount: row.cardCount,
    pricedCardCount: row.pricedCardCount,
    pricingCoveragePercent: percent(row.pricedCardCount, row.cardCount),
    series: row.series ?? "Other",
    unpricedCardCount: row.cardCount - row.pricedCardCount,
  };
}

function mapSealedPricingByProductType(row: SealedPricingByProductTypeRow): SealedPricingByProductTypeGap {
  return {
    pricedSealedProductCount: row.pricedSealedProductCount,
    productType: row.productType,
    sealedPriceSnapshotCount: row.sealedPriceSnapshotCount,
    sealedPricingCoveragePercent: percent(row.pricedSealedProductCount, row.sealedProductCount),
    sealedProductCount: row.sealedProductCount,
    unpricedSealedProductCount: row.sealedProductCount - row.pricedSealedProductCount,
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
