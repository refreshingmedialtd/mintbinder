export type TcgcsvCardPricingOptions = {
  categoryId?: number;
  fetchImpl?: typeof fetch;
  groupIds?: string[] | string;
  groupLimit?: number;
  language?: string;
  minUnpricedCards?: number;
  onlyUnpricedGroups?: boolean;
  priceOnlyUnpriced?: boolean;
  prisma?: unknown;
  source?: string;
  usdToGbpRate?: number;
  waitMs?: number;
  writePrices?: boolean;
};

export type TcgcsvCardPricingSummary = {
  cardProductsMatched: number;
  cardProductsSkipped: number;
  cardProductsUnmatched: number;
  categoryId: number;
  groupsAvailable: number;
  groupsMatched: number;
  groupsProcessed: number;
  language: string;
  minUnpricedCards: number;
  onlyUnpricedGroups: boolean;
  priceOnlyUnpriced: boolean;
  pricingSnapshotsCreated: number;
  productsFetched: number;
  sampleUnmatchedProducts: Array<Record<string, unknown>>;
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

export function tcgcsvCardVariantLabel(product: unknown, subTypeName?: string | null): string;

export function resolveTcgcsvVariantIdentities<T extends {
  cardPrintingId: string;
  product?: { productId?: number | string; name?: string; url?: string };
  sourceRef?: string;
  subTypeName?: string | null;
}>(entries: T[]): Array<T & { sourceRef: string; variantLabel: string }>;
