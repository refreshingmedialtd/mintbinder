export type TcgcsvCardPricingOptions = {
  apiRetryAttempts?: number;
  apiRetryWaitMs?: number;
  apiTimeoutMs?: number;
  categoryId?: number;
  fetchImpl?: typeof fetch;
  providerUpdatedAt?: Date | string;
  groupIds?: string[] | string;
  excludeGroupIds?: string[] | string;
  groupLimit?: number;
  language?: string;
  minUnpricedCards?: number;
  onlyUnpricedGroups?: boolean;
  priceOnlyUnpriced?: boolean;
  prisma?: unknown;
  source?: string;
  usdToGbpRate?: number;
  waitMs?: number;
  writeImages?: boolean;
  writePrices?: boolean;
};

export type TcgcsvCardPricingSummary = {
  cardImagesUpdated: number;
  cardProductsMatched: number;
  cardProductsSkipped: number;
  cardProductsUnmatched: number;
  catalogueCardsAvailable: number;
  catalogueCardsExpected: number;
  catalogueIncompleteGroups: number;
  categoryId: number;
  groupsAvailable: number;
  groupsMatched: number;
  groupsProcessed: number;
  processedGroupIds: string[];
  rotationGroupsAvailable: number;
  identitySnapshotsRelabelled: number;
  language: string;
  minUnpricedCards: number;
  onlyUnpricedGroups: boolean;
  priceOnlyUnpriced: boolean;
  providerUpdatedAt: string;
  pricingSnapshotsCreated: number;
  pricingSnapshotsUpdated: number;
  productsFetched: number;
  sampleUnmatchedProducts: Array<Record<string, unknown>>;
  sampleIncompleteGroups: Array<Record<string, unknown>>;
  source: string;
  writePrices: boolean;
};

export function cardPricingOptionsFromEnv(
  env?: Record<string, string | undefined>,
): TcgcsvCardPricingOptions;

export function japanCardPricingOptionsFromEnv(
  env?: Record<string, string | undefined>,
): TcgcsvCardPricingOptions;

export function syncTcgcsvCardPrices(
  options?: TcgcsvCardPricingOptions,
): Promise<TcgcsvCardPricingSummary>;

export function matchTcgcsvCardProduct(product: unknown, cards: unknown[]): unknown | null;

export function tcgcsvCardVariantLabel(
  product: unknown,
  subTypeName?: string | null,
  group?: { groupId?: number | string; name?: string },
  card?: { variantMetadata?: unknown },
): string;

export function tcgdexProductVariantLabel(
  variantMetadata: unknown,
  productId: number | string,
): string | undefined;

export function resolveTcgcsvVariantIdentities<T extends {
  cardPrintingId: string;
  product?: { productId?: number | string; name?: string; url?: string };
  group?: { groupId?: number | string; name?: string };
  card?: { variantMetadata?: unknown };
  sourceRef?: string;
  subTypeName?: string | null;
}>(entries: T[]): Array<T & { sourceRef: string; variantLabel: string }>;
