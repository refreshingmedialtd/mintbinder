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
      maxPages: undefined,
      nextPage: 12,
      page: undefined,
      pageSize: undefined,
      pagesProcessed: undefined,
      pricingSnapshotsCreated: undefined,
      query: "",
      setsUpserted: undefined,
      totalCount: 20359,
    },
  );

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
    pricedCardCount: 1234,
    priceSnapshotCount: 690,
    sealedProductCount: 2,
    setCount: 23,
  });

  assert.equal(status.coveragePercent, 20.5);
  assert.equal(status.nextCataloguePage, 16);
  assert.equal(status.pricingCoveragePercent, 29.5);
  assert.equal(status.providerTotalCount, 20359);
  assert.equal(status.pricedCardCount, 1234);
  assert.equal(status.latestPricingResult?.pricingSnapshotsCreated, 70);
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
    priceSnapshotCount: 0,
    sealedProductCount: 0,
    setCount: 1,
  });

  assert.equal(status.coveragePercent, 100);
  assert.equal(status.nextCataloguePage, null);
});
