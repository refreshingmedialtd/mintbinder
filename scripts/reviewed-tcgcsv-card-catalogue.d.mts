export type ReviewedTcgcsvCatalogueTarget = {
  categoryId: number;
  expectedGroupName: string;
  groupId: string;
  productIds: string[];
};

export type ReviewedTcgcsvCatalogueResult = {
  cardsUpdated: number;
  categoryId: number;
  expectedGroupName: string;
  groupId: string;
  priceSnapshotsCreated: number;
  priceSnapshotsUpdated: number;
  priceSnapshotsWritten: number;
  productsMatched: number;
  productsWithoutPrice: number;
  provider: "tcgcsv-reviewed-catalogue";
  setsUpserted: number;
  writePrices: boolean;
};

export type ReviewedTcgcsvCatalogueOptions = {
  categoryId: number | string;
  fetchImpl?: typeof fetch;
  groupId: number | string;
  observedAt?: Date | string;
  prisma?: unknown;
  retryAttempts?: number;
  retryWaitMs?: number;
  timeoutMs?: number;
  usdToGbpRate?: number;
  writePrices?: boolean;
};

export function reviewedTcgcsvCatalogueTargets(): ReviewedTcgcsvCatalogueTarget[];

export function reviewedTcgcsvGroup(
  categoryId: number | string,
  groupId: number | string,
): Record<string, unknown>;

export function validateReviewedTcgcsvProduct(
  product: unknown,
  specification: unknown,
): void;

export function syncReviewedTcgcsvCardCatalogue(
  options: ReviewedTcgcsvCatalogueOptions,
): Promise<ReviewedTcgcsvCatalogueResult>;
