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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
    status,
  });
}
