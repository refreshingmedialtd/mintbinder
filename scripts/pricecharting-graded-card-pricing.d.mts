export type PriceChartingGradedAliases = Record<string, string>;

export type PriceChartingGradedOptions = {
  aliases?: PriceChartingGradedAliases;
  enabled?: boolean;
  fetchImpl?: typeof fetch;
  limit?: number;
  observedAt?: Date | string;
  priceOnlyUnpriced?: boolean;
  prisma?: import("@prisma/client").PrismaClient;
  retryAttempts?: number;
  retryWaitMs?: number;
  timeoutMs?: number;
  token?: string;
  usdToGbpRate?: number;
  waitMs?: number;
  writePrices?: boolean;
};

export const explicitCompanyGradeFields: Readonly<Record<string, {
  field: string;
  label: string;
  score: number;
}>>;
export const ambiguousCompanyGradeFields: readonly string[];
export const qualifiedGradeFields: Readonly<Record<string, string>>;

export function priceChartingGradedOptionsFromEnv(env?: NodeJS.ProcessEnv): PriceChartingGradedOptions;
export function syncPriceChartingGradedCardPrices(options?: PriceChartingGradedOptions): Promise<Record<string, unknown>>;
export function inspectPriceChartingGradeFields(response: Record<string, unknown>): {
  ambiguousFields: string[];
  explicitPrices: Map<string, number>;
  qualifiedFields: string[];
};
export function parsePriceChartingAliases(value: unknown): PriceChartingGradedAliases;
export function validatePriceChartingCardIdentity(
  card: Record<string, unknown>,
  response: Record<string, unknown>,
  options?: { allowVariantOverride?: boolean; variantLabel?: string },
): { ok: boolean; reason?: string };
export function findPriceChartingGradedMatches(options: {
  aliases?: PriceChartingGradedAliases;
  card: Record<string, unknown>;
  request: (endpoint: "product" | "products", params: Record<string, string>) => Promise<Record<string, unknown>>;
  variants: string[];
}): Promise<Map<string, { matchType?: string; reason?: string; response?: Record<string, unknown> }>>;
