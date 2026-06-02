export type DuplicateCardMergeCardRow = {
  collectionCount: number;
  id: string;
  name: string;
  number: string;
  priceSnapshotCount: number;
  providerId: string | null;
  setName: string;
  wishlistCount: number;
};

export type DuplicateCardMergeWishlistConflictRow = {
  primaryPriority: string;
  primaryTargetCurrency: string | null;
  primaryTargetPriceMinor: number | null;
  primaryWishlistId: string;
  sourcePriority: string;
  sourceTargetCurrency: string | null;
  sourceTargetPriceMinor: number | null;
  sourceWishlistId: string;
  userId: string;
};

export type DuplicateCardMergeInput = {
  duplicateCardId: string;
  execute?: boolean;
  primaryCardId: string;
};

export type DuplicateCardMergeConflict = {
  mergedPriority: string;
  mergedTargetCurrency?: string;
  mergedTargetPriceMinor?: number;
  primaryWishlistId: string;
  sourceWishlistId: string;
  userId: string;
};

export type DuplicateCardMergePlan = {
  canMerge: boolean;
  collectionItemsToMove: number;
  duplicateCard?: DuplicateCardMergeCardRow;
  duplicateCardId: string;
  duplicateCardWillBeDeleted: boolean;
  errors: string[];
  generatedAt: string;
  mode: "dry_run" | "execute";
  priceSnapshotsToMove: number;
  primaryCard?: DuplicateCardMergeCardRow;
  primaryCardId: string;
  providerId?: string;
  report: "duplicate_card_merge";
  warnings: string[];
  wishlistConflicts: DuplicateCardMergeConflict[];
  wishlistConflictsToMerge: number;
  wishlistItemsToMove: number;
};

export function buildDuplicateCardMergePlan({
  conflicts,
  duplicateCard,
  execute = false,
  generatedAt = new Date(),
  input,
  primaryCard,
}: {
  conflicts: DuplicateCardMergeWishlistConflictRow[];
  duplicateCard?: DuplicateCardMergeCardRow;
  execute?: boolean;
  generatedAt?: Date;
  input?: DuplicateCardMergeInput;
  primaryCard?: DuplicateCardMergeCardRow;
}): DuplicateCardMergePlan {
  const errors = duplicateCardMergeErrors(primaryCard, duplicateCard);
  const wishlistConflicts = conflicts.map(duplicateCardMergeConflict);
  const nonConflictingWishlistCount = Math.max(
    0,
    (duplicateCard?.wishlistCount ?? 0) - wishlistConflicts.length,
  );

  return {
    canMerge: errors.length === 0,
    collectionItemsToMove: duplicateCard?.collectionCount ?? 0,
    duplicateCard,
    duplicateCardId: duplicateCard?.id ?? input?.duplicateCardId ?? "",
    duplicateCardWillBeDeleted: errors.length === 0,
    errors,
    generatedAt: generatedAt.toISOString(),
    mode: execute ? "execute" : "dry_run",
    priceSnapshotsToMove: duplicateCard?.priceSnapshotCount ?? 0,
    primaryCard,
    primaryCardId: primaryCard?.id ?? input?.primaryCardId ?? "",
    providerId: primaryCard?.providerId ?? duplicateCard?.providerId ?? undefined,
    report: "duplicate_card_merge",
    warnings: duplicateCardMergeWarnings(wishlistConflicts),
    wishlistConflicts,
    wishlistConflictsToMerge: wishlistConflicts.length,
    wishlistItemsToMove: nonConflictingWishlistCount,
  };
}

export function duplicateCardMergeConflict(
  row: DuplicateCardMergeWishlistConflictRow,
): DuplicateCardMergeConflict {
  const target = mergedWishlistTarget(row);

  return {
    mergedPriority: strongerWishlistPriority(row.primaryPriority, row.sourcePriority),
    mergedTargetCurrency: target.currency ?? undefined,
    mergedTargetPriceMinor: target.priceMinor ?? undefined,
    primaryWishlistId: row.primaryWishlistId,
    sourceWishlistId: row.sourceWishlistId,
    userId: row.userId,
  };
}

export function strongerWishlistPriority(left: string, right: string) {
  return priorityRank(right) > priorityRank(left) ? right : left;
}

function duplicateCardMergeErrors(
  primaryCard?: DuplicateCardMergeCardRow,
  duplicateCard?: DuplicateCardMergeCardRow,
) {
  const errors: string[] = [];

  if (!primaryCard) {
    errors.push("Primary card was not found.");
  }

  if (!duplicateCard) {
    errors.push("Duplicate card was not found.");
  }

  if (primaryCard?.id && duplicateCard?.id && primaryCard.id === duplicateCard.id) {
    errors.push("Primary and duplicate card IDs must be different.");
  }

  if (primaryCard && duplicateCard) {
    if (!primaryCard.providerId || !duplicateCard.providerId) {
      errors.push("Both cards must have a Pokemon TCG provider ID.");
    } else if (primaryCard.providerId !== duplicateCard.providerId) {
      errors.push("Cards must share the same Pokemon TCG provider ID before they can be merged.");
    }
  }

  return errors;
}

function duplicateCardMergeWarnings(conflicts: DuplicateCardMergeConflict[]) {
  if (!conflicts.length) {
    return [];
  }

  return [
    `${conflicts.length} wishlist conflict${conflicts.length === 1 ? "" : "s"} will keep the primary wishlist row and remove the duplicate wishlist row.`,
  ];
}

function mergedWishlistTarget(row: DuplicateCardMergeWishlistConflictRow) {
  if (row.primaryTargetPriceMinor === null || row.primaryTargetPriceMinor === undefined) {
    return {
      currency: row.sourceTargetCurrency,
      priceMinor: row.sourceTargetPriceMinor,
    };
  }

  if (row.sourceTargetPriceMinor === null || row.sourceTargetPriceMinor === undefined) {
    return {
      currency: row.primaryTargetCurrency,
      priceMinor: row.primaryTargetPriceMinor,
    };
  }

  if (row.primaryTargetCurrency && row.sourceTargetCurrency && row.primaryTargetCurrency !== row.sourceTargetCurrency) {
    return {
      currency: row.primaryTargetCurrency,
      priceMinor: row.primaryTargetPriceMinor,
    };
  }

  return {
    currency: row.primaryTargetCurrency ?? row.sourceTargetCurrency,
    priceMinor: Math.min(row.primaryTargetPriceMinor, row.sourceTargetPriceMinor),
  };
}

function priorityRank(priority: string) {
  if (priority === "grail") {
    return 4;
  }

  if (priority === "high") {
    return 3;
  }

  if (priority === "medium") {
    return 2;
  }

  return 1;
}
