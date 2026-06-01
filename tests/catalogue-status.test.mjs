import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCatalogueResult,
  summarizeCatalogueStatus,
} from "../src/lib/jobs/catalogue-status-summary.ts";

test("normalizes catalogue job result payloads", () => {
  assert.deepEqual(
    normalizeCatalogueResult({
      cardsFetched: "500",
      complete: false,
      nextPage: "12",
      query: "",
      totalCount: "20359",
    }),
    {
      cardsFetched: 500,
      cardsUpserted: undefined,
      complete: false,
      groupsAvailable: undefined,
      groupsMatched: undefined,
      groupsProcessed: undefined,
      maxPages: undefined,
      nextPage: 12,
      page: undefined,
      pageSize: undefined,
      priceOnlyUnpriced: undefined,
      pagesProcessed: undefined,
      pricingSnapshotsCreated: undefined,
      productsFetched: undefined,
      query: "",
      sealedProductsSkipped: undefined,
      sealedProductsUpserted: undefined,
      setsUpserted: undefined,
      totalCount: 20359,
      writePrices: undefined,
    },
  );

  assert.equal(normalizeCatalogueResult({ pricingSnapshotsCreated: 0 })?.pricingSnapshotsCreated, 0);
  assert.equal(normalizeCatalogueResult(null), null);
  assert.equal(normalizeCatalogueResult({ nextPage: null })?.nextPage, null);
});

test("summarizes catalogue status coverage and resume page", () => {
  const status = summarizeCatalogueStatus({
    cardCount: 4180,
    duplicateProviderIdCount: 0,
    latestCatalogueResult: {
      complete: false,
      nextPage: 16,
      totalCount: 20359,
    },
    latestPricingResult: {
      pricingSnapshotsCreated: 70,
      totalCount: 70,
    },
    latestSealedPricingResult: {
      groupsProcessed: 2,
      pricingSnapshotsCreated: 0,
      sealedProductsUpserted: 11,
    },
    pricedCardCount: 1234,
    pricedSealedProductCount: 12,
    pricingBySeries: [
      {
        cardCount: 100,
        pricedCardCount: 75,
        pricingCoveragePercent: 75,
        series: "Scarlet & Violet",
        unpricedCardCount: 25,
      },
    ],
    pricingBySource: [
      {
        itemType: "card",
        pricedItemCount: 1234,
        priceSnapshotCount: 1300,
        source: "pokemon-tcg-api",
      },
    ],
    priceSnapshotCount: 690,
    sealedPricingByProductType: [
      {
        pricedSealedProductCount: 12,
        productType: "booster_box",
        sealedPriceSnapshotCount: 14,
        sealedPricingCoveragePercent: 100,
        sealedProductCount: 12,
        unpricedSealedProductCount: 0,
      },
    ],
    sealedPriceSnapshotCount: 14,
    sealedProductCount: 2,
    setCount: 23,
  });

  assert.equal(status.coveragePercent, 20.5);
  assert.equal(status.nextCataloguePage, 16);
  assert.equal(status.pricingCoveragePercent, 29.5);
  assert.equal(status.providerTotalCount, 20359);
  assert.equal(status.pricedCardCount, 1234);
  assert.equal(status.pricedSealedProductCount, 12);
  assert.equal(status.sealedPriceSnapshotCount, 14);
  assert.equal(status.sealedPricingCoveragePercent, 100);
  assert.equal(status.latestPricingResult?.pricingSnapshotsCreated, 70);
  assert.equal(status.latestSealedPricingResult?.pricingSnapshotsCreated, 0);
  assert.equal(status.pricingBySeries[0]?.unpricedCardCount, 25);
  assert.equal(status.pricingBySource[0]?.source, "pokemon-tcg-api");
  assert.equal(status.sealedPricingByProductType[0]?.productType, "booster_box");
});

test("treats complete catalogue runs as having no resume page", () => {
  const status = summarizeCatalogueStatus({
    cardCount: 207,
    duplicateProviderIdCount: 0,
    latestCatalogueResult: {
      complete: true,
      nextPage: 2,
      totalCount: 207,
    },
    pricedCardCount: 0,
    pricedSealedProductCount: 0,
    priceSnapshotCount: 0,
    sealedPriceSnapshotCount: 0,
    sealedProductCount: 0,
    setCount: 1,
  });

  assert.equal(status.coveragePercent, 100);
  assert.equal(status.nextCataloguePage, null);
});
