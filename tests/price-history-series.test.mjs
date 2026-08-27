import assert from "node:assert/strict";
import test from "node:test";
import {
  groupPriceHistorySeries,
  preferredPriceHistorySeriesKey,
  priceHistoryIdentityKey,
} from "../src/lib/pricing/price-history-series.ts";

const rawNormal = {
  confidence: "Fair",
  currency: "GBP",
  observedAt: "2026-08-01T00:00:00.000Z",
  source: "tcgcsv",
  valueMinor: 100,
  variantLabel: "Normal",
};

test("price-history series never joins different variants or grades", () => {
  const history = [
    rawNormal,
    { ...rawNormal, observedAt: "2026-08-02T00:00:00.000Z", valueMinor: 110 },
    { ...rawNormal, variantLabel: "Reverse Holofoil", valueMinor: 250 },
    { ...rawNormal, gradedCompany: "PSA", gradedScore: 10, valueMinor: 900 },
  ];

  const grouped = groupPriceHistorySeries(history);
  assert.equal(grouped.length, 3);
  assert.deepEqual(grouped.map((series) => series.points.length).sort(), [1, 1, 2]);
});

test("price-history identity includes source, currency, condition and language", () => {
  assert.notEqual(priceHistoryIdentityKey(rawNormal), priceHistoryIdentityKey({ ...rawNormal, source: "cardtrader" }));
  assert.notEqual(priceHistoryIdentityKey(rawNormal), priceHistoryIdentityKey({ ...rawNormal, currency: "EUR" }));
  assert.notEqual(priceHistoryIdentityKey(rawNormal), priceHistoryIdentityKey({ ...rawNormal, condition: "LP" }));
  assert.notEqual(priceHistoryIdentityKey(rawNormal), priceHistoryIdentityKey({ ...rawNormal, language: "Japanese" }));
});

test("preferred history stream stays raw and respects an explicit variant", () => {
  const reverse = { ...rawNormal, observedAt: "2026-08-03T00:00:00.000Z", variantLabel: "Reverse Holofoil" };
  const gradedReverse = { ...reverse, gradedCompany: "PSA", gradedScore: 10 };
  const selected = preferredPriceHistorySeriesKey([rawNormal, reverse, gradedReverse], "Reverse Holofoil");

  assert.equal(selected, priceHistoryIdentityKey(reverse));
  assert.equal(preferredPriceHistorySeriesKey([rawNormal], "Reverse Holofoil"), undefined);
});
