import assert from "node:assert/strict";
import test from "node:test";
import {
  scheduledSetPricingInputFromSources,
  scheduledSetPricingNextPage,
} from "../src/lib/jobs/scheduled-set-pricing-input.ts";

test("scheduled set pricing uses safe set-rotation defaults", () => {
  assert.deepEqual(scheduledSetPricingInputFromSources({ env: {} }), {
    excludeProviderIds: [],
    limit: 1,
    maxPagesPerSet: 1,
    pageSize: 25,
    priceOnlyUnpriced: false,
    waitMs: 0,
  });
});

test("scheduled pricing resets legacy cursors when the page size changes", () => {
  assert.equal(scheduledSetPricingNextPage({
    currentPageSize: 25,
    expectedPages: 20,
    storedPage: 2,
    storedPageSize: 250,
  }), 1);
  assert.equal(scheduledSetPricingNextPage({
    currentPageSize: 25,
    expectedPages: 20,
    storedPage: 4,
    storedPageSize: 25,
  }), 4);
  assert.equal(scheduledSetPricingNextPage({
    currentPageSize: 25,
    expectedPages: 3,
    storedPage: 99,
    storedPageSize: 25,
  }), 3);
});

test("scheduled set pricing accepts env and body overrides", () => {
  assert.deepEqual(
    scheduledSetPricingInputFromSources({
      body: {
        excludeProviderIds: ["base1", "base2", "base1"],
        limit: 3,
        priceOnlyUnpriced: false,
      },
      env: {
        POKEMON_TCG_PRICE_ONLY_UNPRICED: "true",
        POKEMON_TCG_SET_PRICING_LIMIT: "12",
        POKEMON_TCG_SET_PRICING_MAX_PAGES_PER_SET: "6",
        POKEMON_TCG_SET_PRICING_PAGE_SIZE: "200",
        POKEMON_TCG_SET_PRICING_WAIT_MS: "250",
      },
    }),
    {
      excludeProviderIds: ["base1", "base2"],
      limit: 1,
      maxPagesPerSet: 1,
      pageSize: 25,
      priceOnlyUnpriced: false,
      waitMs: 250,
    },
  );
});
