export type PricingRunForScheduling = {
  jobType?: unknown;
  requestPayload?: unknown;
  resultPayload?: unknown;
  status?: unknown;
};

export type ScheduledPricingBody = {
  maxPages?: unknown;
  page?: unknown;
  pageSize?: unknown;
  priceOnlyUnpriced?: unknown;
  q?: unknown;
};

export type ScheduledPricingInput = {
  maxPages: number;
  page: number;
  pageSize: number;
  priceOnlyUnpriced: boolean;
  q?: string;
};

const defaultMaxPages = 2;
const defaultPageSize = 250;

export function scheduledPricingInputFromSources({
  body = {},
  env = process.env,
  recentRuns = [],
}: {
  body?: ScheduledPricingBody;
  env?: Record<string, string | undefined>;
  recentRuns?: PricingRunForScheduling[];
} = {}): ScheduledPricingInput {
  const query = optionalString(body.q) ?? optionalString(env.POKEMON_TCG_PRICING_QUERY) ?? "";
  const explicitPage = explicitPricingPage(body.page, env.POKEMON_TCG_PRICING_PAGE);
  const input: ScheduledPricingInput = {
    maxPages: positiveInteger(body.maxPages ?? env.POKEMON_TCG_PRICING_MAX_PAGES, defaultMaxPages, 20),
    page: explicitPage ?? nextScheduledPricingPage(recentRuns, query),
    pageSize: positiveInteger(body.pageSize ?? env.POKEMON_TCG_PRICING_PAGE_SIZE, defaultPageSize, 250),
    priceOnlyUnpriced:
      optionalBoolean(body.priceOnlyUnpriced) ??
      optionalBoolean(env.POKEMON_TCG_PRICE_ONLY_UNPRICED) ??
      false,
  };

  if (query) {
    input.q = query;
  }

  return input;
}

export function nextScheduledPricingPage(runs: PricingRunForScheduling[], query = "") {
  const matchingRun = runs.find((run) => {
    if (String(run.status ?? "").toLowerCase() !== "succeeded") {
      return false;
    }

    const jobType = String(run.jobType ?? "pricing_refresh").toLowerCase();

    return jobType === "pricing_refresh" && runQuery(run) === query;
  });

  if (!matchingRun) {
    return 1;
  }

  const result = asRecord(matchingRun.resultPayload);

  if (result.complete === true) {
    return 1;
  }

  const nextPage = optionalPositiveInteger(result.nextPage);

  if (nextPage) {
    return nextPage;
  }

  const request = asRecord(matchingRun.requestPayload);
  const page = optionalPositiveInteger(result.page) ?? optionalPositiveInteger(request.page);
  const pagesProcessed =
    optionalPositiveInteger(result.pagesProcessed) ??
    optionalPositiveInteger(result.maxPages) ??
    optionalPositiveInteger(request.maxPages);

  if (page && pagesProcessed) {
    return page + pagesProcessed;
  }

  return 1;
}

function explicitPricingPage(bodyPage: unknown, envPage: string | undefined) {
  const bodyValue = optionalPositiveInteger(bodyPage);

  if (bodyValue) {
    return bodyValue;
  }

  if (!envPage || envPage.trim().toLowerCase() === "auto") {
    return undefined;
  }

  return optionalPositiveInteger(envPage);
}

function runQuery(run: PricingRunForScheduling) {
  const result = asRecord(run.resultPayload);
  const request = asRecord(run.requestPayload);

  return optionalString(result.query) ?? optionalString(request.q) ?? "";
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

function optionalString(value: unknown) {
  const normalized = String(value ?? "").trim();

  return normalized || undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
