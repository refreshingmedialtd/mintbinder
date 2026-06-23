import assert from "node:assert/strict";
import test from "node:test";
import { scheduledSetPricingInputFromSources } from "../src/lib/jobs/scheduled-set-pricing-input.ts";

test("scheduled set pricing uses safe set-rotation defaults", () => {
  assert.deepEqual(scheduledSetPricingInputFromSources({ env: {} }), {
    excludeProviderIds: [],
    limit: 8,
    maxPagesPerSet: 4,
    pageSize: 250,
    priceOnlyUnpriced: false,
    waitMs: 0,
  });
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
      limit: 3,
      maxPagesPerSet: 6,
      pageSize: 200,
      priceOnlyUnpriced: false,
      waitMs: 250,
    },
  );
});
