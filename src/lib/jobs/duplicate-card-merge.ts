import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  buildDuplicateCardMergePlan,
  type DuplicateCardMergeCardRow,
  type DuplicateCardMergeInput,
  type DuplicateCardMergePlan,
  type DuplicateCardMergeWishlistConflictRow,
} from "../catalogue/duplicate-card-merge";

type DuplicateCardMergeExecutionResult = DuplicateCardMergePlan & {
  collectionItemsMoved?: number;
  duplicateCardDeleted?: boolean;
  executedAt?: string;
  priceSnapshotsMoved?: number;
  wishlistConflictsMerged?: number;
  wishlistItemsMoved?: number;
};

type DuplicateCardMergeMutationCounts = {
  collectionItemsMoved: number;
  duplicateCardDeleted: boolean;
  priceSnapshotsMoved: number;
  wishlistConflictsMerged: number;
  wishlistItemsMoved: number;
};

type TxClient = Prisma.TransactionClient;

export async function mergeDuplicateCard(input: DuplicateCardMergeInput): Promise<DuplicateCardMergeExecutionResult> {
  const normalizedInput = normalizeDuplicateCardMergeInput(input);

  return prisma.$transaction(async (tx) => {
    if (normalizedInput.execute) {
      await lockCardRows(tx, normalizedInput);
    }

    const plan = await duplicateCardMergePlan(tx, normalizedInput);

    if (!normalizedInput.execute) {
      return plan;
    }

    if (!plan.canMerge) {
      throw new Error(plan.errors.join(" "));
    }

    const counts = await executeDuplicateCardMerge(tx, normalizedInput, plan);

    return {
      ...plan,
      ...counts,
      executedAt: new Date().toISOString(),
      mode: "execute",
    };
  });
}

function normalizeDuplicateCardMergeInput(input: DuplicateCardMergeInput): DuplicateCardMergeInput {
  const primaryCardId = input.primaryCardId?.trim();
  const duplicateCardId = input.duplicateCardId?.trim();

  if (!isUuid(primaryCardId)) {
    throw new Error("Primary card ID must be a valid UUID.");
  }

  if (!isUuid(duplicateCardId)) {
    throw new Error("Duplicate card ID must be a valid UUID.");
  }

  return {
    duplicateCardId,
    execute: input.execute === true,
    primaryCardId,
  };
}

async function duplicateCardMergePlan(tx: TxClient, input: DuplicateCardMergeInput) {
  const cards = await duplicateCardMergeCards(tx, input);
  const conflicts = await duplicateCardMergeWishlistConflicts(tx, input);

  return buildDuplicateCardMergePlan({
    conflicts,
    duplicateCard: cards.find((card) => card.id === input.duplicateCardId),
    execute: input.execute,
    input,
    primaryCard: cards.find((card) => card.id === input.primaryCardId),
  });
}

async function duplicateCardMergeCards(tx: TxClient, input: DuplicateCardMergeInput) {
  return tx.$queryRaw<DuplicateCardMergeCardRow[]>`
    SELECT
      cp.id,
      cp.name,
      cp.number,
      cp.provider_ids->>'pokemon_tcg_api' AS "providerId",
      cs.name AS "setName",
      COUNT(DISTINCT ci.id)::int AS "collectionCount",
      COUNT(DISTINCT wi.id)::int AS "wishlistCount",
      COUNT(DISTINCT ps.id)::int AS "priceSnapshotCount"
    FROM card_printings cp
    JOIN card_sets cs
      ON cs.id = cp.card_set_id
    LEFT JOIN collection_items ci
      ON ci.card_printing_id = cp.id
    LEFT JOIN wishlist_items wi
      ON wi.card_printing_id = cp.id
    LEFT JOIN price_snapshots ps
      ON ps.card_printing_id = cp.id
    WHERE cp.id IN (${input.primaryCardId}::uuid, ${input.duplicateCardId}::uuid)
    GROUP BY
      cp.id,
      cs.id
  `;
}

