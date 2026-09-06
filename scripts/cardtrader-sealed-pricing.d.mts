export type CardTraderSealedPricingOptions = {
  apiRetryAttempts?: number;
  apiRetryWaitMs?: number;
  apiTimeoutMs?: number;
  enabled?: boolean;
  eurToGbpRate?: number;
  fetchImpl?: typeof fetch;
  limit?: number;
  manualAliases?: string | Record<string, string> | Map<string, string> | Array<{
    blueprintId: string;
    localKey: string;
  }>;
  maxOfferPriceRatio?: number;
  maxReferencePriceRatio?: number;
  minOfferCount?: number;
  minReferenceDifferenceMinor?: number;
  now?: Date | number | string;
  priceOnlyUnpriced?: boolean;
  prisma?: unknown;
  productIds?: string[] | string;
  refreshEveryHours?: number;
  referenceMaxAgeDays?: number;
  setLimit?: number;
  token?: string;
  usdToGbpRate?: number;
  waitMs?: number;
  writePrices?: boolean;
};

export type CardTraderSealedPricingSummary = {
  ambiguousMatches: number;
  apiAttempts: number;
  apiRequests: number;
  blueprintsAvailable: number;
  blueprintsMatched: number;
  blueprintsWithIdentifiers: number;
  blueprintsWithTcgplayerId: number;
  candidatesAvailable: number;
  candidatesChecked: number;
  candidatesUnmatched: number;
  listingOffersUsed: number;
  mappingCoveragePercent: number;
  mappingMethods: Record<
    "identifier" | "manualAlias" | "normalizedNameType" | "normalizedTokenType" | "tcgplayerId",
    number
  >;
  mappingReview: Array<Record<string, unknown>>;
  marketplaceMatches: number;
  outcome:
    | "completed_without_snapshot"
    | "dry_run"
    | "no_blueprint_match"
    | "no_candidates"
    | "no_eligible_listing"
    | "pending"
    | "priced"
    | "quarantined";
  priceOnlyUnpriced: boolean;
  pricingObservationsAccepted: number;
  pricingObservationsQuarantined: number;
  pricingSnapshotsCreated: number;
  pricingSnapshotsUpdated: number;
  provider: "cardtrader-sealed";
  refreshEveryHours: number;
  sampleUnmatchedProducts: Array<Record<string, unknown>>;
  sampleQuarantinedPrices: Array<Record<string, unknown>>;
  selectionMode: "discovery" | "refresh" | "targeted";
  setsChecked: number;
  setsUnmatched: number;
  status: "degraded" | "succeeded";
  targetedProductCount: number;
  quarantineReasons: {
    extremeSpread: number;
    referenceDivergence: number;
    sparseListings: number;
  };
  writePrices: boolean;
};

export function cardTraderSealedOptionsFromEnv(
  env?: Record<string, string | undefined>,
): CardTraderSealedPricingOptions & { enabled: boolean };

export function syncCardTraderSealedPrices(
  options?: CardTraderSealedPricingOptions,
): Promise<CardTraderSealedPricingSummary>;

export function buildCardTraderBlueprintIndex(blueprints: Array<Record<string, unknown>>): unknown;
export function assessCardTraderMarketPrice(
  marketPrice: Record<string, unknown>,
  options?: {
    maxOfferPriceRatio?: number;
    maxReferencePriceRatio?: number;
    minOfferCount?: number;
    minReferenceDifferenceMinor?: number;
    referencePrice?: Record<string, unknown>;
  },
): Record<string, unknown>;
export function normalizeCardTraderProductIds(value: unknown): string[];
export function normalizeManualAliases(value: unknown): Map<string, string>;
export function selectCardTraderCandidates(
  candidates: Array<Record<string, unknown>>,
  options?: {
    limit?: number;
    now?: Date | number | string;
    refreshEveryHours?: number;
    setLimit?: number;
    targeted?: boolean;
  },
): {
  candidates: Array<Record<string, unknown>>;
  mode: "discovery" | "refresh" | "targeted";
};
export function resolveCardTraderBlueprint(
  product: Record<string, unknown>,
  blueprintIndex: unknown,
  aliases?: Map<string, string>,
): Record<string, unknown>;
