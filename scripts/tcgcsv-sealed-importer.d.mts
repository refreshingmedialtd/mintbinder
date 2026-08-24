export type TcgcsvSealedImportOptions = {
  fetchImpl?: typeof fetch;
  groupIds?: string[] | string;
  groupLimit?: number;
  priceOnlyUnpriced?: boolean;
  productLimit?: number;
  prisma?: unknown;
  usdToGbpRate?: number;
  waitMs?: number;
  writePrices?: boolean;
};

export type TcgcsvSealedImportSummary = {
  failedGroups: number;
  groupResults: Array<Record<string, unknown>>;
  groupsAvailable: number;
  groupsDeferredKnownEmpty: number;
  groupsMatched: number;
  groupsProcessed: number;
  priceOnlyUnpriced: boolean;
  productLimit: number | null;
  productsProcessed: number;
  pricingSnapshotsCreated: number;
  pricingSnapshotsUpdated: number;
  productsFetched: number;
  sealedProductsSkipped: number;
  sealedProductsUpserted: number;
  warning: string | null;
  writePrices: boolean;
};

export function sealedImportOptionsFromEnv(
  env?: Record<string, string | undefined>,
): TcgcsvSealedImportOptions;

export function syncTcgcsvSealedProducts(
  options?: TcgcsvSealedImportOptions,
): Promise<TcgcsvSealedImportSummary>;