async function duplicateCardMergeWishlistConflicts(tx: TxClient, input: DuplicateCardMergeInput) {
  return tx.$queryRaw<DuplicateCardMergeWishlistConflictRow[]>`
    SELECT
      source.user_id AS "userId",
      source.id AS "sourceWishlistId",
      primary_wishlist.id AS "primaryWishlistId",
      source.priority::text AS "sourcePriority",
      primary_wishlist.priority::text AS "primaryPriority",
      source.target_price_minor AS "sourceTargetPriceMinor",
      source.target_currency AS "sourceTargetCurrency",
      source.variant_label AS "sourceVariantLabel",
      primary_wishlist.target_price_minor AS "primaryTargetPriceMinor",
      primary_wishlist.target_currency AS "primaryTargetCurrency",
      primary_wishlist.variant_label AS "primaryVariantLabel"
    FROM wishlist_items source
    JOIN wishlist_items primary_wishlist
      ON primary_wishlist.user_id = source.user_id
      AND primary_wishlist.card_printing_id = ${input.primaryCardId}::uuid
    WHERE source.card_printing_id = ${input.duplicateCardId}::uuid
    FOR UPDATE OF source, primary_wishlist
  `;
}

async function lockCardRows(tx: TxClient, input: DuplicateCardMergeInput) {
  await tx.$queryRaw`
    SELECT id
    FROM card_printings
    WHERE id IN (${input.primaryCardId}::uuid, ${input.duplicateCardId}::uuid)
    FOR UPDATE
  `;
}

async function executeDuplicateCardMerge(
  tx: TxClient,
  input: DuplicateCardMergeInput,
  plan: DuplicateCardMergePlan,
): Promise<DuplicateCardMergeMutationCounts> {
  const wishlistConflictsMerged = await mergeWishlistConflicts(tx, input);
  await deleteConflictingSourceWishlistItems(tx, input);
  const wishlistItemsMoved = await moveWishlistItems(tx, input);
  const collectionItemsMoved = await moveCollectionItems(tx, input);
  const priceSnapshotsMoved = await movePriceSnapshots(tx, input);
  await touchPrimaryCard(tx, input.primaryCardId);
  const duplicateCardsDeleted = await deleteDuplicateCard(tx, input.duplicateCardId);

  return {
    collectionItemsMoved,
    duplicateCardDeleted: duplicateCardsDeleted === 1,
    priceSnapshotsMoved,
    wishlistConflictsMerged: Math.min(wishlistConflictsMerged, plan.wishlistConflictsToMerge),
    wishlistItemsMoved,
  };
}

