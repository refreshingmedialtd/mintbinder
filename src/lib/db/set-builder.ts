import {
  ItemType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "./prisma.ts";
import {
  normalizeBulkWishlistInput,
  normalizeSetGoalInput,
  planSetWishlistBulkAdd,
  SET_BUILDER_BULK_WISHLIST_LIMIT,
  SetBuilderInputError,
  setGoalPriorityLabel,
} from "../set-builder.ts";
import {
  assertUserResourceCapacity,
  lockUserResourceQuota,
} from "./user-quotas.ts";

const setGoalSelect = {
  id: true,
  userId: true,
  cardSetId: true,
  targetCompletionPercent: true,
  wishlistPriority: true,
  createdAt: true,
  updatedAt: true,
  cardSet: {
    select: {
      id: true,
      name: true,
      language: true,
      region: true,
      series: true,
      releaseDate: true,
      printedTotal: true,
      total: true,
      symbolImageUrl: true,
      logoImageUrl: true,
    },
  },
} satisfies Prisma.SetGoalSelect;

type SetGoalRecord = Prisma.SetGoalGetPayload<{ select: typeof setGoalSelect }>;
type SetGoalClient = Pick<PrismaClient, "cardSet" | "setGoal">;

export { SetBuilderInputError } from "../set-builder.ts";

export async function getActiveSetGoal(
  userId: string,
  client: SetGoalClient = prisma,
) {
  const goal = await client.setGoal.findUnique({
    where: { userId },
    select: setGoalSelect,
  });

  return goal ? mapSetGoal(goal) : null;
}

export async function putActiveSetGoal(
  userId: string,
  input: unknown,
  client: SetGoalClient = prisma,
) {
  const normalized = normalizeSetGoalInput(input);
  const cardSet = await client.cardSet.findUnique({
    where: { id: normalized.cardSetId },
    select: { id: true },
  });

  if (!cardSet) {
    throw new SetBuilderInputError("Card set not found.", 404);
  }

  const goal = await client.setGoal.upsert({
    where: { userId },
    update: {
      cardSetId: cardSet.id,
      targetCompletionPercent: normalized.targetCompletionPercent,
      wishlistPriority: normalized.wishlistPriority,
    },
    create: {
      userId,
      cardSetId: cardSet.id,
      targetCompletionPercent: normalized.targetCompletionPercent,
      wishlistPriority: normalized.wishlistPriority,
    },
    select: setGoalSelect,
  });

  return mapSetGoal(goal);
}

export async function deleteActiveSetGoal(
  userId: string,
  client: Pick<PrismaClient, "setGoal"> = prisma,
) {
  const result = await client.setGoal.deleteMany({ where: { userId } });
  return result.count > 0;
}

export async function bulkAddActiveSetWishlist(
  userId: string,
  input: unknown,
) {
  const normalized = normalizeBulkWishlistInput(input);

  return prisma.$transaction((transaction) =>
    bulkAddActiveSetWishlistInTransaction(
      transaction,
      userId,
      normalized.cardPrintingIds,
    ),
  );
}

export async function bulkAddActiveSetWishlistInTransaction(
  transaction: Prisma.TransactionClient,
  userId: string,
  requestedCardIds?: string[],
) {
  const goal = await transaction.setGoal.findUnique({
    where: { userId },
    select: {
      cardSetId: true,
      wishlistPriority: true,
    },
  });

  if (!goal) {
    throw new SetBuilderInputError("Choose an active set goal first.", 409);
  }

  const setCards = await transaction.cardPrinting.findMany({
    where: {
      cardSetId: goal.cardSetId,
      id: requestedCardIds === undefined ? undefined : { in: requestedCardIds },
    },
    select: { id: true },
    orderBy: { id: "asc" },
    take: SET_BUILDER_BULK_WISHLIST_LIMIT + 1,
  });
  const setCardIds = setCards.map((card) => card.id);

  if (setCardIds.length > SET_BUILDER_BULK_WISHLIST_LIMIT) {
    throw new SetBuilderInputError(
      `This action is limited to ${SET_BUILDER_BULK_WISHLIST_LIMIT} card printings. Select a smaller group.`,
      413,
    );
  }

  const [wishlistedCards, ownedCards] = setCardIds.length
    ? await Promise.all([
        transaction.wishlistItem.findMany({
          where: {
            userId,
            cardPrintingId: { in: setCardIds },
          },
          select: { cardPrintingId: true },
          distinct: ["cardPrintingId"],
        }),
        transaction.collectionItem.findMany({
          where: {
            userId,
            archivedAt: null,
            cardPrintingId: { in: setCardIds },
          },
          select: { cardPrintingId: true },
          distinct: ["cardPrintingId"],
        }),
      ])
    : [[], []];
  const plan = planSetWishlistBulkAdd({
    requestedCardIds,
    setCardIds,
    wishlistedCardIds: wishlistedCards.flatMap((item) =>
      item.cardPrintingId ? [item.cardPrintingId] : [],
    ),
    ownedCardIds: ownedCards.flatMap((item) =>
      item.cardPrintingId ? [item.cardPrintingId] : [],
    ),
  });
  if (plan.cardPrintingIdsToAdd.length) {
    await lockUserResourceQuota(transaction, userId, "wishlistItems");
    const currentWishlistCount = await transaction.wishlistItem.count({ where: { userId } });
    assertUserResourceCapacity(
      currentWishlistCount,
      plan.cardPrintingIdsToAdd.length,
      "wishlistItems",
    );
  }
  const inserted = plan.cardPrintingIdsToAdd.length
    ? await transaction.wishlistItem.createMany({
        data: plan.cardPrintingIdsToAdd.map((cardPrintingId) => ({
          userId,
          itemType: ItemType.CARD,
          cardPrintingId,
          priority: goal.wishlistPriority,
          notes: "Added from Set Builder.",
        })),
        skipDuplicates: true,
      })
    : { count: 0 };
  const concurrentDuplicatesSkipped = plan.cardPrintingIdsToAdd.length - inserted.count;

  return {
    activeSetId: goal.cardSetId,
    requested: plan.requested,
    selected: plan.selected,
    added: inserted.count,
    alreadyWishlisted: plan.alreadyWishlistedCardIds.length,
    ownedSkipped: plan.ownedCardIdsToSkip.length,
    outsideActiveSetSkipped: plan.outsideActiveSetSkipped,
    concurrentDuplicatesSkipped,
    cappedAt: SET_BUILDER_BULK_WISHLIST_LIMIT,
  };
}

function mapSetGoal(goal: SetGoalRecord) {
  return {
    id: goal.id,
    cardSetId: goal.cardSetId,
    targetCompletionPercent: goal.targetCompletionPercent,
    wishlistPriority: setGoalPriorityLabel(goal.wishlistPriority),
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
    set: {
      id: goal.cardSet.id,
      name: goal.cardSet.name,
      language: goal.cardSet.language,
      region: goal.cardSet.region,
      series: goal.cardSet.series ?? undefined,
      releaseDate: goal.cardSet.releaseDate?.toISOString().slice(0, 10),
      printedTotal: goal.cardSet.printedTotal ?? undefined,
      total: goal.cardSet.total ?? undefined,
      symbolImageUrl: goal.cardSet.symbolImageUrl ?? undefined,
      logoImageUrl: goal.cardSet.logoImageUrl ?? undefined,
    },
  };
}
