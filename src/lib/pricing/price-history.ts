import type { PricePoint } from "../types";

export type PriceHistoryInput = {
  priceMinor: number;
  confidenceScore?: number | null;
  source?: string | null;
  observedAt?: Date | string | null;
  variantLabel?: string | null;
};

export function buildPriceHistory(prices: PriceHistoryInput[]): PricePoint[] {
  const sorted = prices
    .map((price, index) => ({ index, point: normalizePricePoint(price) }))
    .filter((entry): entry is { index: number; point: PricePoint } => entry.point !== null)
    .sort((left, right) =>
      Date.parse(left.point.observedAt) - Date.parse(right.point.observedAt) ||
      right.index - left.index,
    )
    .map((entry) => entry.point);

  const latestBySeriesDay = new Map<string, PricePoint>();

  for (const point of sorted) {
    const day = point.observedAt.slice(0, 10);
    const key = `${point.source}\u0000${point.variantLabel ?? ""}\u0000${day}`;
    latestBySeriesDay.set(key, point);
  }

  return [...latestBySeriesDay.values()].sort(
    (left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt),
  );
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

  if (score >= 75) {
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

  const point: PricePoint = {
    observedAt,
    valueMinor: Math.round(valueMinor),
    confidence: priceConfidenceFromScore(price.confidenceScore),
    source: price.source?.trim() || "unknown",
  };

  const variantLabel = price.variantLabel?.trim();

  if (variantLabel) {
    point.variantLabel = variantLabel;
  }

  return point;
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
