export type PokemonCardmarketPrices = Record<string, number | null | undefined>;

export type PokemonTcgCardPriceInput = {
  cardmarket?: {
    prices?: PokemonCardmarketPrices;
    updatedAt?: string;
  };
  tcgplayer?: {
    prices?: Record<string, {
      low?: number | null;
      market?: number | null;
      mid?: number | null;
    }>;
    updatedAt?: string;
  };
};

export type PokemonPricingRates = {
  eurToGbp?: number;
  metadata?: Partial<Record<"EUR" | "USD", {
    observedAt: string;
    provider: string;
    sourceDate?: string;
  }>>;
  usdToGbp: number;
};

export type PokemonCardPrice = {
  confidenceScore: number;
  conversionRate: number;
  originalCurrency: "EUR" | "USD";
  originalPrice: number;
  providerUpdatedAt?: string;
  source: string;
  sourceLabel: string;
  variantLabel: string;
};

const EARLIEST_TRUSTWORTHY_PROVIDER_UPDATE = Date.UTC(2000, 0, 1);

/**
 * Converts the Pokemon TCG API's provider update field into the evidence time
 * used by price selection and freshness checks. The API commonly returns a
 * date as YYYY/MM/DD, so parse that format explicitly instead of relying on
 * implementation-dependent Date parsing.
 *
 * Missing, malformed, implausibly old, or future provider dates fall back to
 * the time we actually observed the response. This keeps persisted evidence
 * valid without allowing an untrustworthy provider value to masquerade as a
 * real timestamp.
 */
export function pokemonProviderObservedAt(
  providerUpdatedAt: string | null | undefined,
  importedAt = new Date(),
) {
  const fallback = validDate(importedAt) ?? new Date();
  const providerDate = parseProviderUpdatedAt(providerUpdatedAt);

  if (
    !providerDate ||
    providerDate.getTime() < EARLIEST_TRUSTWORTHY_PROVIDER_UPDATE ||
    providerDate.getTime() > fallback.getTime()
  ) {
    return new Date(fallback);
  }

  return providerDate;
}

/** Returns a corrected historical timestamp only when a legacy snapshot can
 * be moved safely backwards to a valid provider update date. */
export function correctedPokemonProviderObservedAt({
  createdAt,
  metadata,
  observedAt,
}: {
  createdAt: Date;
  metadata: unknown;
  observedAt: Date;
}) {
  const providerUpdatedAt = jsonString(metadata, "providerUpdatedAt");

  if (!providerUpdatedAt) {
    return null;
  }

  const corrected = parseProviderUpdatedAt(providerUpdatedAt);

  if (
    !corrected ||
    corrected.getTime() < EARLIEST_TRUSTWORTHY_PROVIDER_UPDATE ||
    corrected.getTime() > createdAt.getTime()
  ) {
    return null;
  }

  return corrected.getTime() < observedAt.getTime() ? corrected : null;
}

export function bestPokemonTcgCardPrice(card: PokemonTcgCardPriceInput, rates: PokemonPricingRates) {
  return bestCardmarketPrice(card, rates.eurToGbp) ?? bestTcgPlayerPrice(card, rates.usdToGbp);
}

function bestTcgPlayerPrice(card: PokemonTcgCardPriceInput, usdToGbp: number): PokemonCardPrice | null {
  const prices = card.tcgplayer?.prices;

  if (!prices) {
    return null;
  }

  const variantOrder = [
    "holofoil",
    "reverseHolofoil",
    "normal",
    "1stEditionHolofoil",
    "unlimitedHolofoil",
  ];

  for (const variant of variantOrder) {
    const price = prices[variant];
    const usd = price?.market ?? price?.mid ?? price?.low ?? null;

    if (usd && usd > 0) {
      return {
        confidenceScore: price.market ? 78 : price.mid ? 68 : 58,
        conversionRate: usdToGbp,
        originalCurrency: "USD",
        originalPrice: usd,
        providerUpdatedAt: card.tcgplayer?.updatedAt,
        source: "pokemon-tcg-api",
        sourceLabel: "TCGPlayer",
        variantLabel: labelFromCamelCase(variant),
      };
    }
  }

  return null;
}

function bestCardmarketPrice(card: PokemonTcgCardPriceInput, eurToGbp?: number): PokemonCardPrice | null {
  if (!eurToGbp) {
    return null;
  }

  const prices = card.cardmarket?.prices;

  if (!prices) {
    return null;
  }

  const priceOrder = [
    { confidenceScore: 68, key: "trendPrice", label: "Cardmarket trend" },
    { confidenceScore: 66, key: "averageSellPrice", label: "Cardmarket average sale" },
    { confidenceScore: 64, key: "avg30", label: "Cardmarket 30 day average" },
    { confidenceScore: 62, key: "avg7", label: "Cardmarket 7 day average" },
    { confidenceScore: 58, key: "lowPriceExPlus", label: "Cardmarket EX+ low" },
    { confidenceScore: 54, key: "lowPrice", label: "Cardmarket low" },
    { confidenceScore: 62, key: "reverseHoloTrend", label: "Cardmarket reverse holo trend", variantLabel: "Reverse Holofoil" },
    { confidenceScore: 60, key: "reverseHoloSell", label: "Cardmarket reverse holo average sale", variantLabel: "Reverse Holofoil" },
    { confidenceScore: 56, key: "reverseHoloLow", label: "Cardmarket reverse holo low", variantLabel: "Reverse Holofoil" },
  ];

  for (const option of priceOrder) {
    const eur = prices[option.key];

    if (eur && eur > 0) {
      return {
        confidenceScore: option.confidenceScore,
        conversionRate: eurToGbp,
        originalCurrency: "EUR",
        originalPrice: eur,
        providerUpdatedAt: card.cardmarket?.updatedAt,
        source: "pokemon-tcg-api-cardmarket",
        sourceLabel: option.label,
        variantLabel: option.variantLabel ?? primaryVariantLabel(card),
      };
    }
  }

  return null;
}

function primaryVariantLabel(card: PokemonTcgCardPriceInput) {
  const prices = card.tcgplayer?.prices ?? {};
  const preferred = [
    "holofoil",
    "normal",
    "1stEditionHolofoil",
    "unlimitedHolofoil",
  ].find((variant) => prices[variant]);

  return preferred ? labelFromCamelCase(preferred) : "Standard";
}

function labelFromCamelCase(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());
}

function parseProviderUpdatedAt(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return null;
  }

  const dateOnly = normalized.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);

  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));

    return parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
      ? parsed
      : null;
  }

  // Require an explicit timezone for timestamps so server locale cannot alter
  // the instant that is persisted.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) {
    return null;
  }

  return validDate(new Date(normalized));
}

function validDate(value: Date) {
  return Number.isFinite(value.getTime()) ? value : null;
}

function jsonString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entry = (value as Record<string, unknown>)[key];

  return typeof entry === "string" && entry.trim() ? entry.trim() : undefined;
}
