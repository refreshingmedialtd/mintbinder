import type { PriceConfidence, PricePoint } from "../types";

export type PriceMarket = "UK" | "Europe" | "US" | "Other";
export type PriceFreshness = "Current" | "Stale";

const DAY_MS = 24 * 60 * 60 * 1000;

export function priceMarketForSource(source?: string | null): PriceMarket {
  const normalized = String(source ?? "").trim().toLowerCase();

  if (
    normalized.startsWith("pulse-uk") ||
    normalized.startsWith("uk-market") ||
    normalized.startsWith("ebay-uk")
  ) {
    return "UK";
  }

  if (normalized.includes("cardmarket") || normalized.includes("cardtrader")) {
    return "Europe";
  }

  if (
    normalized === "pokemon-tcg-api" ||
    normalized.startsWith("tcgcsv") ||
    normalized.startsWith("pricecharting")
  ) {
    return "US";
  }

  return "Other";
}

export function priceMarketRole(source?: string | null) {
  const market = priceMarketForSource(source);

  if (market === "UK") {
    return "UK market price";
  }

  if (market === "Europe") {
    return "European market estimate";
  }

  if (market === "US") {
    return "US market reference";
  }

  return "Market estimate";
}

export function priceSourceLabel(source?: string | null) {
  const normalized = String(source ?? "").trim().toLowerCase();

  if (!normalized) {
    return "Unknown";
  }

  if (normalized === "pokemon-tcg-api") {
    return "TCGplayer US market (GBP converted)";
  }

  if (normalized === "pokemon-tcg-api-cardmarket") {
    return "Cardmarket European trend (GBP converted)";
  }

  if (normalized === "tcgcsv-card") {
    return "TCGplayer US market via TCGCSV (GBP converted)";
  }

  if (normalized === "tcgcsv-japan-card") {
    return "TCGplayer Japanese-card market via TCGCSV (GBP converted)";
  }

  if (normalized === "tcgcsv") {
    return "TCGplayer US market via TCGCSV (GBP converted)";
  }

  if (normalized === "tcgcsv-sealed") {
    return "TCGplayer US sealed market via TCGCSV (GBP converted)";
  }

  if (normalized === "pricecharting-sealed") {
    return "PriceCharting US sealed market (GBP converted)";
  }

  if (normalized === "cardtrader-sealed") {
    return "CardTrader European sealed marketplace (GBP converted)";
  }

  if (normalized === "pulse-uk") {
    return "PulseTCG UK market";
  }

  if (normalized === "uk-market-import") {
    return "Reviewed UK market data";
  }

  return startCase(normalized);
}

export function priceFreshnessStatus(
  point?: Pick<PricePoint, "observedAt" | "valueMinor"> | null,
  now = new Date(),
): PriceFreshness {
  if (!point) {
    return "Stale";
  }

  const observedAt = Date.parse(point.observedAt);

  if (!Number.isFinite(observedAt)) {
    return "Stale";
  }

  const maxAgeDays = point.valueMinor >= 10_000 ? 7 : 14;

  return now.getTime() - observedAt <= maxAgeDays * DAY_MS ? "Current" : "Stale";
}

export function effectivePriceConfidence(
  point?: Pick<PricePoint, "confidence" | "observedAt" | "source" | "valueMinor"> | null,
  now = new Date(),
): PriceConfidence {
  if (!point || priceFreshnessStatus(point, now) === "Stale") {
    return "Weak";
  }

  const market = priceMarketForSource(point.source);

  if (market === "US") {
    return "Weak";
  }

  if (market === "Europe" && point.confidence === "Strong") {
    return "Fair";
  }

  return point.confidence;
}

export function preferredLatestPricePoint(
  history: PricePoint[],
  now = new Date(),
) {
  return [...history].sort((left, right) => comparePricePoints(left, right, now)).at(-1);
}

export function preferredPriceSeries(history: PricePoint[], now = new Date()) {
  const preferred = preferredLatestPricePoint(history, now);

  if (!preferred) {
    return [];
  }

  const family = priceSourceFamily(preferred.source);

  return history.filter((point) => priceSourceFamily(point.source) === family);
}

function comparePricePoints(left: PricePoint, right: PricePoint, now: Date) {
  const leftCurrent = priceFreshnessStatus(left, now) === "Current";
  const rightCurrent = priceFreshnessStatus(right, now) === "Current";

  if (leftCurrent !== rightCurrent) {
    return leftCurrent ? 1 : -1;
  }

  if (leftCurrent && rightCurrent) {
    const marketDifference = marketRank(priceMarketForSource(left.source)) -
      marketRank(priceMarketForSource(right.source));

    if (marketDifference !== 0) {
      return marketDifference;
    }
  }

  const observedDifference = Date.parse(left.observedAt) - Date.parse(right.observedAt);

  if (observedDifference !== 0) {
    return observedDifference;
  }

  return confidenceRank(left.confidence) - confidenceRank(right.confidence);
}

function priceSourceFamily(source?: string | null) {
  const normalized = String(source ?? "").trim().toLowerCase();

  if (normalized === "pokemon-tcg-api" || normalized === "tcgcsv-card") {
    return "tcgplayer-us-card";
  }

  if (normalized.includes("cardmarket")) {
    return "cardmarket-europe";
  }

  if (priceMarketForSource(normalized) === "UK") {
    return "uk-market";
  }

  return normalized || "unknown";
}

function marketRank(market: PriceMarket) {
  return {
    Other: 1,
    US: 2,
    Europe: 3,
    UK: 4,
  }[market];
}

function confidenceRank(confidence: PriceConfidence) {
  return {
    Weak: 1,
    Fair: 2,
    Strong: 3,
  }[confidence];
}

function startCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}
