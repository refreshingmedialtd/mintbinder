export type CatalogueJobResult = {
  cardsFetched?: number;
  cardsUpserted?: number;
  complete?: boolean;
  groupsAvailable?: number;
  groupsMatched?: number;
  groupsProcessed?: number;
  maxPages?: number;
  nextPage?: number | null;
  page?: number;
  pageSize?: number;
  priceOnlyUnpriced?: boolean;
  pagesProcessed?: number;
  pricingSnapshotsCreated?: number;
  productsFetched?: number;
  query?: string;
  sealedProductsSkipped?: number;
  sealedProductsUpserted?: number;
  setsUpserted?: number;
  totalCount?: number;
  writePrices?: boolean;
};

export type PricingBySeriesGap = {
  cardCount: number;
  pricedCardCount: number;
  pricingCoveragePercent: number | null;
  series: string;
  unpricedCardCount: number;
};

export type PricingBySourceSummary = {
  itemType: string;
  pricedItemCount: number;
  priceSnapshotCount: number;
  source: string;
};

export type SealedPricingByProductTypeGap = {
  pricedSealedProductCount: number;
  sealedPriceSnapshotCount: number;
  sealedPricingCoveragePercent: number | null;
  sealedProductCount: number;
  productType: string;
  unpricedSealedProductCount: number;
};

export type CatalogueStatus = {
  cardCount: number;
  cardImageCount: number;
  cardImageCoveragePercent: number | null;
  cardMissingImageCount: number;
  cardMissingVariantMetadataCount: number;
  cardVariantMetadataCount: number;
  cardVariantMetadataCoveragePercent: number | null;
  coveragePercent: number | null;
  duplicateProviderIdCount: number;
  latestCatalogueResult: CatalogueJobResult | null;
  latestPricingResult: CatalogueJobResult | null;
  latestSealedPricingResult: CatalogueJobResult | null;
  nextCataloguePage: number | null;
  priceSnapshotCount: number;
  pricedCardCount: number;
  pricedSealedProductCount: number;
  pricingBySeries: PricingBySeriesGap[];
  pricingBySource: PricingBySourceSummary[];
  pricingCoveragePercent: number | null;
  providerTotalCount: number | null;
  sealedPricingByProductType: SealedPricingByProductTypeGap[];
  sealedPriceSnapshotCount: number;
  sealedImageCount: number;
  sealedImageCoveragePercent: number | null;
  sealedMissingImageCount: number;
  sealedPricingCoveragePercent: number | null;
  sealedProductCount: number;
  setCount: number;
};

