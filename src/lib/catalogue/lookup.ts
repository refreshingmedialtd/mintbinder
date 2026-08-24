export const CATALOGUE_LOOKUP_MAX_IDS = 100;
export const CATALOGUE_SET_MAX_ITEMS = 500;

export class CatalogueLookupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogueLookupValidationError";
  }
}

export function uniqueCatalogueLookupIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new CatalogueLookupValidationError("Catalogue IDs must be provided as an array.");
  }

  const ids: string[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (typeof candidate !== "string") {
      throw new CatalogueLookupValidationError("Every catalogue ID must be a string.");
    }

    const id = candidate.trim();

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
}

export function normalizeCatalogueLookupIds(value: unknown): string[] {
  const ids = uniqueCatalogueLookupIds(value);

  if (ids.length > CATALOGUE_LOOKUP_MAX_IDS) {
    throw new CatalogueLookupValidationError(
      `A catalogue lookup is limited to ${CATALOGUE_LOOKUP_MAX_IDS} unique IDs.`,
    );
  }

  return ids;
}

export function chunkCatalogueLookupIds(value: unknown): string[][] {
  const ids = uniqueCatalogueLookupIds(value);
  const batches: string[][] = [];

  for (let index = 0; index < ids.length; index += CATALOGUE_LOOKUP_MAX_IDS) {
    batches.push(ids.slice(index, index + CATALOGUE_LOOKUP_MAX_IDS));
  }

  return batches;
}
