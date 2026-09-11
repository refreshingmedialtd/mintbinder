import assert from "node:assert/strict";
import test from "node:test";
import { runLiveReviewedCardCatalogueRefresh } from "../scripts/run-live-reviewed-card-catalogue-refresh.mjs";

test("live reviewed catalogue helper sends one bounded scheduled request per reviewed group", async () => {
  const calls = [];
  const result = await runLiveReviewedCardCatalogueRefresh({
    env: {
      JOB_SECRET: "job-secret",
      SCHEDULED_JOB_APP_URL: "https://mintbinder.example",
    },
    fetchImpl: async (url, init) => {
      calls.push({ init, url: String(url) });
      const body = JSON.parse(init.body);

      return Response.json({
        cardsUpdated: 1,
        categoryId: body.categoryId,
        groupId: body.groupId,
        jobRun: { id: `job-${body.groupId}` },
      });
    },
  });

  assert.equal(result.complete, true);
  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map((call) => JSON.parse(call.init.body)),
    [
      { categoryId: 3, groupId: "24451", scheduled: true, writePrices: true },
      { categoryId: 3, groupId: "23323", scheduled: true, writePrices: true },
      { categoryId: 85, groupId: "23923", scheduled: true, writePrices: true },
      { categoryId: 3, groupId: "2374", scheduled: true, writePrices: true },
    ],
  );
  assert.ok(calls.every((call) => call.url === "https://mintbinder.example/api/jobs/reviewed-card-catalogue-refresh"));
  assert.ok(calls.every((call) => call.init.headers.authorization === "Bearer job-secret"));
});

test("live reviewed catalogue helper supports an explicit recovery group", async () => {
  const calls = [];
  const result = await runLiveReviewedCardCatalogueRefresh({
    env: {
      JOB_SECRET: "job-secret",
      SCHEDULED_JOB_APP_URL: "https://mintbinder.example",
      TCGCSV_REVIEWED_CATALOGUE_GROUP_IDS: "2374",
    },
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return Response.json({ ok: true });
    },
  });

  assert.equal(result.groupsRequested, 1);
  assert.deepEqual(calls, [
    { categoryId: 3, groupId: "2374", scheduled: true, writePrices: true },
  ]);
});

test("live reviewed catalogue helper attempts later groups after one failure", async () => {
  let calls = 0;

  await assert.rejects(
    () => runLiveReviewedCardCatalogueRefresh({
      env: {
        JOB_SECRET: "job-secret",
        SCHEDULED_JOB_APP_URL: "https://mintbinder.example",
      },
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? Response.json({ error: "first failed" }, { status: 503 })
          : Response.json({ ok: true });
      },
    }),
    (error) => {
      assert.equal(error.summary.complete, false);
      assert.equal(error.summary.failures.length, 1);
      return true;
    },
  );
  assert.equal(calls, 4);
});
