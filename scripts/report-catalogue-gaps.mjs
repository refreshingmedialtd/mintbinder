import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const [
    cardCount,
    setCount,
    priceSnapshotCount,
    sealedProductCount,
    sealedPricingCoverage,
    duplicateProviderIds,
    pricingBySeries,
    setDeficits,
    pricingCoverage,
  ] = await Promise.all([
    prisma.cardPrinting.count(),
    prisma.cardSet.count(),
    prisma.priceSnapshot.count(),
    prisma.sealedProduct.count(),
    prisma.$queryRaw`
      SELECT
        COUNT(DISTINCT ps.sealed_product_id)::int AS "pricedSealedProductCount",
        COUNT(ps.id)::int AS "sealedPriceSnapshotCount",
        COUNT(DISTINCT sp.id)::int AS "sealedProductCount"
      FROM sealed_products sp
      LEFT JOIN price_snapshots ps
        ON ps.sealed_product_id = sp.id
        AND ps.item_type = 'sealed_product'
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
      LEFT JOIN price_snapshots ps ON ps.card_printing_id = cp.id
      GROUP BY COALESCE(cs.series, 'Unknown')
      ORDER BY "cardCount" DESC, series
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
      LEFT JOIN price_snapshots ps ON ps.card_printing_id = cp.id
    `,
  ]);

  const coverage = pricingCoverage[0] ?? { pricedCards: 0, totalCards: cardCount };
  const sealedCoverage = sealedPricingCoverage[0] ?? {
    pricedSealedProductCount: 0,
    sealedPriceSnapshotCount: 0,
    sealedProductCount,
  };

  console.log(JSON.stringify({
    cardCount,
    duplicateProviderIdCount: duplicateProviderIds.length,
    priceSnapshotCount,
    pricedCardCount: coverage.pricedCards,
    pricingCoveragePercent: percent(coverage.pricedCards, coverage.totalCards),
    pricingBySeries: pricingBySeries.map((row) => ({
      ...row,
      pricingCoveragePercent: percent(row.pricedCardCount, row.cardCount),
    })),
    pricedSealedProductCount: sealedCoverage.pricedSealedProductCount,
    sealedPriceSnapshotCount: sealedCoverage.sealedPriceSnapshotCount,
    sealedPricingCoveragePercent: percent(sealedCoverage.pricedSealedProductCount, sealedCoverage.sealedProductCount),
    sealedProductCount,
    setCount,
    setDeficitCount: setDeficits.length,
    setDeficits,
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
