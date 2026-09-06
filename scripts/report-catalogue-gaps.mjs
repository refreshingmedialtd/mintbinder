import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { restrictedCustomerPriceSources } from "../src/lib/pricing/provider-permissions.mjs";

const prisma = new PrismaClient();
const restrictedSources = restrictedCustomerPriceSources(process.env);
const customerPriceSourceFilter = restrictedSources.length
  ? Prisma.sql`AND ps.source NOT IN (${Prisma.join(restrictedSources)})`
  : Prisma.empty;

try {
  const [
    cardCount,
    setCount,
    priceSnapshotCount,
    sealedProductCount,
    sealedPricingCoverage,
    duplicateProviderIds,
    pricingBySeries,
    pricingBySource,
    sealedPricingByProductType,
    setDeficits,
    pricingCoverage,
    mediaAndVariantCoverage,
    sealedImageCoverage,
    variantMetadataBySeries,
    missingSealedImages,
    pricingBySet,
  ] = await serialPrismaQueries([
    prisma.cardPrinting.count(),
    prisma.cardSet.count(),
    prisma.priceSnapshot.count(),
    prisma.sealedProduct.count({ where: { visibility: "GLOBAL" } }),
    prisma.$queryRaw`
      SELECT
        COUNT(DISTINCT ps.sealed_product_id)::int AS "pricedSealedProductCount",
        COUNT(ps.id)::int AS "sealedPriceSnapshotCount",
        COUNT(DISTINCT sp.id)::int AS "sealedProductCount"
      FROM sealed_products sp
      LEFT JOIN price_snapshots ps
        ON ps.sealed_product_id = sp.id
        AND ps.item_type = 'sealed_product'
        ${customerPriceSourceFilter}
      WHERE sp.visibility = 'global'::catalogue_visibility
    `,
    prisma.$queryRaw`
      SELECT cp.provider_ids->>'pokemon_tcg_api' AS provider_id, COUNT(*)::int AS count
      FROM card_printings cp
      WHERE cp.provider_ids->>'pokemon_tcg_api' IS NOT NULL
      GROUP BY cp.provider_ids->>'pokemon_tcg_api'
      HAVING COUNT(*) > 1
      ORDER BY count DESC, provider_id
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(cs.series, 'Unknown') AS series,
        COUNT(DISTINCT cp.id)::int AS "cardCount",
        COUNT(DISTINCT ps.card_printing_id)::int AS "pricedCardCount",
        COUNT(ps.id)::int AS "priceSnapshotCount"
      FROM card_printings cp
      JOIN card_sets cs ON cs.id = cp.card_set_id
      LEFT JOIN price_snapshots ps
        ON ps.card_printing_id = cp.id
        ${customerPriceSourceFilter}
      GROUP BY COALESCE(cs.series, 'Unknown')
      ORDER BY "cardCount" DESC, series
    `,
    prisma.$queryRaw`
      SELECT
        source,
        item_type AS "itemType",
        COUNT(id)::int AS "priceSnapshotCount",
        COUNT(DISTINCT COALESCE(card_printing_id::text, sealed_product_id::text))::int AS "pricedItemCount"
      FROM price_snapshots
      GROUP BY source, item_type
      ORDER BY "priceSnapshotCount" DESC, source
    `,
    prisma.$queryRaw`
      SELECT
        sp.product_type AS "productType",
        COUNT(DISTINCT sp.id)::int AS "sealedProductCount",
        COUNT(DISTINCT ps.sealed_product_id)::int AS "pricedSealedProductCount",
        COUNT(ps.id)::int AS "sealedPriceSnapshotCount"
      FROM sealed_products sp
      LEFT JOIN price_snapshots ps
        ON ps.sealed_product_id = sp.id
        AND ps.item_type = 'sealed_product'
        ${customerPriceSourceFilter}
      WHERE sp.visibility = 'global'::catalogue_visibility
      GROUP BY sp.product_type
      ORDER BY "sealedProductCount" DESC, sp.product_type
    `,
    prisma.$queryRaw`
      SELECT
        cs.name,
        cs.series,
        cs.total,
        cs.printed_total AS "printedTotal",
        cs.provider_ids->>'pokemon_tcg_api' AS "providerId",
        COUNT(cp.id)::int AS imported,
        (cs.total - COUNT(cp.id))::int AS missing
      FROM card_sets cs
      LEFT JOIN card_printings cp ON cp.card_set_id = cs.id
      GROUP BY cs.id
      HAVING cs.total IS NOT NULL AND COUNT(cp.id) < cs.total
      ORDER BY missing DESC, cs.release_date DESC NULLS LAST, cs.name
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(DISTINCT ps.card_printing_id)::int AS "pricedCards",
        COUNT(DISTINCT cp.id)::int AS "totalCards"
      FROM card_printings cp
      LEFT JOIN price_snapshots ps
        ON ps.card_printing_id = cp.id
        ${customerPriceSourceFilter}
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS "cardCount",
        COUNT(*) FILTER (
          WHERE image_small_url IS NOT NULL AND image_small_url <> ''
        )::int AS "cardImageCount",
        COUNT(*) FILTER (
          WHERE jsonb_typeof(variant_metadata->'availablePrices') = 'array'
            AND jsonb_array_length(variant_metadata->'availablePrices') > 0
        )::int AS "cardVariantMetadataCount"
      FROM card_printings
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS "sealedProductCount",
        COUNT(*) FILTER (
          WHERE image_url IS NOT NULL AND image_url <> ''
        )::int AS "sealedImageCount"
      FROM sealed_products
      WHERE visibility = 'global'::catalogue_visibility
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(cs.series, 'Unknown') AS series,
        COUNT(cp.id)::int AS "cardCount",
        COUNT(cp.id) FILTER (
          WHERE jsonb_typeof(cp.variant_metadata->'availablePrices') = 'array'
            AND jsonb_array_length(cp.variant_metadata->'availablePrices') > 0
        )::int AS "cardVariantMetadataCount"
      FROM card_printings cp
      JOIN card_sets cs ON cs.id = cp.card_set_id
      GROUP BY COALESCE(cs.series, 'Unknown')
      ORDER BY "cardCount" DESC, series
    `,
    prisma.$queryRaw`
      SELECT
        id,
        name,
        product_type AS "productType",
        metadata->>'groupId' AS "tcgcsvGroupId",
        COALESCE(provider_ids->>'tcgcsv', provider_ids->>'tcgplayer') AS "tcgcsvProductId"
      FROM sealed_products
      WHERE visibility = 'global'::catalogue_visibility
        AND (image_url IS NULL OR image_url = '')
      ORDER BY updated_at ASC
      LIMIT 10
    `,
    prisma.$queryRaw`
      SELECT
        cs.name,
        cs.series,
        cs.provider_ids->>'pokemon_tcg_api' AS "providerId",
        COUNT(DISTINCT cp.id)::int AS "cardCount",
        COUNT(DISTINCT ps.card_printing_id)::int AS "pricedCardCount",
        (COUNT(DISTINCT cp.id) - COUNT(DISTINCT ps.card_printing_id))::int AS "unpricedCardCount"
      FROM card_sets cs
      JOIN card_printings cp ON cp.card_set_id = cs.id
      LEFT JOIN price_snapshots ps
        ON ps.card_printing_id = cp.id
        ${customerPriceSourceFilter}
      GROUP BY cs.id
      HAVING COUNT(DISTINCT cp.id) > COUNT(DISTINCT ps.card_printing_id)
      ORDER BY "unpricedCardCount" DESC, cs.release_date DESC NULLS LAST, cs.name
      LIMIT 10
    `,
  ]);

  const coverage = pricingCoverage[0] ?? { pricedCards: 0, totalCards: cardCount };
  const media = mediaAndVariantCoverage[0] ?? {
    cardCount,
    cardImageCount: 0,
    cardVariantMetadataCount: 0,
  };
  const sealedCoverage = sealedPricingCoverage[0] ?? {
    pricedSealedProductCount: 0,
    sealedPriceSnapshotCount: 0,
    sealedProductCount,
  };
  const sealedMedia = sealedImageCoverage[0] ?? {
    sealedImageCount: 0,
    sealedProductCount,
  };

  console.log(JSON.stringify({
    cardImageCount: media.cardImageCount,
    cardImageCoveragePercent: percent(media.cardImageCount, media.cardCount),
    cardMissingImageCount: media.cardCount - media.cardImageCount,
    cardCount,
    cardMissingVariantMetadataCount: media.cardCount - media.cardVariantMetadataCount,
    cardVariantMetadataCount: media.cardVariantMetadataCount,
    cardVariantMetadataCoveragePercent: percent(media.cardVariantMetadataCount, media.cardCount),
    duplicateProviderIdCount: duplicateProviderIds.length,
    missingSealedImages: missingSealedImages.map((product) => ({
      ...product,
      repairableFromTcgcsv: Boolean(product.tcgcsvGroupId && product.tcgcsvProductId),
    })),
    priceSnapshotCount,
    pricedCardCount: coverage.pricedCards,
    pricingCoveragePercent: percent(coverage.pricedCards, coverage.totalCards),
    pricingBySeries: pricingBySeries.map((row) => ({
      ...row,
      unpricedCardCount: row.cardCount - row.pricedCardCount,
      pricingCoveragePercent: percent(row.pricedCardCount, row.cardCount),
    })),
    pricingBySource,
    pricingBySet: pricingBySet.map((row) => ({
      ...row,
      pricingCoveragePercent: percent(row.pricedCardCount, row.cardCount),
    })),
    pricedSealedProductCount: sealedCoverage.pricedSealedProductCount,
    sealedImageCount: sealedMedia.sealedImageCount,
    sealedImageCoveragePercent: percent(sealedMedia.sealedImageCount, sealedMedia.sealedProductCount),
    sealedMissingImageCount: sealedMedia.sealedProductCount - sealedMedia.sealedImageCount,
    sealedPricingByProductType: sealedPricingByProductType.map((row) => ({
      ...row,
      sealedPricingCoveragePercent: percent(row.pricedSealedProductCount, row.sealedProductCount),
      unpricedSealedProductCount: row.sealedProductCount - row.pricedSealedProductCount,
    })),
    sealedPriceSnapshotCount: sealedCoverage.sealedPriceSnapshotCount,
    sealedPricingCoveragePercent: percent(sealedCoverage.pricedSealedProductCount, sealedCoverage.sealedProductCount),
    sealedProductCount,
    setCount,
    setDeficitCount: setDeficits.length,
    setDeficits,
    variantMetadataBySeries: variantMetadataBySeries.map((row) => ({
      ...row,
      cardMissingVariantMetadataCount: row.cardCount - row.cardVariantMetadataCount,
      cardVariantMetadataCoveragePercent: percent(row.cardVariantMetadataCount, row.cardCount),
    })),
  }, null, 2));
} finally {
  await prisma.$disconnect();
}

function percent(part, total) {
  if (!total) {
    return null;
  }

  return Math.round((Number(part) / Number(total)) * 1000) / 10;
}

async function serialPrismaQueries(queries) {
  const results = [];

  // Prisma promises are lazy. Awaiting them one at a time keeps this large
  // diagnostic report inside the deliberately small production connection
  // pool instead of queueing every aggregate at once and timing out.
  for (const query of queries) {
    results.push(await query);
  }

  return results;
}
