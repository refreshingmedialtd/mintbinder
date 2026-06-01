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

export function bestPokemonTcgCardPrice(card: PokemonTcgCardPriceInput, rates: PokemonPricingRates) {
  return bestTcgPlayerPrice(card, rates.usdToGbp) ?? bestCardmarketPrice(card, rates.eurToGbp);
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
    { confidenceScore: 66, key: "trendPrice", label: "Cardmarket trend" },
    { confidenceScore: 64, key: "averageSellPrice", label: "Cardmarket average sale" },
    { confidenceScore: 62, key: "avg30", label: "Cardmarket 30 day average" },
    { confidenceScore: 60, key: "avg7", label: "Cardmarket 7 day average" },
    { confidenceScore: 56, key: "lowPriceExPlus", label: "Cardmarket EX+ low" },
    { confidenceScore: 52, key: "lowPrice", label: "Cardmarket low" },
    { confidenceScore: 60, key: "reverseHoloTrend", label: "Cardmarket reverse holo trend" },
    { confidenceScore: 58, key: "reverseHoloSell", label: "Cardmarket reverse holo average sale" },
    { confidenceScore: 54, key: "reverseHoloLow", label: "Cardmarket reverse holo low" },
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
        variantLabel: option.label,
      };
    }
  }

  return null;
}

function labelFromCamelCase(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());
}