export function summarizeCatalogueStatus({
  cardCount,
  cardImageCount = 0,
  cardVariantMetadataCount = 0,
  duplicateProviderIdCount,
  latestCatalogueResult,
  latestPricingResult,
  latestSealedPricingResult,
  pricedCardCount,
  pricedSealedProductCount,
  pricingBySeries = [],
  pricingBySource = [],
  priceSnapshotCount,
  sealedImageCount = 0,
  sealedPricingByProductType = [],
  sealedPriceSnapshotCount,
  sealedProductCount,
  setCount,
}: {
  cardCount: number;
  cardImageCount?: number;
  cardVariantMetadataCount?: number;
  duplicateProviderIdCount: number;
  latestCatalogueResult?: unknown;
  latestPricingResult?: unknown;
  latestSealedPricingResult?: unknown;
  pricedCardCount: number;
  pricedSealedProductCount: number;
  pricingBySeries?: PricingBySeriesGap[];
  pricingBySource?: PricingBySourceSummary[];
  priceSnapshotCount: number;
  sealedImageCount?: number;
  sealedPricingByProductType?: SealedPricingByProductTypeGap[];
  sealedPriceSnapshotCount: number;
  sealedProductCount: number;
  setCount: number;
}): CatalogueStatus {
  const catalogueResult = normalizeCatalogueResult(latestCatalogueResult);
  const pricingResult = normalizeCatalogueResult(latestPricingResult);
  const sealedPricingResult = normalizeCatalogueResult(latestSealedPricingResult);
  const providerTotalCount = positiveNumber(catalogueResult?.totalCount) ?? null;
  const coveragePercent = percent(cardCount, providerTotalCount ?? 0);

  return {
    cardCount,
    cardImageCount,
    cardImageCoveragePercent: percent(cardImageCount, cardCount),
    cardMissingImageCount: Math.max(0, cardCount - cardImageCount),
    cardMissingVariantMetadataCount: Math.max(0, cardCount - cardVariantMetadataCount),
    cardVariantMetadataCount,
    cardVariantMetadataCoveragePercent: percent(cardVariantMetadataCount, cardCount),
    coveragePercent,
    duplicateProviderIdCount,
    latestCatalogueResult: catalogueResult,
    latestPricingResult: pricingResult,
    latestSealedPricingResult: sealedPricingResult,
    nextCataloguePage: catalogueResult?.complete ? null : positiveNumber(catalogueResult?.nextPage) ?? null,
    priceSnapshotCount,
    pricedCardCount,
    pricedSealedProductCount,
    pricingBySeries,
    pricingBySource,
    pricingCoveragePercent: percent(pricedCardCount, cardCount),
    providerTotalCount,
    sealedPricingByProductType,
    sealedPriceSnapshotCount,
    sealedImageCount,
    sealedImageCoveragePercent: percent(sealedImageCount, sealedProductCount),
    sealedMissingImageCount: Math.max(0, sealedProductCount - sealedImageCount),
    sealedPricingCoveragePercent: percent(pricedSealedProductCount, sealedProductCount),
    sealedProductCount,
    setCount,
  };
}

export function normalizeCatalogueResult(value: unknown): CatalogueJobResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;

  if (typeof source.job === "string" && source.job.endsWith("_repair")) {
    return null;
  }

  const result = {
    cardsFetched: nonNegativeNumber(source.cardsFetched),
    cardsUpserted: nonNegativeNumber(source.cardsUpserted),
    complete: typeof source.complete === "boolean" ? source.complete : undefined,
    groupsAvailable: nonNegativeNumber(source.groupsAvailable),
    groupsMatched: nonNegativeNumber(source.groupsMatched),
    groupsProcessed: nonNegativeNumber(source.groupsProcessed),
    maxPages: positiveNumber(source.maxPages),
    nextPage: source.nextPage === null ? null : positiveNumber(source.nextPage),
    page: positiveNumber(source.page),
    pageSize: positiveNumber(source.pageSize),
    priceOnlyUnpriced: typeof source.priceOnlyUnpriced === "boolean" ? source.priceOnlyUnpriced : undefined,
    pagesProcessed: nonNegativeNumber(source.pagesProcessed),
    pricingSnapshotsCreated: nonNegativeNumber(source.pricingSnapshotsCreated),
    productsFetched: nonNegativeNumber(source.productsFetched),
    query: typeof source.query === "string" ? source.query : undefined,
    sealedProductsSkipped: nonNegativeNumber(source.sealedProductsSkipped),
    sealedProductsUpserted: nonNegativeNumber(source.sealedProductsUpserted),
    setsUpserted: nonNegativeNumber(source.setsUpserted),
    totalCount: nonNegativeNumber(source.totalCount),
    writePrices: typeof source.writePrices === "boolean" ? source.writePrices : undefined,
  };

  return Object.values(result).some((entry) => entry !== undefined) ? result : null;
}

export function percent(value: number, total: number) {
  if (total <= 0) {
    return null;
  }

  return Math.min(100, Math.round((value / total) * 1000) / 10);
}

function positiveNumber(value: unknown) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return undefined;
  }

  return Math.floor(number);
}

function nonNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return undefined;
  }

  return Math.floor(number);
}
