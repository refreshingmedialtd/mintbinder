import type { PricePoint } from "../types";

export type PriceHistorySeries = {
  key: string;
  label: string;
  points: PricePoint[];
};

/**
 * A chart line must represent one exact market identity. Joining observations
 * from different finishes or grades creates a price movement that never
 * happened, so every identity field deliberately participates in this key.
 */
export function priceHistoryIdentityKey(point: PricePoint) {
  return [
    normalized(point.source),
    normalized(point.currency),
    normalized(point.condition),
    normalized(point.language),
    normalized(point.variantLabel),
    normalized(point.gradedCompany),
    gradeKey(point.gradedScore),
  ].join("\u0000");
}

export function priceHistoryIdentityLabel(point: PricePoint) {
  const identity = [
    point.variantLabel?.trim() || "Unspecified finish",
    gradeLabel(point),
    point.condition?.trim(),
    point.language?.trim(),
    point.source?.trim(),
    point.currency?.trim(),
  ].filter((value): value is string => Boolean(value));

  return identity.join(" · ");
}

export function groupPriceHistorySeries(history: PricePoint[]): PriceHistorySeries[] {
  const grouped = new Map<string, PriceHistorySeries>();

  for (const point of history) {
    const key = priceHistoryIdentityKey(point);
    const series = grouped.get(key) ?? {
      key,
      label: priceHistoryIdentityLabel(point),
      points: [],
    };

    series.points.push(point);
    grouped.set(key, series);
  }

  return [...grouped.values()]
    .map((series) => ({
      ...series,
      points: [...series.points].sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt)),
    }))
    .sort(compareSeries);
}

export function preferredPriceHistorySeriesKey(history: PricePoint[], preferredVariant?: string | null) {
  const series = groupPriceHistorySeries(history);
  const normalizedVariant = normalized(preferredVariant);
  const candidates = normalizedVariant
    ? series.filter((candidate) => normalized(candidate.points.at(-1)?.variantLabel) === normalizedVariant)
    : series;
  const rawCandidates = candidates.filter((candidate) => !candidate.points.at(-1)?.gradedCompany);
  const pool = rawCandidates.length ? rawCandidates : candidates.length ? candidates : series;

  return [...pool].sort(compareSeries)[0]?.key;
}

function compareSeries(left: PriceHistorySeries, right: PriceHistorySeries) {
  const leftLatest = left.points.at(-1);
  const rightLatest = right.points.at(-1);
  const gradeDifference = Number(Boolean(leftLatest?.gradedCompany)) - Number(Boolean(rightLatest?.gradedCompany));
  if (gradeDifference) return gradeDifference;

  const recencyDifference = Date.parse(rightLatest?.observedAt ?? "") - Date.parse(leftLatest?.observedAt ?? "");
  if (Number.isFinite(recencyDifference) && recencyDifference) return recencyDifference;

  return left.label.localeCompare(right.label);
}

function gradeLabel(point: PricePoint) {
  if (!point.gradedCompany) return "Raw";
  const score = Number.isFinite(point.gradedScore) ? ` ${point.gradedScore}` : "";
  return `${point.gradedCompany.trim()}${score}`;
}

function gradeKey(value?: number) {
  return Number.isFinite(value) ? String(value) : "";
}

function normalized(value?: string | null) {
  return value?.trim().toLocaleLowerCase("en-GB") ?? "";
}
