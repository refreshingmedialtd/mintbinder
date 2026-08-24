import { prisma } from "@/lib/db/prisma";
import { catalogueLanguageLabel, catalogueRegionLabel } from "@/lib/catalogue/languages";
import { recentJobRuns, type JobRunRecord } from "@/lib/jobs/runs";
import {
  normalizeCatalogueResult,
  percent,
  summarizeCatalogueStatus,
  type PricingByLanguageGap,
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

type MediaCoverageRow = {
  cardImageCount: number;
  cardVariantMetadataCount: number;
  sealedImageCount: number;
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

type PricingByLanguageRow = {
  cardCount: number;
  cardImageCount: number;
  language: string;
  pricedCardCount: number;
  region: string;
  setCount: number;
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
    mediaCoverageRows,
    pricingCoverageRows,
    pricingByLanguageRows,
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
    prisma.$queryRaw<MediaCoverageRow[]>`
      SELECT
        (
          SELECT COUNT(*)::int
          FROM card_printings
          WHERE provider_ids ? 'pokemon_tcg_api'
            AND (
              (
                NULLIF(BTRIM(COALESCE(image_large_url, '')), '') IS NOT NULL
                AND LOWER(image_large_url) NOT LIKE '%/mcd18/%'
                AND LOWER(image_large_url) NOT LIKE '%cardback%'
                AND LOWER(image_large_url) NOT LIKE '%card-back%'
                AND LOWER(image_large_url) NOT LIKE '%/back.png%'
                AND LOWER(image_large_url) NOT LIKE '%/back_hires.png%'
              )
              OR (
                NULLIF(BTRIM(COALESCE(image_small_url, '')), '') IS NOT NULL
                AND LOWER(image_small_url) NOT LIKE '%/mcd18/%'
                AND LOWER(image_small_url) NOT LIKE '%cardback%'
                AND LOWER(image_small_url) NOT LIKE '%card-back%'
                AND LOWER(image_small_url) NOT LIKE '%/back.png%'
                AND LOWER(image_small_url) NOT LIKE '%/back_hires.png%'
              )
            )
        ) AS "cardImageCount",
        (
          SELECT COUNT(*)::int
          FROM card_printings
          WHERE provider_ids ? 'pokemon_tcg_api'
            AND jsonb_typeof(variant_metadata->'availablePrices') = 'array'
            AND jsonb_array_length(variant_metadata->'availablePrices') > 0
        ) AS "cardVariantMetadataCount",
        (
          SELECT COUNT(*)::int
          FROM sealed_products
          WHERE visibility = 'global'::catalogue_visibility
            AND NULLIF(BTRIM(COALESCE(image_url, '')), '') IS NOT NULL
        ) AS "sealedImageCount"
    `,
    prisma.$queryRaw<PricingCoverageRow[]>`
      SELECT COUNT(DISTINCT ps.card_printing_id)::int AS "pricedCardCount"
      FROM price_snapshots ps
      JOIN card_printings cp ON cp.id = ps.card_printing_id
      WHERE ps.card_printing_id IS NOT NULL
        AND cp.language = 'en'
    `,
    prisma.$queryRaw<PricingByLanguageRow[]>`
      SELECT
        cp.language,
        cp.region,
        COUNT(DISTINCT cs.id)::int AS "setCount",
        COUNT(DISTINCT cp.id)::int AS "cardCount",
        COUNT(DISTINCT CASE
          WHEN (
            (
              NULLIF(BTRIM(COALESCE(cp.image_large_url, '')), '') IS NOT NULL
              AND LOWER(cp.image_large_url) NOT LIKE '%/mcd18/%'
              AND LOWER(cp.image_large_url) NOT LIKE '%cardback%'
              AND LOWER(cp.image_large_url) NOT LIKE '%card-back%'
              AND LOWER(cp.image_large_url) NOT LIKE '%/back.png%'
              AND LOWER(cp.image_large_url) NOT LIKE '%/back_hires.png%'
            )
            OR (
              NULLIF(BTRIM(COALESCE(cp.image_small_url, '')), '') IS NOT NULL
              AND LOWER(cp.image_small_url) NOT LIKE '%/mcd18/%'
              AND LOWER(cp.image_small_url) NOT LIKE '%cardback%'
              AND LOWER(cp.image_small_url) NOT LIKE '%card-back%'
              AND LOWER(cp.image_small_url) NOT LIKE '%/back.png%'
              AND LOWER(cp.image_small_url) NOT LIKE '%/back_hires.png%'
            )
          )
          THEN cp.id
        END)::int AS "cardImageCount",
        COUNT(DISTINCT ps.card_printing_id)::int AS "pricedCardCount"
      FROM card_printings cp
      JOIN card_sets cs ON cs.id = cp.card_set_id
      LEFT JOIN price_snapshots ps
        ON ps.card_printing_id = cp.id
        AND ps.item_type = 'card'
      GROUP BY cp.language, cp.region
      ORDER BY
        CASE cp.language
          WHEN 'en' THEN 0
          WHEN 'ja' THEN 1
          WHEN 'zh-tw' THEN 2
          WHEN 'zh-cn' THEN 3
          WHEN 'ko' THEN 4
          ELSE 5
        END,
        cp.language,
        cp.region
    `,
    prisma.$queryRaw<PricingBySeriesRow[]>`
      SELECT
        COALESCE(cs.series, 'Other') AS series,
        COUNT(DISTINCT cp.id)::int AS "cardCount",
        COUNT(DISTINCT ps.card_printing_id)::int AS "pricedCardCount"
      FROM card_printings cp
      JOIN card_sets cs ON cs.id = cp.card_set_id
      LEFT JOIN price_snapshots ps
        ON ps.card_printing_id = cp.id
        AND ps.item_type = 'card'
      WHERE cp.language = 'en'
      GROUP BY COALESCE(cs.series, 'Other')
      ORDER BY (COUNT(DISTINCT cp.id) - COUNT(DISTINCT ps.card_printing_id)) DESC, COALESCE(cs.series, 'Other')
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
      WHERE sp.visibility = 'global'::catalogue_visibility
      GROUP BY sp.product_type
      ORDER BY (COUNT(DISTINCT sp.id) - COUNT(DISTINCT ps.sealed_product_id)) DESC, sp.product_type
    `,
    prisma.$queryRaw<SealedPricingCoverageRow[]>`
      SELECT
        COUNT(DISTINCT sealed_product_id)::int AS "pricedSealedProductCount",
        COUNT(id)::int AS "sealedPriceSnapshotCount"
      FROM price_snapshots ps
      JOIN sealed_products sp ON sp.id = ps.sealed_product_id
      WHERE ps.sealed_product_id IS NOT NULL
        AND sp.visibility = 'global'::catalogue_visibility
    `,
    prisma.priceSnapshot.count(),
    prisma.sealedProduct.count({ where: { visibility: "GLOBAL" } }),
    prisma.cardSet.count(),
  ]);

  return {
    cardCount: cardRows[0]?.count ?? 0,
    cardImageCount: mediaCoverageRows[0]?.cardImageCount ?? 0,
    cardVariantMetadataCount: mediaCoverageRows[0]?.cardVariantMetadataCount ?? 0,
    duplicateProviderIdCount: duplicateRows[0]?.count ?? 0,
    priceSnapshotCount,
    pricedCardCount: pricingCoverageRows[0]?.pricedCardCount ?? 0,
    pricedSealedProductCount: sealedPricingCoverageRows[0]?.pricedSealedProductCount ?? 0,
    pricingByLanguage: pricingByLanguageRows.map(mapPricingByLanguage),
    pricingBySeries: pricingBySeriesRows.map(mapPricingBySeries),
    pricingBySource: pricingBySourceRows,
    sealedPricingByProductType: sealedPricingByProductTypeRows.map(mapSealedPricingByProductType),
    sealedImageCount: mediaCoverageRows[0]?.sealedImageCount ?? 0,
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

function mapPricingByLanguage(row: PricingByLanguageRow): PricingByLanguageGap {
  return {
    cardCount: row.cardCount,
    cardImageCount: row.cardImageCount,
    cardImageCoveragePercent: percent(row.cardImageCount, row.cardCount),
    language: row.language,
    languageLabel: catalogueLanguageLabel(row.language),
    pricedCardCount: row.pricedCardCount,
    pricingCoveragePercent: percent(row.pricedCardCount, row.cardCount),
    region: row.region,
    regionLabel: catalogueRegionLabel(row.region),
    setCount: row.setCount,
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
    const provider = result?.provider ?? "pokemon-tcg-api";

    return (
      Boolean(result) &&
      provider === "pokemon-tcg-api" &&
      (run.status === "succeeded" || hasCatalogueProgress(run.resultPayload)) &&
      (result?.query ?? "") === query
    );
  }) ?? null;
}

function hasCatalogueProgress(payload: unknown) {
  const result = normalizeCatalogueResult(payload);

  return Boolean(result?.nextPage || result?.totalCount);
}
