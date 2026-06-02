import { prisma } from "../db/prisma";
import {
  buildDuplicateProviderReview,
  type DuplicateProviderReviewRow,
} from "../catalogue/duplicate-provider-review";

export async function duplicateProviderReview({ limit = 50 }: { limit?: number } = {}) {
  const safeLimit = Math.min(250, Math.max(1, Math.floor(limit)));
  const rows = await prisma.$queryRaw<DuplicateProviderReviewRow[]>`
    WITH duplicate_groups AS (
      SELECT
        provider_ids->>'pokemon_tcg_api' AS provider_id,
        COUNT(*)::int AS duplicate_count
      FROM card_printings
      WHERE provider_ids ? 'pokemon_tcg_api'
      GROUP BY provider_ids->>'pokemon_tcg_api'
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC, provider_id
      LIMIT ${safeLimit}
    )
    SELECT
      dg.provider_id AS "providerId",
      cp.id,
      cp.name,
      cp.number,
      cp.rarity,
      cp.image_small_url AS "imageSmallUrl",
      cp.image_large_url AS "imageLargeUrl",
      cp.created_at AS "createdAt",
      cp.updated_at AS "updatedAt",
      cs.name AS "setName",
      cs.series,
      COUNT(DISTINCT ci.id)::int AS "collectionCount",
      COUNT(DISTINCT wi.id)::int AS "wishlistCount",
      COUNT(DISTINCT ps.id)::int AS "priceSnapshotCount"
    FROM duplicate_groups dg
    JOIN card_printings cp
      ON cp.provider_ids->>'pokemon_tcg_api' = dg.provider_id
    JOIN card_sets cs
      ON cs.id = cp.card_set_id
    LEFT JOIN collection_items ci
      ON ci.card_printing_id = cp.id
    LEFT JOIN wishlist_items wi
      ON wi.card_printing_id = cp.id
    LEFT JOIN price_snapshots ps
      ON ps.card_printing_id = cp.id
    GROUP BY
      dg.provider_id,
      cp.id,
      cs.id
    ORDER BY
      dg.provider_id,
      COUNT(DISTINCT ci.id) DESC,
      COUNT(DISTINCT wi.id) DESC,
      COUNT(DISTINCT ps.id) DESC,
      cp.updated_at DESC
  `;

  return buildDuplicateProviderReview(rows);
}
