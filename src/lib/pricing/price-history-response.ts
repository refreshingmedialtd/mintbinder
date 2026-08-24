export type PriceHistoryRow = {
  bucket: Date;
  condition: string | null;
  confidenceScore: number;
  currency: string;
  gradedCompany: string | null;
  gradedScore: unknown;
  language: string | null;
  observedAt: Date;
  pointCount: number;
  priceMinor: number;
  sampleSize: number | null;
  source: string;
  variantLabel: string | null;
};

export function isValidPriceHistorySource(value: string | null) {
  const source = value?.trim();

  return !source || /^[a-z0-9._-]{1,80}$/i.test(source);
}

export function serializePriceHistoryRows(rows: PriceHistoryRow[]) {
  return rows.map((row) => ({
    bucket: row.bucket.toISOString(),
    condition: row.condition,
    confidenceScore: row.confidenceScore,
    currency: row.currency,
    gradedCompany: row.gradedCompany,
    gradedScore: numericGrade(row.gradedScore),
    language: row.language,
    observedAt: row.observedAt.toISOString(),
    pointCount: row.pointCount,
    priceMinor: row.priceMinor,
    sampleSize: row.sampleSize,
    source: row.source,
    variantLabel: row.variantLabel,
  }));
}

export function priceHistoryTruncation(availablePointCount: number, returnedPointCount: number) {
  const available = Number.isSafeInteger(availablePointCount) && availablePointCount > 0
    ? availablePointCount
    : 0;

  return {
    availablePointCount: available,
    truncated: available > returnedPointCount,
  };
}

function numericGrade(value: unknown) {
  if (value === null || value === undefined) return null;

  const score = Number(value);

  return Number.isFinite(score) ? score : null;
}
