import { prisma } from "../db/prisma";
import {
  buildCardImageRepairPlan,
  knownBadPokemonTcgImageProviderCodes,
  type TcgcsvCardImageProduct,
} from "../catalogue/image-repair";

export type CardImageRepairOptions = {
  dryRun?: boolean;
  limit?: number;
};

const DEFAULT_REPAIR_LIMIT = 500;
const MAX_REPAIR_LIMIT = 5000;
const tcgcsvCardImageTargets = new Map([
  ["mcd18", { categoryId: 3, groupId: 2364 }],
]);

export async function repairMissingPokemonTcgCardImages({
  dryRun = false,
  limit = DEFAULT_REPAIR_LIMIT,
}: CardImageRepairOptions = {}) {
  const safeLimit = boundedPositiveInteger(limit, DEFAULT_REPAIR_LIMIT, MAX_REPAIR_LIMIT);
  const candidates = await prisma.cardPrinting.findMany({
    orderBy: { updatedAt: "asc" },
    select: {
      id: true,
      imageLargeUrl: true,
      imageSmallUrl: true,
      name: true,
      number: true,
      providerIds: true,
    },
    take: safeLimit,
    where: {
      OR: [
        { imageLargeUrl: null },
        { imageLargeUrl: "" },
        { imageSmallUrl: null },
        { imageSmallUrl: "" },
        { imageLargeUrl: { contains: "/mcd18/" } },
        { imageSmallUrl: { contains: "/mcd18/" } },
        { imageLargeUrl: { contains: "cardback", mode: "insensitive" } },
        { imageSmallUrl: { contains: "cardback", mode: "insensitive" } },
        { imageLargeUrl: { contains: "card-back", mode: "insensitive" } },
        { imageSmallUrl: { contains: "card-back", mode: "insensitive" } },
      ],
    },
  });
  const tcgcsvProductsByProviderCode = await fetchKnownBadTcgcsvCardImageProducts(
    knownBadPokemonTcgImageProviderCodes(candidates.map((candidate) => candidate.providerIds)),
  );
  const plan = buildCardImageRepairPlan(candidates, tcgcsvProductsByProviderCode);
  const imageFieldsUpdated = plan.reduce(
    (total, item) => total + Number(Boolean(item.imageLargeUrl)) + Number(Boolean(item.imageSmallUrl)),
    0,
  );

  if (!dryRun && plan.length) {
    await prisma.$transaction(
      plan.map((item) =>
        prisma.cardPrinting.update({
          data: {
            imageLargeUrl: item.imageLargeUrl,
            imageSmallUrl: item.imageSmallUrl,
          },
          where: { id: item.id },
        }),
      ),
    );
  }

  return {
    candidatesChecked: candidates.length,
    cardsUpdated: dryRun ? 0 : plan.length,
    dryRun,
    imageFieldsUpdated: dryRun ? 0 : imageFieldsUpdated,
    job: "card_image_repair",
    limit: safeLimit,
    repairableCards: plan.length,
    tcgcsvImageProductsFetched: Array.from(tcgcsvProductsByProviderCode.values()).reduce(
      (total, products) => total + products.length,
      0,
    ),
    sample: plan.slice(0, 5).map((item) => ({
      id: item.id,
      providerId: item.providerId,
      updatedFields: [
        item.imageLargeUrl ? "imageLargeUrl" : "",
        item.imageSmallUrl ? "imageSmallUrl" : "",
      ].filter(Boolean),
    })),
    skippedCards: candidates.length - plan.length,
  };
}

async function fetchKnownBadTcgcsvCardImageProducts(providerCodes: string[]) {
  const entries = await Promise.all(
    providerCodes.map(async (providerCode): Promise<[string, TcgcsvCardImageProduct[]]> => {
      const target = tcgcsvCardImageTargets.get(providerCode);

      if (!target) {
        return [providerCode, []];
      }

      try {
        const response = await fetch(`https://tcgcsv.com/tcgplayer/${target.categoryId}/${target.groupId}/products`, {
          headers: { accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error(`TCGCSV image product fetch failed with ${response.status}.`);
        }

        const data = (await response.json()) as { results?: TcgcsvCardImageProduct[] };

        return [providerCode, Array.isArray(data.results) ? data.results : []];
      } catch (error) {
        console.warn(`Unable to fetch TCGCSV image products for ${providerCode}.`, error);

        return [providerCode, []];
      }
    }),
  );

  return new Map(entries);
}

function boundedPositiveInteger(value: number | undefined, fallback: number, max: number) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.min(max, Math.floor(number));
}
