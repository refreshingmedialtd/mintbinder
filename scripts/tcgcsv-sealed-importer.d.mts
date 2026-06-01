export type TcgcsvSealedImportOptions = {
  fetchImpl?: typeof fetch;
  groupIds?: string[] | string;
  groupLimit?: number;
  priceOnlyUnpriced?: boolean;
  prisma?: unknown;
  usdToGbpRate?: number;
  waitMs?: number;
  writePrices?: boolean;
};

export type TcgcsvSealedImportSummary = {
  groupsAvailable: number;
  groupsMatched: number;
  groupsProcessed: number;
  priceOnlyUnpriced: boolean;
  pricingSnapshotsCreated: number;
  productsFetched: number;
  sealedProductsSkipped: number;
  sealedProductsUpserted: number;
  writePrices: boolean;
};

export function sealedImportOptionsFromEnv(
  env?: Record<string, string | undefined>,
): TcgcsvSealedImportOptions;

export function syncTcgcsvSealedProducts(
  options?: TcgcsvSealedImportOptions,
): Promise<TcgcsvSealedImportSummary>;
