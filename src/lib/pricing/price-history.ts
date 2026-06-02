import type { PricePoint } from "../types";

export type PriceHistoryInput = {
  priceMinor: number;
  confidenceScore?: number | null;
  source?: string | null;
  observedAt?: Date | string | null;
};

export function buildPriceHistory(prices: PriceHistoryInput[]): PricePoint[] {
  return prices
    .map(normalizePricePoint)
    .filter((point): point is PricePoint => point !== null)
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
}

export function latestPricePoint(history: PricePoint[]) {
  return history[history.length - 1];
}

export function priceRangeMinor(history: PricePoint[]) {
  if (!history.length) {
    return null;
  }

  const values = history.map((point) => point.valueMinor);

  return {
    high: Math.max(...values),
    low: Math.min(...values),
  };
}

export function priceConfidenceFromScore(score?: number | null): PricePoint["confidence"] {
  if (!score) {
    return "Weak";
  }

  if (score >= 80) {
    return "Strong";
  }

  if (score >= 60) {
    return "Fair";
  }

  return "Weak";
}

function normalizePricePoint(price: PriceHistoryInput): PricePoint | null {
  const observedAt = normalizeObservedAt(price.observedAt);
  const valueMinor = Number(price.priceMinor);

  if (!observedAt || !Number.isFinite(valueMinor) || valueMinor < 0) {
    return null;
  }

  return {
    observedAt,
    valueMinor: Math.round(valueMinor),
    confidence: priceConfidenceFromScore(price.confidenceScore),
    source: price.source?.trim() || "unknown",
  };
}

function normalizeObservedAt(value?: Date | string | null) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}
