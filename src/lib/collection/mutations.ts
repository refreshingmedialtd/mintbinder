export class CollectionMutationInputError extends Error {
  status = 400;

  constructor(message: string) {
    super(message);
    this.name = "CollectionMutationInputError";
  }
}

export function normalizeCollectionQuantity(value?: number) {
  const quantity = Number(value ?? 1);

  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
    throw new CollectionMutationInputError("Quantity must be a whole number between 1 and 1,000,000.");
  }

  return quantity;
}

export function normalizeSaleQuantity(value: number | undefined, availableQuantity: number) {
  const quantity = value === undefined ? availableQuantity : Number(value);

  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > availableQuantity) {
    throw new CollectionMutationInputError(`Sale quantity must be a whole number between 1 and ${availableQuantity}.`);
  }

  return quantity;
}

export function proportionalMinor(
  valueMinor: number | null,
  quantity: number,
  totalQuantity: number,
) {
  if (valueMinor === null) {
    return null;
  }

  return Math.round(valueMinor * quantity / totalQuantity);
}

export function remainingMinor(valueMinor: number | null, allocatedMinor: number | null) {
  if (valueMinor === null || allocatedMinor === null) {
    return null;
  }

  return valueMinor - allocatedMinor;
}
