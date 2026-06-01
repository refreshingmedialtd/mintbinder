import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const [
    cardCount,
    setCount,
    priceSnapshotCount,
    sealedProductCount,
    duplicateProviderIds,
    setDeficits,
    pricingCoverage,
  ] = await Promise.all([
    prisma.cardPrinting.count(),
    prisma.cardSet.count(),
    prisma.priceSnapshot.count(),
    prisma.sealedProduct.count(),
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

  console.log(JSON.stringify({
    cardCount,
    duplicateProviderIdCount: duplicateProviderIds.length,
    priceSnapshotCount,
    pricedCardCount: coverage.pricedCards,
    pricingCoveragePercent: percent(coverage.pricedCards, coverage.totalCards),
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
