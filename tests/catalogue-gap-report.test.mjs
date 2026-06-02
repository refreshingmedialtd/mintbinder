import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCatalogueGapReport,
  catalogueGapRecommendations,
} from "../src/lib/jobs/catalogue-gap-report.ts";

const baseStatus = {
  cardCount: 1000,
  coveragePercent: 94.2,
  duplicateProviderIdCount: 0,
  latestCatalogueResult: null,
  latestPricingResult: null,
  latestSealedPricingResult: null,
  nextCataloguePage: null,
  priceSnapshotCount: 900,
  pricedCardCount: 800,
  pricedSealedProductCount: 80,
  pricingBySeries: [],
  pricingBySource: [],
  pricingCoveragePercent: 80,
  providerTotalCount: 1061,
  sealedPriceSnapshotCount: 80,
  sealedPricingByProductType: [],
  sealedPricingCoveragePercent: 80,
  sealedProductCount: 100,
  setCount: 10,
};

test("recommends the largest actionable catalogue and pricing gaps", () => {
  const recommendations = catalogueGapRecommendations({
    ...baseStatus,
    duplicateProviderIdCount: 2,
    nextCataloguePage: 24,
    pricingBySeries: [
      {
        cardCount: 300,
        pricedCardCount: 120,
        pricingCoveragePercent: 40,
        series: "Mega Evolution",
        unpricedCardCount: 180,
      },
    ],
    sealedPricingByProductType: [
      {
        pricedSealedProductCount: 36,
        productType: "booster_box",
        sealedPriceSnapshotCount: 36,
        sealedPricingCoveragePercent: 38.3,
        sealedProductCount: 94,
        unpricedSealedProductCount: 58,
      },
    ],
  });

  assert.deepEqual(
    recommendations.map((recommendation) => recommendation.type),
    ["duplicate_review", "catalogue_resume", "card_pricing", "sealed_pricing"],
  );
  assert.equal(recommendations[2].priority, "high");
  assert.match(recommendations[3].title, /Booster Box/);
});

test("builds a stable catalogue gap export payload", () => {
  const generatedAt = new Date("2026-06-02T09:30:00.000Z");
  const report = buildCatalogueGapReport(baseStatus, generatedAt);

  assert.equal(report.generatedAt, "2026-06-02T09:30:00.000Z");
  assert.equal(report.status.cardCount, 1000);
  assert.equal(report.recommendations[0].type, "healthy");
});
