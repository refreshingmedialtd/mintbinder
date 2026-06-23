export type ScheduledSetPricingBody = {
  limit?: unknown;
  maxPagesPerSet?: unknown;
  pageSize?: unknown;
  priceOnlyUnpriced?: unknown;
  setLimit?: unknown;
  waitMs?: unknown;
};

export type ScheduledSetPricingInput = {
  limit: number;
  maxPagesPerSet: number;
  pageSize: number;
  priceOnlyUnpriced: boolean;
  waitMs: number;
};

const defaultLimit = 8;
const defaultPageSize = 250;
const defaultMaxPagesPerSet = 4;
const defaultWaitMs = 0;

export function scheduledSetPricingInputFromSources({
  body = {},
  env = process.env,
}: {
  body?: ScheduledSetPricingBody;
  env?: Record<string, string | undefined>;
} = {}): ScheduledSetPricingInput {
  return {
    limit: positiveInteger(
      body.setLimit ?? body.limit ?? env.POKEMON_TCG_SET_PRICING_LIMIT,
      defaultLimit,
      50,
    ),
    maxPagesPerSet: positiveInteger(
      body.maxPagesPerSet ?? env.POKEMON_TCG_SET_PRICING_MAX_PAGES_PER_SET,
      defaultMaxPagesPerSet,
      20,
    ),
    pageSize: positiveInteger(
      body.pageSize ?? env.POKEMON_TCG_SET_PRICING_PAGE_SIZE ?? env.POKEMON_TCG_PRICING_PAGE_SIZE,
      defaultPageSize,
      250,
    ),
    priceOnlyUnpriced:
      optionalBoolean(body.priceOnlyUnpriced) ??
      optionalBoolean(env.POKEMON_TCG_SET_PRICING_PRICE_ONLY_UNPRICED) ??
      optionalBoolean(env.POKEMON_TCG_PRICE_ONLY_UNPRICED) ??
      false,
    waitMs: nonNegativeInteger(
      body.waitMs ?? env.POKEMON_TCG_SET_PRICING_WAIT_MS,
      defaultWaitMs,
      60_000,
    ),
  };
}

function positiveInteger(value: unknown, fallback: number, max = Number.POSITIVE_INFINITY) {
  return optionalPositiveInteger(value, max) ?? fallback;
}

function optionalPositiveInteger(value: unknown, max = Number.POSITIVE_INFINITY) {
  const normalized = typeof value === "string" && value.trim() === "" ? NaN : Number(value);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return undefined;
  }

  return Math.min(max, Math.max(1, Math.floor(normalized)));
}

function nonNegativeInteger(value: unknown, fallback: number, max = Number.POSITIVE_INFINITY) {
  const normalized = typeof value === "string" && value.trim() === "" ? NaN : Number(value);

  if (!Number.isFinite(normalized) || normalized < 0) {
    return fallback;
  }

  return Math.min(max, Math.floor(normalized));
}

function optionalBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}
