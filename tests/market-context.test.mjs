import assert from "node:assert/strict";
import test from "node:test";
import {
  effectivePriceConfidence,
  preferredLatestPricePoint,
  preferredPriceSeries,
  priceFreshnessStatus,
  priceMarketRole,
  priceSourceLabel,
} from "../src/lib/pricing/market-context.ts";

const now = new Date("2026-07-22T12:00:00.000Z");

function point(overrides = {}) {
  return {
    confidence: "Strong",
    observedAt: "2026-07-21T12:00:00.000Z",
    source: "pokemon-tcg-api",
    valueMinor: 5_000,
    ...overrides,
  };
}

test("prefers current UK and European evidence over current US references", () => {
  const us = point();
  const europe = point({
    observedAt: "2026-07-20T12:00:00.000Z",
    source: "pokemon-tcg-api-cardmarket",
    valueMinor: 4_500,
  });
  const uk = point({
    observedAt: "2026-07-19T12:00:00.000Z",
    source: "pulse-uk",
    valueMinor: 4_300,
  });

  assert.equal(preferredLatestPricePoint([us, europe], now), europe);
  assert.equal(preferredLatestPricePoint([us, europe, uk], now), uk);
});

test("uses a current US reference instead of a badly stale European estimate", () => {
  const us = point();
  const staleEurope = point({
    observedAt: "2026-06-01T12:00:00.000Z",
    source: "pokemon-tcg-api-cardmarket",
  });

  assert.equal(preferredLatestPricePoint([staleEurope, us], now), us);
});

test("marks high-value prices stale sooner and limits non-UK confidence", () => {
  const eightDayHighValue = point({
    observedAt: "2026-07-14T11:59:59.000Z",
    source: "pulse-uk",
    valueMinor: 10_000,
  });
  const eightDayLowValue = point({
    observedAt: "2026-07-14T11:59:59.000Z",
    source: "pulse-uk",
    valueMinor: 9_999,
  });

  assert.equal(priceFreshnessStatus(eightDayHighValue, now), "Stale");
  assert.equal(priceFreshnessStatus(eightDayLowValue, now), "Current");
  assert.equal(effectivePriceConfidence(point(), now), "Weak");
  assert.equal(effectivePriceConfidence(point({ source: "pokemon-tcg-api-cardmarket" }), now), "Fair");
  assert.equal(effectivePriceConfidence(point({ source: "pulse-uk" }), now), "Strong");
});

test("labels market scope honestly and keeps one coherent price series", () => {
  const history = [
    point({ observedAt: "2026-07-20T12:00:00.000Z" }),
    point({ observedAt: "2026-07-21T12:00:00.000Z", source: "tcgcsv-card" }),
    point({ observedAt: "2026-07-20T12:00:00.000Z", source: "pokemon-tcg-api-cardmarket" }),
  ];

  assert.equal(priceMarketRole("tcgcsv-card"), "US market reference");
  assert.equal(priceMarketRole("cardtrader-sealed"), "European market estimate");
  assert.match(priceSourceLabel("tcgcsv-card"), /US market/);
  assert.match(priceSourceLabel("cardtrader-sealed"), /European sealed marketplace/);
  assert.deepEqual(preferredPriceSeries(history, now), [history[2]]);
});
