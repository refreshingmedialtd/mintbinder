export class ExchangeRateConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExchangeRateConfigError";
  }
}

export type CurrencyCode = "EUR" | "USD";

export type ExchangeRateMetadata = {
  observedAt: string;
  provider: "env" | "frankfurter";
  sourceDate?: string;
};

export type ResolvedGbpRate = {
  metadata: ExchangeRateMetadata;
  rate: number;
};

export type ResolvedPokemonPricingRates = {
  eurToGbp?: number;
  metadata: Partial<Record<CurrencyCode, ExchangeRateMetadata>>;
  usdToGbp: number;
};

type ResolveExchangeRatesOptions = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

const defaultExchangeRateEndpoint = "https://api.frankfurter.app/latest";

export async function resolvePokemonPricingRates({
  env = process.env,
  fetchImpl = fetch,
}: ResolveExchangeRatesOptions = {}): Promise<ResolvedPokemonPricingRates> {
  const rates = await resolveGbpRates({
    env,
    fallbackEnvKeys: {
      EUR: "POKEMON_TCG_EUR_TO_GBP_RATE",
      USD: "POKEMON_TCG_USD_TO_GBP_RATE",
    },
    fetchImpl,
    optionalCurrencies: ["EUR"],
    requiredCurrencies: ["USD"],
  });
  const usd = rates.USD;

  if (!usd) {
    throw new ExchangeRateConfigError("Unable to resolve USD to GBP exchange rate.");
  }

  return {
    eurToGbp: rates.EUR?.rate,
    metadata: {
      EUR: rates.EUR?.metadata,
      USD: usd.metadata,
    },
    usdToGbp: usd.rate,
  };
}

export async function resolveGbpRates({
  env = process.env,
  fallbackEnvKeys,
  fetchImpl = fetch,
  optionalCurrencies = [],
  requiredCurrencies,
}: ResolveExchangeRatesOptions & {
  fallbackEnvKeys: Record<CurrencyCode, string>;
  optionalCurrencies?: CurrencyCode[];
  requiredCurrencies: CurrencyCode[];
}): Promise<Record<CurrencyCode, ResolvedGbpRate | undefined>> {
  const currencies = [...new Set([...requiredCurrencies, ...optionalCurrencies])];
  const manualOnly =
    setting(env.EXCHANGE_RATES_PROVIDER).toLowerCase() === "manual" ||
    optionalBoolean(env.EXCHANGE_RATES_AUTO) === false;
  const allowEnvFallback = optionalBoolean(env.EXCHANGE_RATES_ALLOW_ENV_FALLBACK) ?? true;
  const observedAt = new Date().toISOString();
  const manualRates = manualGbpRates({ env, fallbackEnvKeys, observedAt });

  if (manualOnly) {
    assertRequiredRates({ rates: manualRates, requiredCurrencies });

    return manualRates;
  }

  try {
    const liveRates = await frankfurterGbpRates({ currencies, env, fetchImpl, observedAt });
    const mergedRates = { ...manualRates, ...liveRates };

    assertRequiredRates({ rates: mergedRates, requiredCurrencies });

    return mergedRates;
  } catch (error) {
    if (allowEnvFallback) {
      assertRequiredRates({
        extraMessage: error instanceof Error ? ` Live exchange lookup failed: ${error.message}` : "",
        rates: manualRates,
        requiredCurrencies,
      });

      return manualRates;
    }

    throw error;
  }
}

async function frankfurterGbpRates({
  currencies,
  env,
  fetchImpl,
  observedAt,
}: {
  currencies: CurrencyCode[];
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  observedAt: string;
}) {
  const endpoint = setting(env.EXCHANGE_RATES_API_URL) || defaultExchangeRateEndpoint;
  const url = new URL(endpoint);

  url.searchParams.set("from", "GBP");
  url.searchParams.set("to", currencies.join(","));

  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
    },
  });
  const data = (await response.json().catch(() => ({}))) as {
    date?: unknown;
    rates?: Record<string, unknown>;
  };

  if (!response.ok) {
    throw new ExchangeRateConfigError(`Exchange rate request failed with HTTP ${response.status}.`);
  }

  const result: Record<CurrencyCode, ResolvedGbpRate | undefined> = {
    EUR: undefined,
    USD: undefined,
  };

  for (const currency of currencies) {
    const gbpToCurrency = Number(data.rates?.[currency]);

    if (Number.isFinite(gbpToCurrency) && gbpToCurrency > 0) {
      result[currency] = {
        metadata: {
          observedAt,
          provider: "frankfurter",
          sourceDate: typeof data.date === "string" ? data.date : undefined,
        },
        rate: roundRate(1 / gbpToCurrency),
      };
    }
  }

  return result;
}

function manualGbpRates({
  env,
  fallbackEnvKeys,
  observedAt,
}: {
  env: Record<string, string | undefined>;
  fallbackEnvKeys: Record<CurrencyCode, string>;
  observedAt: string;
}) {
  const result: Record<CurrencyCode, ResolvedGbpRate | undefined> = {
    EUR: undefined,
    USD: undefined,
  };

  for (const currency of Object.keys(fallbackEnvKeys) as CurrencyCode[]) {
    const rate = optionalRate(env[fallbackEnvKeys[currency]]);

    if (rate) {
      result[currency] = {
        metadata: {
          observedAt,
          provider: "env",
        },
        rate,
      };
    }
  }

  return result;
}

function assertRequiredRates({
  extraMessage = "",
  rates,
  requiredCurrencies,
}: {
  extraMessage?: string;
  rates: Record<CurrencyCode, ResolvedGbpRate | undefined>;
  requiredCurrencies: CurrencyCode[];
}) {
  const missing = requiredCurrencies.filter((currency) => !rates[currency]?.rate);

  if (missing.length) {
    throw new ExchangeRateConfigError(
      `Unable to resolve ${missing.join(", ")} to GBP exchange rate.${extraMessage} Configure automatic exchange rates or set a fallback conversion rate in .env.`,
    );
  }
}

function optionalRate(value: unknown) {
  const rate = Number(value);

  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
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

function setting(value: unknown) {
  return String(value ?? "").trim();
}

function roundRate(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
