import { prisma } from "../db/prisma";
import { buildCardImageRepairPlan } from "../catalogue/image-repair";

export type CardImageRepairOptions = {
  dryRun?: boolean;
  limit?: number;
};

const DEFAULT_REPAIR_LIMIT = 500;
const MAX_REPAIR_LIMIT = 5000;

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
      providerIds: true,
    },
    take: safeLimit,
    where: {
      OR: [
        { imageLargeUrl: null },
        { imageLargeUrl: "" },
        { imageSmallUrl: null },
        { imageSmallUrl: "" },
      ],
    },
  });
  const plan = buildCardImageRepairPlan(candidates);
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

function boundedPositiveInteger(value: number | undefined, fallback: number, max: number) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.min(max, Math.floor(number));
}
