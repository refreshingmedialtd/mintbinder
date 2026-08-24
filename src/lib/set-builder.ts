export const SET_GOAL_MIN_COMPLETION_PERCENT = 1;
export const SET_GOAL_MAX_COMPLETION_PERCENT = 100;
export const SET_BUILDER_BULK_WISHLIST_LIMIT = 500;

export type SetGoalWishlistPriority = "LOW" | "MEDIUM" | "HIGH" | "GRAIL";

export class SetBuilderInputError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SetBuilderInputError";
    this.status = status;
  }
}

export function normalizeSetGoalInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SetBuilderInputError("A set goal payload is required.");
  }

  const payload = input as Record<string, unknown>;
  const cardSetId = requiredUuid(payload.cardSetId, "Card set id");

  return {
    cardSetId,
    targetCompletionPercent: optionalCompletionPercent(payload.targetCompletionPercent),
    wishlistPriority: optionalWishlistPriority(payload.wishlistPriority),
  };
}

export function normalizeBulkWishlistCardIds(input: unknown): string[] | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }

  if (!Array.isArray(input)) {
    throw new SetBuilderInputError("cardPrintingIds must be an array when provided.");
  }

  if (input.length > SET_BUILDER_BULK_WISHLIST_LIMIT) {
    throw new SetBuilderInputError(
      `Choose no more than ${SET_BUILDER_BULK_WISHLIST_LIMIT} card printings at once.`,
      413,
    );
  }

  const ids: string[] = [];
  const seen = new Set<string>();

  for (const value of input) {
    if (typeof value !== "string" || !value.trim()) {
      throw new SetBuilderInputError("Every card printing id must be a non-empty string.");
    }

    const id = requiredUuid(value, "Card printing id");
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

export function normalizeBulkWishlistInput(input: unknown) {
  if (input === undefined || input === null) {
    return { cardPrintingIds: undefined };
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    throw new SetBuilderInputError("A JSON object is required.");
  }

  return {
    cardPrintingIds: normalizeBulkWishlistCardIds(
      (input as Record<string, unknown>).cardPrintingIds,
    ),
  };
}

export function planSetWishlistBulkAdd({
  ownedCardIds,
  requestedCardIds,
  setCardIds,
  wishlistedCardIds,
}: {
  ownedCardIds: string[];
  requestedCardIds?: string[];
  setCardIds: string[];
  wishlistedCardIds: string[];
}) {
  if (setCardIds.length > SET_BUILDER_BULK_WISHLIST_LIMIT) {
    throw new SetBuilderInputError(
      `This action is limited to ${SET_BUILDER_BULK_WISHLIST_LIMIT} card printings. Select a smaller group.`,
      413,
    );
  }

  const setIds = new Set(setCardIds);
  const selectedCardIds = (requestedCardIds ?? setCardIds).filter((id) => setIds.has(id));
  const wishlistedIds = new Set(wishlistedCardIds);
  const ownedIds = new Set(ownedCardIds);
  const alreadyWishlistedCardIds = selectedCardIds.filter((id) => wishlistedIds.has(id));
  const ownedCardIdsToSkip = selectedCardIds.filter(
    (id) => !wishlistedIds.has(id) && ownedIds.has(id),
  );
  const cardPrintingIdsToAdd = selectedCardIds.filter(
    (id) => !wishlistedIds.has(id) && !ownedIds.has(id),
  );

  return {
    requested: requestedCardIds?.length ?? setCardIds.length,
    selected: selectedCardIds.length,
    outsideActiveSetSkipped:
      requestedCardIds === undefined ? 0 : requestedCardIds.length - selectedCardIds.length,
    alreadyWishlistedCardIds,
    ownedCardIdsToSkip,
    cardPrintingIdsToAdd,
  };
}

export function setGoalPriorityLabel(priority: SetGoalWishlistPriority) {
  return `${priority.charAt(0)}${priority.slice(1).toLowerCase()}` as
    | "Low"
    | "Medium"
    | "High"
    | "Grail";
}

function optionalCompletionPercent(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < SET_GOAL_MIN_COMPLETION_PERCENT ||
    value > SET_GOAL_MAX_COMPLETION_PERCENT
  ) {
    throw new SetBuilderInputError(
      `Target completion must be a whole number from ${SET_GOAL_MIN_COMPLETION_PERCENT} to ${SET_GOAL_MAX_COMPLETION_PERCENT}.`,
    );
  }

  return value;
}

function optionalWishlistPriority(value: unknown): SetGoalWishlistPriority | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new SetBuilderInputError("Wishlist priority must be Low, Medium, High, or Grail.");
  }

  const priority = value.trim().toUpperCase();
  if (priority === "LOW" || priority === "MEDIUM" || priority === "HIGH" || priority === "GRAIL") {
    return priority;
  }

  throw new SetBuilderInputError("Wishlist priority must be Low, Medium, High, or Grail.");
}

function requiredText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new SetBuilderInputError(`${label} is required.`);
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new SetBuilderInputError(`${label} must be ${maxLength} characters or fewer.`);
  }

  return normalized;
}

function requiredUuid(value: unknown, label: string) {
  const normalized = requiredText(value, label, 36);

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new SetBuilderInputError(`${label} must be a valid id.`);
  }

  return normalized.toLowerCase();
}
