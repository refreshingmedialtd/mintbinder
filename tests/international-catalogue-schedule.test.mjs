import assert from "node:assert/strict";
import test from "node:test";
import {
  runLiveInternationalCatalogueRefresh,
  selectInternationalCatalogueBatch,
} from "../scripts/run-live-international-catalogue-refresh.mjs";

const languages = ["ja", "zh-tw", "zh-cn", "ko"];

test("starts the first language when no scheduled catalogue history exists", () => {
  assert.deepEqual(selectInternationalCatalogueBatch({
    history: [],
    languages,
    maxPages: 1,
    pageSize: 100,
  }), {
    language: "ja",
    maxPages: 1,
    page: 1,
    pageSize: 100,
  });
});

test("selects the least-recently visited language and advances its bounded cursor", () => {
  const batch = selectInternationalCatalogueBatch({
    history: [
      {
        cardsFetched: 100,
        language: "ja",
        maxPages: 1,
        page: 1,
        pageSize: 100,
        startedAt: "2026-08-25T00:00:00Z",
        totalCount: 4_000,
      },
      {
        cardsFetched: 100,
        language: "zh-tw",
        maxPages: 1,
        page: 3,
        pageSize: 100,
        startedAt: "2026-08-24T00:00:00Z",
        totalCount: 7_400,
      },
    ],
    languages,
    maxPages: 1,
    pageSize: 100,
  });

  // Never-visited languages sort before visited lanes, in configured order.
  assert.equal(batch.language, "zh-cn");
  assert.equal(batch.page, 1);
});

test("wraps a completed language to page one", () => {
  const batch = selectInternationalCatalogueBatch({
    history: languages.map((language, index) => ({
      cardsFetched: language === "ja" ? 50 : 100,
      language,
      maxPages: 1,
      page: language === "ja" ? 4 : 1,
      pageSize: 100,
      startedAt: `2026-08-2${index + 1}T00:00:00Z`,
      totalCount: language === "ja" ? 350 : 1_000,
    })),
    languages,
    maxPages: 1,
    pageSize: 100,
  });

  assert.equal(batch.language, "ja");
  assert.equal(batch.page, 1);
});

test("resets safely when the configured page size changes", () => {
  const batch = selectInternationalCatalogueBatch({
    history: languages.map((language, index) => ({
      cardsFetched: 50,
      language,
      maxPages: 1,
      page: 4,
      pageSize: 50,
      startedAt: `2026-08-2${index + 1}T00:00:00Z`,
      totalCount: 1_000,
    })),
    languages,
    maxPages: 1,
    pageSize: 100,
  });

  assert.equal(batch.language, "ja");
  assert.equal(batch.page, 1);
});

test("refuses to send the scheduler secret over non-loopback HTTP", async () => {
  let requested = false;
  const prisma = {
    $disconnect: async () => undefined,
    $queryRaw: async () => [],
  };

  await assert.rejects(
    runLiveInternationalCatalogueRefresh({
      env: {
        JOB_SECRET: "secret",
        SCHEDULED_JOB_APP_URL: "http://catalogue.example",
      },
      fetchImpl: async () => {
        requested = true;
        throw new Error("unexpected fetch");
      },
      prisma,
    }),
    /HTTPS outside local loopback/,
  );

  assert.equal(requested, false);
});