async function mergeWishlistConflicts(tx: TxClient, input: DuplicateCardMergeInput) {
  return tx.$executeRaw`
    UPDATE wishlist_items primary_wishlist
    SET
      priority = CASE
        WHEN (
          CASE source.priority::text
            WHEN 'grail' THEN 4
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 2
            ELSE 1
          END
        ) > (
          CASE primary_wishlist.priority::text
            WHEN 'grail' THEN 4
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 2
            ELSE 1
          END
        )
          THEN source.priority
        ELSE primary_wishlist.priority
      END,
      variant_label = CASE
        WHEN NULLIF(BTRIM(primary_wishlist.variant_label), '') IS NULL
          THEN source.variant_label
        ELSE primary_wishlist.variant_label
      END,
      target_price_minor = CASE
        WHEN NULLIF(BTRIM(primary_wishlist.variant_label), '') IS NULL
          AND NULLIF(BTRIM(source.variant_label), '') IS NOT NULL
          THEN source.target_price_minor
        WHEN NULLIF(BTRIM(primary_wishlist.variant_label), '') IS NOT NULL
          AND NULLIF(BTRIM(source.variant_label), '') IS NULL
          THEN primary_wishlist.target_price_minor
        WHEN primary_wishlist.target_price_minor IS NULL THEN source.target_price_minor
        WHEN source.target_price_minor IS NULL THEN primary_wishlist.target_price_minor
        WHEN primary_wishlist.target_currency IS NOT NULL
          AND source.target_currency IS NOT NULL
          AND primary_wishlist.target_currency <> source.target_currency THEN primary_wishlist.target_price_minor
        ELSE LEAST(primary_wishlist.target_price_minor, source.target_price_minor)
      END,
      target_currency = CASE
        WHEN NULLIF(BTRIM(primary_wishlist.variant_label), '') IS NULL
          AND NULLIF(BTRIM(source.variant_label), '') IS NOT NULL
          THEN source.target_currency
        WHEN NULLIF(BTRIM(primary_wishlist.variant_label), '') IS NOT NULL
          AND NULLIF(BTRIM(source.variant_label), '') IS NULL
          THEN primary_wishlist.target_currency
        WHEN primary_wishlist.target_price_minor IS NULL THEN source.target_currency
        WHEN source.target_price_minor IS NULL THEN primary_wishlist.target_currency
        WHEN primary_wishlist.target_currency IS NOT NULL
          AND source.target_currency IS NOT NULL
          AND primary_wishlist.target_currency <> source.target_currency THEN primary_wishlist.target_currency
        WHEN primary_wishlist.target_currency IS NULL THEN source.target_currency
        ELSE primary_wishlist.target_currency
      END,
      notes = LEFT(
        CONCAT_WS(
          E'\n',
          NULLIF(primary_wishlist.notes, ''),
          'Merged duplicate wishlist row ' || source.id::text || ' during duplicate card merge.'
        ),
        2000
      ),
      updated_at = NOW()
    FROM wishlist_items source
    WHERE primary_wishlist.user_id = source.user_id
      AND primary_wishlist.card_printing_id = ${input.primaryCardId}::uuid
      AND source.card_printing_id = ${input.duplicateCardId}::uuid
  `;
}

async function deleteConflictingSourceWishlistItems(tx: TxClient, input: DuplicateCardMergeInput) {
  return tx.$executeRaw`
    DELETE FROM wishlist_items source
    USING wishlist_items primary_wishlist
    WHERE source.card_printing_id = ${input.duplicateCardId}::uuid
      AND primary_wishlist.card_printing_id = ${input.primaryCardId}::uuid
      AND primary_wishlist.user_id = source.user_id
  `;
}

async function moveWishlistItems(tx: TxClient, input: DuplicateCardMergeInput) {
  return tx.$executeRaw`
    UPDATE wishlist_items
    SET
      card_printing_id = ${input.primaryCardId}::uuid,
      updated_at = NOW()
    WHERE card_printing_id = ${input.duplicateCardId}::uuid
  `;
}

async function moveCollectionItems(tx: TxClient, input: DuplicateCardMergeInput) {
  return tx.$executeRaw`
    UPDATE collection_items
    SET
      card_printing_id = ${input.primaryCardId}::uuid,
      updated_at = NOW()
    WHERE card_printing_id = ${input.duplicateCardId}::uuid
  `;
}

async function movePriceSnapshots(tx: TxClient, input: DuplicateCardMergeInput) {
  return tx.$executeRaw`
    UPDATE price_snapshots
    SET card_printing_id = ${input.primaryCardId}::uuid
    WHERE card_printing_id = ${input.duplicateCardId}::uuid
  `;
}

async function touchPrimaryCard(tx: TxClient, primaryCardId: string) {
  await tx.$executeRaw`
    UPDATE card_printings
    SET updated_at = NOW()
    WHERE id = ${primaryCardId}::uuid
  `;
}

async function deleteDuplicateCard(tx: TxClient, duplicateCardId: string) {
  return tx.$executeRaw`
    DELETE FROM card_printings
    WHERE id = ${duplicateCardId}::uuid
  `;
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
