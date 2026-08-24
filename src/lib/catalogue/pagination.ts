export const CATALOGUE_SEARCH_DEFAULT_LIMIT = 40;
export const CATALOGUE_SEARCH_MAX_LIMIT = 100;
export const CATALOGUE_SEARCH_MAX_OFFSET = 1_000;

export function normalizeCatalogueSearchLimit(value: unknown) {
  const limit = Number(value);

  return Number.isFinite(limit) && limit > 0
    ? Math.min(Math.floor(limit), CATALOGUE_SEARCH_MAX_LIMIT)
    : CATALOGUE_SEARCH_DEFAULT_LIMIT;
}

export function normalizeCatalogueSearchOffset(value: unknown) {
  const offset = Number(value);

  return Number.isFinite(offset) && offset > 0
    ? Math.min(Math.floor(offset), CATALOGUE_SEARCH_MAX_OFFSET)
    : 0;
}

export function paginateCatalogueResults<T>(
  results: T[],
  { limit, offset }: { limit: number; offset: number },
) {
  const catalogue = results.slice(offset, offset + limit);
  const hasMore = results.length > offset + limit;
  const candidateNextOffset = offset + catalogue.length;
  const nextOffset = hasMore && candidateNextOffset <= CATALOGUE_SEARCH_MAX_OFFSET
    ? candidateNextOffset
    : null;

  return {
    catalogue,
    hasMore,
    nextOffset,
    returned: catalogue.length,
    windowExhausted: hasMore && nextOffset === null,
  };
}

export function catalogueSearchLookahead({ limit, offset }: { limit: number; offset: number }) {
  return offset + limit + 1;
}
