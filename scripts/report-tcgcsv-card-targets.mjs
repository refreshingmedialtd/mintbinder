import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { positiveInteger } from "./catalogue-batch-options.mjs";
import { matchTcgcsvCardGroupsToSets } from "./tcgcsv-card-pricing.mjs";
import {
  tcgcsvPokemonCategoryId,
} from "./tcgcsv-sealed-products.mjs";

const prisma = new PrismaClient();
const limit = positiveInteger(process.env.TCGCSV_CARD_TARGET_LIMIT, 15);

try {
  const [groups, gapSets] = await Promise.all([
    fetchTcgcsvGroups(),
    unpricedSetGaps(limit),
  ]);
  const matches = matchTcgcsvCardGroupsToSets(groups.results ?? [], gapSets);
  const matchedBySetId = new Map(matches.map((match) => [match.set.id, match.group]));

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    groupIds: [...new Set(gapSets
      .map((set) => matchedBySetId.get(set.id)?.groupId)
      .filter(Boolean)
      .map(String))],
    targets: gapSets.map((set) => {
      const group = matchedBySetId.get(set.id);

      return {
        ...set,
        tcgcsvGroupId: group?.groupId ?? null,
        tcgcsvGroupName: group?.name ?? null,
      };
    }),
  }, null, 2));
} finally {
  await prisma.$disconnect();
}

async function fetchTcgcsvGroups() {
  const response = await fetch(`https://tcgcsv.com/tcgplayer/${tcgcsvPokemonCategoryId}/groups`, {
    headers: {
      accept: "application/json",
      "user-agent": "PokeStopLocalImporter/0.1",
    },
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || !body.success) {
    throw new Error("TCGCSV groups request failed.");
  }

  return body;
}

async function unpricedSetGaps(targetLimit) {
  return prisma.$queryRaw`
    SELECT
      cs.id,
      cs.name,
      cs.series,
      cs.provider_ids->>'pokemon_tcg_api' AS "providerId",
      COUNT(DISTINCT cp.id)::int AS "cardCount",
      COUNT(DISTINCT ps.card_printing_id)::int AS "pricedCardCount",
      (COUNT(DISTINCT cp.id) - COUNT(DISTINCT ps.card_printing_id))::int AS "unpricedCardCount"
    FROM card_sets cs
    JOIN card_printings cp ON cp.card_set_id = cs.id
    LEFT JOIN price_snapshots ps ON ps.card_printing_id = cp.id
    GROUP BY cs.id
    HAVING COUNT(DISTINCT cp.id) > COUNT(DISTINCT ps.card_printing_id)
    ORDER BY "unpricedCardCount" DESC, cs.release_date DESC NULLS LAST, cs.name
    LIMIT ${targetLimit}
  `;
}
