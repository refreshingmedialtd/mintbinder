import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPriceHistory,
  latestPricePoint,
  priceConfidenceFromScore,
  priceRangeMinor,
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
  assert.equal(priceConfidenceFromScore(80), "Strong");
  assert.equal(priceConfidenceFromScore(60), "Fair");
  assert.equal(priceConfidenceFromScore(59), "Weak");
  assert.equal(priceConfidenceFromScore(null), "Weak");
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
