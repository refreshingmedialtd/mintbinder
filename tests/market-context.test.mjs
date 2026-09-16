import assert from "node:assert/strict";
import test from "node:test";
import {
  effectivePriceConfidence,
  priceConfidenceExplanation,
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
    observedAt: "2026-07-21T10:00:00.000Z",
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

test("uses a current calculated sealed market before CardTrader seller asks", () => {
  const calculatedMarket = point({
    source: "tcgcsv",
    valueMinor: 9_934,
  });
  const cardTraderAsks = point({
    confidence: "Fair",
    source: "cardtrader-sealed",
    valueMinor: 18_959,
  });

  assert.equal(
    preferredLatestPricePoint([calculatedMarket, cardTraderAsks], now),
    calculatedMarket,
  );
  assert.deepEqual(
    preferredPriceSeries([calculatedMarket, cardTraderAsks], now),
    [calculatedMarket],
  );
});

test("uses a 48-hour freshness ceiling for every price and limits non-UK confidence", () => {
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
  assert.equal(priceFreshnessStatus(eightDayLowValue, now), "Stale");
  assert.equal(effectivePriceConfidence(point(), now), "Weak");
  assert.equal(effectivePriceConfidence(point({ source: "pokemon-tcg-api-cardmarket" }), now), "Fair");
  assert.equal(effectivePriceConfidence(point({ source: "pulse-uk" }), now), "Strong");
});

test("freshness boundaries reject six-day-old and future-dated observations", () => {
  assert.equal(priceFreshnessStatus(point({ observedAt: "2026-07-20T12:00:00Z" }), now), "Current");
  assert.equal(priceFreshnessStatus(point({ observedAt: "2026-07-20T11:59:59Z" }), now), "Stale");
  assert.equal(priceFreshnessStatus(point({ observedAt: "2026-07-16T12:00:00Z" }), now), "Stale");
  assert.equal(priceFreshnessStatus(point({ observedAt: "2026-07-23T12:00:00Z" }), now), "Stale");
  assert.equal(priceFreshnessStatus(point({ observedAt: "invalid" }), now), "Stale");
});

test("explains weak UK confidence without pretending a US refresh adds UK evidence", () => {
  assert.match(priceConfidenceExplanation(point(), now), /not evidence of UK sale prices/);
  assert.match(priceConfidenceExplanation(point({ observedAt: "2026-07-16T12:00:00Z" }), now), /48-hour/);
  assert.match(priceConfidenceExplanation(point({ source: "cardtrader-sealed" }), now), /not completed sales/);
});

test("labels market scope honestly and keeps one coherent price series", () => {
  const history = [
    point({ observedAt: "2026-07-20T12:00:00.000Z" }),
    point({ observedAt: "2026-07-21T12:00:00.000Z", source: "tcgcsv-card" }),
    point({ observedAt: "2026-07-20T12:00:00.000Z", source: "pokemon-tcg-api-cardmarket" }),
  ];

  assert.equal(priceMarketRole("tcgcsv-card"), "US market reference");
  assert.equal(priceMarketRole("cardtrader-sealed"), "European seller asking-price estimate");
  assert.match(priceSourceLabel("tcgcsv-card"), /US market/);
  assert.match(priceSourceLabel("cardtrader-sealed"), /European seller asking prices/);
  assert.match(priceSourceLabel("pricecharting-graded-card"), /US graded-card market/);
  assert.deepEqual(preferredPriceSeries(history, now), [history[2]]);
});
