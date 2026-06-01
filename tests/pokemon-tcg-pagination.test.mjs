import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePokemonTcgPaging,
  pokemonTcgCardsOrderBy,
  shouldContinuePokemonTcgPaging,
  summarizePokemonTcgPageResults,
} from "../src/lib/pricing/pokemon-tcg-pagination.ts";

test("normalizes Pokemon TCG paging input", () => {
  assert.deepEqual(
    normalizePokemonTcgPaging({ maxPages: "50", page: "3.8", pageSize: "999" }),
    {
      maxPages: 20,
      page: 3,
      pageSize: 250,
    },
  );

  assert.deepEqual(
    normalizePokemonTcgPaging({ maxPages: "", page: 0, pageSize: Number.NaN }),
    {
      maxPages: 1,
      page: 1,
      pageSize: 50,
    },
  );
});

test("uses a deterministic Pokemon TCG order for paging", () => {
  assert.equal(pokemonTcgCardsOrderBy, "-set.releaseDate,number,id");
});

test("summarizes incomplete multi-page Pokemon TCG imports", () => {
  const summary = summarizePokemonTcgPageResults({
    maxPages: 2,
    page: 1,
    pageSize: 250,
    query: "supertype:Pokemon",
    pages: [
      pageResult({ page: 1, setIds: ["set-a"], totalCount: 750 }),
      pageResult({ page: 2, setIds: ["set-a", "set-b"], totalCount: 750 }),
    ],
  });

  assert.equal(summary.cardsFetched, 500);
  assert.equal(summary.cardsUpserted, 500);
  assert.equal(summary.complete, false);
  assert.equal(summary.nextPage, 3);
  assert.equal(summary.pagesProcessed, 2);
  assert.equal(summary.setsUpserted, 2);
  assert.equal(summary.totalCount, 750);
  assert.deepEqual(summary.pages.map((page) => page.page), [1, 2]);
});

test("summarizes complete Pokemon TCG imports", () => {
  const summary = summarizePokemonTcgPageResults({
    maxPages: 2,
    page: 2,
    pageSize: 250,
    query: "set.id:sv3pt5",
    pages: [
      pageResult({ cardsFetched: 200, cardsUpserted: 200, page: 2, totalCount: 500 }),
    ],
  });

  assert.equal(summary.complete, true);
  assert.equal(summary.nextPage, null);
  assert.equal(summary.page, 2);
  assert.equal(summary.pagesProcessed, 1);
});

test("decides when Pokemon TCG paging should continue", () => {
  assert.equal(
    shouldContinuePokemonTcgPaging({
      page: 2,
      pageSize: 250,
      result: { cardsFetched: 250, totalCount: 751 },
    }),
    true,
  );
  assert.equal(
    shouldContinuePokemonTcgPaging({
      page: 3,
      pageSize: 250,
      result: { cardsFetched: 1, totalCount: 751 },
    }),
    true,
  );
  assert.equal(
    shouldContinuePokemonTcgPaging({
      page: 4,
      pageSize: 250,
      result: { cardsFetched: 1, totalCount: 751 },
    }),
    false,
  );
  assert.equal(
    shouldContinuePokemonTcgPaging({
      page: 1,
      pageSize: 250,
      result: { cardsFetched: 0, totalCount: 751 },
    }),
    false,
  );
});

function pageResult(overrides = {}) {
  return {
    cardsFetched: 250,
    cardsUpserted: 250,
    page: 1,
    pricingSnapshotsCreated: 0,
    setIds: [],
    setsUpserted: 1,
    totalCount: 250,
    ...overrides,
  };
}
