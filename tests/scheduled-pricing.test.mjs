import assert from "node:assert/strict";
import test from "node:test";
import {
  nextScheduledPricingPage,
  scheduledPricingInputFromSources,
} from "../src/lib/jobs/scheduled-pricing.ts";

test("scheduled pricing starts at page 1 when there is no previous run", () => {
  assert.equal(nextScheduledPricingPage([], ""), 1);
});

test("scheduled pricing resumes from the last successful next page", () => {
  assert.equal(
    nextScheduledPricingPage([
      {
        jobType: "pricing_refresh",
        resultPayload: {
          complete: false,
          nextPage: 7,
          query: "",
        },
        status: "succeeded",
      },
    ]),
    7,
  );
});

test("scheduled pricing cycles back to page 1 when the previous run completed the query", () => {
  assert.equal(
    nextScheduledPricingPage([
      {
        resultPayload: {
          complete: true,
          nextPage: null,
          query: "",
        },
        status: "succeeded",
      },
    ]),
    1,
  );
});

test("scheduled pricing ignores failed runs and mismatched queries", () => {
  assert.equal(
    nextScheduledPricingPage(
      [
        {
          resultPayload: { nextPage: 12, query: "set.id:base1" },
          status: "succeeded",
        },
        {
          resultPayload: { nextPage: 5, query: "" },
          status: "failed",
        },
        {
          resultPayload: { nextPage: 3, query: "" },
          status: "succeeded",
        },
      ],
      "",
    ),
    3,
  );
});

test("scheduled pricing input uses safe production defaults and auto page rotation", () => {
  assert.deepEqual(
    scheduledPricingInputFromSources({
      env: {},
      recentRuns: [
        {
          resultPayload: { complete: false, nextPage: 4, query: "" },
          status: "succeeded",
        },
      ],
    }),
    {
      maxPages: 5,
      page: 4,
      pageSize: 250,
      priceOnlyUnpriced: false,
    },
  );
});

test("scheduled pricing input allows explicit env and body overrides", () => {
  assert.deepEqual(
    scheduledPricingInputFromSources({
      body: {
        pageSize: 100,
        priceOnlyUnpriced: false,
      },
      env: {
        POKEMON_TCG_PRICING_MAX_PAGES: "4",
        POKEMON_TCG_PRICING_PAGE: "9",
        POKEMON_TCG_PRICING_QUERY: "set.id:sv3pt5",
        POKEMON_TCG_PRICE_ONLY_UNPRICED: "true",
      },
      recentRuns: [],
    }),
    {
      maxPages: 4,
      page: 9,
      pageSize: 100,
      priceOnlyUnpriced: false,
      q: "set.id:sv3pt5",
    },
  );
});
