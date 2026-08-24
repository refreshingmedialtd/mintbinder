export type CardTraderSealedPricingOptions = {
  enabled?: boolean;
  eurToGbpRate?: number;
  fetchImpl?: typeof fetch;
  limit?: number;
  priceOnlyUnpriced?: boolean;
  prisma?: unknown;
  setLimit?: number;
  token?: string;
  usdToGbpRate?: number;
  waitMs?: number;
  writePrices?: boolean;
};

export type CardTraderSealedPricingSummary = {
  apiRequests: number;
  blueprintsMatched: number;
  candidatesAvailable: number;
  candidatesChecked: number;
  candidatesUnmatched: number;
  listingOffersUsed: number;
  priceOnlyUnpriced: boolean;
  pricingSnapshotsCreated: number;
  pricingSnapshotsUpdated: number;
  provider: "cardtrader-sealed";
  sampleUnmatchedProducts: Array<Record<string, unknown>>;
  setsChecked: number;
  setsUnmatched: number;
  status: "succeeded";
  writePrices: boolean;
};

export function cardTraderSealedOptionsFromEnv(
  env?: Record<string, string | undefined>,
): CardTraderSealedPricingOptions & { enabled: boolean };

export function syncCardTraderSealedPrices(
  options?: CardTraderSealedPricingOptions,
): Promise<CardTraderSealedPricingSummary>;
