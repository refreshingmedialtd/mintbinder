import { Prisma } from "@prisma/client";

type BinderSlotTransaction = {
  binderSlot: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: { collectionItemId: null; copyIndex: null };
    }): Promise<{ count: number }>;
  };
};

type CollectionItemLockTransaction = {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
};

export async function lockCollectionItemsForBinderConsistency(
  transaction: CollectionItemLockTransaction,
  userId: string,
  collectionItemIds: string[],
) {
  const ids = [...new Set(collectionItemIds)].sort();

  if (!ids.length) return;

  await transaction.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "collection_items"
    WHERE "id" IN (${Prisma.join(ids)})
      AND "user_id" = ${userId}::uuid
      AND "archived_at" IS NULL
    ORDER BY "id"
    FOR UPDATE
  `);
}

export function reconcileBinderSlotsForQuantity(
  transaction: BinderSlotTransaction,
  collectionItemId: string,
  remainingQuantity: number,
) {
  return transaction.binderSlot.updateMany({
    where: remainingQuantity > 0
      ? {
          collectionItemId,
          OR: [
            { copyIndex: null },
            { copyIndex: { gt: remainingQuantity } },
          ],
        }
      : { collectionItemId },
    data: {
      collectionItemId: null,
      copyIndex: null,
    },
  });
}
