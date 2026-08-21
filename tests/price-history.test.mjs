import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPriceHistory,
  latestPricePoint,
  priceConfidenceFromScore,
  priceRangeMinor,
  suppressTransientPriceOutliers,
} from "../src/lib/pricing/price-history.ts";

test("builds sorted price history with normalized confidence and sources", () => {
  const history = buildPriceHistory([
    {
      priceMinor: 1250,
      confidenceScore: 82,
      source: "pokemon-tcg-api",
      observedAt: "2026-05-02T10:00:00.000Z",
    },
    {
      priceMinor: 990.4,
      confidenceScore: 64,
      source: "",
      observedAt: new Date("2026-04-01T10:00:00.000Z"),
    },
    {
      priceMinor: 1100,
      confidenceScore: 12,
      source: "tcgcsv",
      observedAt: "not-a-date",
    },
  ]);

  assert.deepEqual(history, [
    {
      observedAt: "2026-04-01T10:00:00.000Z",
      valueMinor: 990,
      confidence: "Fair",
      source: "unknown",
    },
    {
      observedAt: "2026-05-02T10:00:00.000Z",
      valueMinor: 1250,
      confidence: "Strong",
      source: "pokemon-tcg-api",
    },
  ]);
  assert.deepEqual(latestPricePoint(history), history[1]);
  assert.deepEqual(priceRangeMinor(history), { high: 1250, low: 990 });
});

test("maps confidence score thresholds", () => {
  assert.equal(priceConfidenceFromScore(75), "Strong");
  assert.equal(priceConfidenceFromScore(74), "Fair");
  assert.equal(priceConfidenceFromScore(60), "Fair");
  assert.equal(priceConfidenceFromScore(59), "Weak");
  assert.equal(priceConfidenceFromScore(null), "Weak");
});

test("keeps newest input as latest when observed timestamps tie", () => {
  const history = buildPriceHistory([
    {
      priceMinor: 2000,
      confidenceScore: 80,
      source: "newer-import",
      observedAt: "2026-05-02T10:00:00.000Z",
    },
    {
      priceMinor: 1500,
      confidenceScore: 80,
      source: "older-import",
      observedAt: "2026-05-02T10:00:00.000Z",
    },
  ]);

  assert.equal(latestPricePoint(history)?.valueMinor, 2000);
});

test("ignores impossible prices and handles empty ranges", () => {
  assert.deepEqual(
    buildPriceHistory([
      {
        priceMinor: -1,
        confidenceScore: 80,
        source: "pokemon-tcg-api",
        observedAt: "2026-01-01",
      },
    ]),
    [],
  );
  assert.equal(priceRangeMinor([]), null);
});

test("keeps only the latest point per source, variant, and UTC day", () => {
  const history = buildPriceHistory([
    {
      priceMinor: 3000,
      source: "tcgcsv",
      variantLabel: "Normal",
      observedAt: "2026-07-17T01:00:00.000Z",
    },
    {
      priceMinor: 3032,
      source: "tcgcsv",
      variantLabel: "Normal",
      observedAt: "2026-07-17T08:00:00.000Z",
    },
    {
      priceMinor: 3100,
      source: "tcgcsv",
      variantLabel: "Normal",
      observedAt: "2026-07-18T08:00:00.000Z",
    },
  ]);

  assert.deepEqual(history.map((point) => point.valueMinor), [3032, 3100]);
  assert.equal(history[0].observedAt, "2026-07-17T08:00:00.000Z");
});

test("suppresses isolated extreme provider spikes without hiding sustained moves or endpoints", () => {
  const point = (day, valueMinor) => ({
    confidence: "Strong",
    observedAt: `2026-08-${String(day).padStart(2, "0")}T08:00:00.000Z`,
    source: "tcgcsv",
    valueMinor,
    variantLabel: "Factory sealed",
  });
  const history = suppressTransientPriceOutliers([
    point(1, 40_000),
    point(2, 7_500_000),
    point(3, 41_000),
    point(4, 800_000),
    point(5, 820_000),
    point(6, 100),
  ]);

  assert.deepEqual(history.map((entry) => entry.valueMinor), [
    40_000,
    41_000,
    800_000,
    820_000,
    100,
  ]);
});
