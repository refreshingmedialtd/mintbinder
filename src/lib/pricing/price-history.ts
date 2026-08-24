import type { PricePoint } from "../types";

export type PriceHistoryInput = {
  priceMinor: number;
  confidenceScore?: number | null;
  source?: string | null;
  observedAt?: Date | string | null;
  variantLabel?: string | null;
  gradedCompany?: string | null;
  gradedScore?: number | string | { toString(): string } | null;
};

export function priceInputsForGrade(
  prices: PriceHistoryInput[],
  gradedCompany?: string | null,
  gradedScore?: number | string | { toString(): string } | null,
) {
  const company = normalizeGradeCompany(gradedCompany);

  if (!company) {
    return prices.filter((price) => !normalizeGradeCompany(price.gradedCompany));
  }

  const score = normalizeGradeScore(gradedScore);

  if (score === undefined) {
    return [];
  }

  return prices.filter((price) =>
    normalizeGradeCompany(price.gradedCompany) === company &&
    normalizeGradeScore(price.gradedScore) === score,
  );
}

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
    const key = `${point.source}\u0000${point.variantLabel ?? ""}\u0000${point.gradedCompany ?? ""}\u0000${point.gradedScore ?? ""}\u0000${day}`;
    latestBySeriesDay.set(key, point);
  }

  return suppressTransientPriceOutliers([...latestBySeriesDay.values()]).sort(
    (left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt),
  );
}

export function suppressTransientPriceOutliers(history: PricePoint[]): PricePoint[] {
  const bySeries = new Map<string, PricePoint[]>();

  for (const point of history) {
    const key = `${point.source}\u0000${point.variantLabel ?? ""}\u0000${point.gradedCompany ?? ""}\u0000${point.gradedScore ?? ""}`;
    const series = bySeries.get(key) ?? [];

    series.push(point);
    bySeries.set(key, series);
  }

  const kept: PricePoint[] = [];

  for (const series of bySeries.values()) {
    const sorted = [...series].sort(
      (left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt),
    );

    for (let index = 0; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const point = sorted[index];
      const next = sorted[index + 1];

      if (previous && next && isTransientPriceOutlier(previous.valueMinor, point.valueMinor, next.valueMinor)) {
        continue;
      }

      kept.push(point);
    }
  }

  return kept;
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

  const gradedCompany = normalizeGradeCompany(price.gradedCompany);
  const gradedScore = normalizeGradeScore(price.gradedScore);

  if (gradedCompany && gradedScore !== undefined) {
    point.gradedCompany = gradedCompany;
    point.gradedScore = gradedScore;
  }

  return point;
}

function normalizeGradeCompany(value?: string | null) {
  const normalized = String(value ?? "").trim().toUpperCase();

  return normalized || undefined;
}

function normalizeGradeScore(value?: number | string | { toString(): string } | null) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const score = Number(value);

  return Number.isFinite(score) ? score : undefined;
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

function isTransientPriceOutlier(previous: number, current: number, next: number) {
  const neighborRatio = priceRatio(previous, next);
  const previousRatio = priceRatio(previous, current);
  const nextRatio = priceRatio(next, current);
  const minimumAbsoluteMove = Math.min(Math.abs(current - previous), Math.abs(current - next));

  return neighborRatio <= 2
    && previousRatio >= 10
    && nextRatio >= 10
    && minimumAbsoluteMove >= 2_000;
}

function priceRatio(left: number, right: number) {
  const low = Math.min(left, right);
  const high = Math.max(left, right);

  if (low <= 0) {
    return high > 0 ? Number.POSITIVE_INFINITY : 1;
  }

  return high / low;
}
