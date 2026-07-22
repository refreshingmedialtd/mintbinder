import assert from "node:assert/strict";
import test from "node:test";
import {
  protectedJobRequest,
  runLiveScheduledJob,
} from "../scripts/run-live-scheduled-job.mjs";

test("live pricing requests are split into timeout-safe batches", async () => {
  const calls = [];
  let selectedPage = 6;

  const result = await runLiveScheduledJob({
    env: {
      JOB_SECRET: "secret",
      POKEMON_TCG_PRICING_MAX_PAGES: "5",
      POKEMON_TCG_PRICING_BATCH_WAIT_MS: "0",
      POKEMON_TCG_PRICING_PAGE: "auto",
      POKEMON_TCG_PRICING_PAGE_SIZE: "250",
      POKEMON_TCG_PRICING_STRATEGY: "pages",
      SCHEDULED_JOB_APP_URL: "https://mintbinder.co.uk",
    },
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);

      calls.push({ body, url: String(url) });

      const currentPage = selectedPage;
      selectedPage += body.maxPages;

      return jsonResponse({
        cardsFetched: body.maxPages * 250,
        cardsUpserted: body.maxPages * 250,
        complete: false,
        jobRun: {
          id: `run-${calls.length}`,
        },
        maxPages: body.maxPages,
        nextPage: selectedPage,
        page: currentPage,
        pageSize: 250,
        pagesProcessed: body.maxPages,
        pricingSnapshotsCreated: body.maxPages * 100,
        query: "",
        selectedPage: currentPage,
        setsUpserted: body.maxPages,
        totalCount: 20359,
      });
    },
    job: "pricing",
  });

  assert.deepEqual(calls.map((call) => call.body.maxPages), [1, 1, 1, 1, 1]);
  assert.equal(result.ok, true);
  assert.equal(result.response.batched, true);
  assert.equal(result.response.batchCount, 5);
  assert.equal(result.response.cardsFetched, 1250);
  assert.equal(result.response.nextPage, 11);
  assert.equal(result.response.pagesProcessed, 5);
  assert.equal(result.response.pricingSnapshotsCreated, 500);
});

test("live pricing defaults to set rotation and splits set batches", async () => {
  const calls = [];

  const result = await runLiveScheduledJob({
    env: {
      JOB_SECRET: "secret",
      POKEMON_TCG_PRICING_BATCH_WAIT_MS: "0",
      POKEMON_TCG_PRICING_MAX_PAGES: "3",
      POKEMON_TCG_SET_PRICING_REQUEST_LIMIT: "1",
      SCHEDULED_JOB_APP_URL: "https://mintbinder.co.uk",
    },
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      const runNumber = calls.length + 1;

      calls.push({ body, url: String(url) });

      return jsonResponse({
        cardsFetched: 120,
        cardsUpserted: 120,
        complete: false,
        failedSets: 0,
        jobRun: {
          id: `set-run-${runNumber}`,
        },
        maxPagesPerSet: 4,
        pageSize: 250,
        pagesProcessed: 1,
        priceOnlyUnpriced: false,
        pricingSnapshotsCreated: 100,
        query: "set-rotation",
        scheduled: true,
        selectedSets: [
          {
            name: `Set ${runNumber}`,
            providerId: `set${runNumber}`,
          },
        ],
        setLimit: 1,
        setResults: [
          {
            cardsFetched: 120,
            name: `Set ${runNumber}`,
            pricingSnapshotsCreated: 100,
            providerId: `set${runNumber}`,
            status: "succeeded",
          },
        ],
        setsProcessed: 1,
        strategy: "set-rotation",
        succeededSets: 1,
        totalCount: 120,
      });
    },
    job: "pricing",
  });

  assert.deepEqual(calls.map((call) => call.url), [
    "https://mintbinder.co.uk/api/jobs/scheduled-set-pricing",
    "https://mintbinder.co.uk/api/jobs/scheduled-set-pricing",
    "https://mintbinder.co.uk/api/jobs/scheduled-set-pricing",
  ]);
  assert.deepEqual(calls.map((call) => call.body.limit), [1, 1, 1]);
  assert.deepEqual(calls.map((call) => call.body.excludeProviderIds), [
    [],
    ["set1"],
    ["set1", "set2"],
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.response.batched, true);
  assert.equal(result.response.batchCount, 3);
  assert.equal(result.response.cardsFetched, 360);
  assert.equal(result.response.pricingSnapshotsCreated, 300);
  assert.equal(result.response.setsProcessed, 3);
  assert.equal(result.response.strategy, "set-rotation");
});

test("explicit live pricing page requests remain single requests", async () => {
  const request = protectedJobRequest("pricing", {
    POKEMON_TCG_PRICING_MAX_PAGES: "5",
    POKEMON_TCG_PRICING_PAGE: "9",
  });

  assert.deepEqual(request.body, {
    maxPages: 5,
    page: 9,
  });
});

test("live Japanese card pricing posts to the international pricing endpoint", () => {
  const request = protectedJobRequest("japan-card-pricing", {
    TCGCSV_JAPAN_CARD_GROUP_LIMIT: "3",
    TCGCSV_JAPAN_CARD_PRICE_ONLY_UNPRICED: "false",
    TCGCSV_JAPAN_CARD_WAIT_MS: "250",
  });

  assert.deepEqual(request, {
    body: {
      groupLimit: 3,
      priceOnlyUnpriced: false,
      waitMs: 250,
    },
    path: "/api/jobs/international-card-pricing",
  });
});

test("live English TCGCSV pricing defaults to one history-building group", () => {
  const request = protectedJobRequest("english-card-pricing", {});

  assert.deepEqual(request, {
    body: {
      categoryId: 3,
      groupLimit: 1,
      language: "en",
      minUnpricedCards: 1,
      onlyUnpricedGroups: false,
      priceOnlyUnpriced: false,
      source: "tcgcsv-card",
      waitMs: 120,
      writePrices: true,
    },
    path: "/api/jobs/international-card-pricing",
  });
});

test("live sealed pricing defaults to a timeout-safe history-building group rotation", () => {
  const request = protectedJobRequest("sealed-pricing", {});

  assert.deepEqual(request, {
    body: {
      groupLimit: 1,
      priceOnlyUnpriced: false,
      productLimit: 40,
      waitMs: 120,
      writePrices: true,
    },
    path: "/api/jobs/sealed-pricing-refresh",
  });
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
    status,
  });
}
