export type CatalogueJobResult = {
  cardsFetched?: number;
  cardsUpserted?: number;
  complete?: boolean;
  maxPages?: number;
  nextPage?: number | null;
  page?: number;
  pageSize?: number;
  pagesProcessed?: number;
  pricingSnapshotsCreated?: number;
  query?: string;
  setsUpserted?: number;
  totalCount?: number;
};

export type CatalogueStatus = {
  cardCount: number;
  coveragePercent: number | null;
  duplicateProviderIdCount: number;
  latestCatalogueResult: CatalogueJobResult | null;
  latestPricingResult: CatalogueJobResult | null;
  nextCataloguePage: number | null;
  priceSnapshotCount: number;
  pricedCardCount: number;
  pricingCoveragePercent: number | null;
  providerTotalCount: number | null;
  sealedProductCount: number;
  setCount: number;
};

export function summarizeCatalogueStatus({
  cardCount,
  duplicateProviderIdCount,
  latestCatalogueResult,
  latestPricingResult,
  pricedCardCount,
  priceSnapshotCount,
  sealedProductCount,
  setCount,
}: {
  cardCount: number;
  duplicateProviderIdCount: number;
  latestCatalogueResult?: unknown;
  latestPricingResult?: unknown;
  pricedCardCount: number;
  priceSnapshotCount: number;
  sealedProductCount: number;
  setCount: number;
}): CatalogueStatus {
  const catalogueResult = normalizeCatalogueResult(latestCatalogueResult);
  const pricingResult = normalizeCatalogueResult(latestPricingResult);
  const providerTotalCount = positiveNumber(catalogueResult?.totalCount) ?? null;
  const coveragePercent = providerTotalCount
    ? Math.min(100, Math.round((cardCount / providerTotalCount) * 1000) / 10)
    : null;

  return {
    cardCount,
    coveragePercent,
    duplicateProviderIdCount,
    latestCatalogueResult: catalogueResult,
    latestPricingResult: pricingResult,
    nextCataloguePage: catalogueResult?.complete ? null : positiveNumber(catalogueResult?.nextPage) ?? null,
    priceSnapshotCount,
    pricedCardCount,
    pricingCoveragePercent: cardCount > 0 ? Math.min(100, Math.round((pricedCardCount / cardCount) * 1000) / 10) : null,
    providerTotalCount,
    sealedProductCount,
    setCount,
  };
}

export function normalizeCatalogueResult(value: unknown): CatalogueJobResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;

  return {
    cardsFetched: positiveNumber(source.cardsFetched),
    cardsUpserted: positiveNumber(source.cardsUpserted),
    complete: typeof source.complete === "boolean" ? source.complete : undefined,
    maxPages: positiveNumber(source.maxPages),
    nextPage: source.nextPage === null ? null : positiveNumber(source.nextPage),
    page: positiveNumber(source.page),
    pageSize: positiveNumber(source.pageSize),
    pagesProcessed: positiveNumber(source.pagesProcessed),
    pricingSnapshotsCreated: positiveNumber(source.pricingSnapshotsCreated),
    query: typeof source.query === "string" ? source.query : undefined,
    setsUpserted: positiveNumber(source.setsUpserted),
    totalCount: positiveNumber(source.totalCount),
  };
}

function positiveNumber(value: unknown) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return undefined;
  }

  return Math.floor(number);
}
