import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogueSearchLookahead,
  CATALOGUE_SEARCH_MAX_LIMIT,
  CATALOGUE_SEARCH_MAX_OFFSET,
  normalizeCatalogueSearchLimit,
  normalizeCatalogueSearchOffset,
  paginateCatalogueResults,
} from "../src/lib/catalogue/pagination.ts";
import { sortCatalogueSearchResults } from "../src/lib/catalogue/search-order.ts";
import { compactCatalogueSearchHistory } from "../src/lib/catalogue/search-payload.ts";

test("normalizes bounded limit and offset values", () => {
  assert.equal(normalizeCatalogueSearchLimit(undefined), 40);
  assert.equal(normalizeCatalogueSearchLimit(-1), 40);
  assert.equal(normalizeCatalogueSearchLimit(12.9), 12);
  assert.equal(normalizeCatalogueSearchLimit(10_000), CATALOGUE_SEARCH_MAX_LIMIT);
  assert.equal(normalizeCatalogueSearchOffset(undefined), 0);
  assert.equal(normalizeCatalogueSearchOffset(-5), 0);
  assert.equal(normalizeCatalogueSearchOffset(12.9), 12);
  assert.equal(normalizeCatalogueSearchOffset(10_000), CATALOGUE_SEARCH_MAX_OFFSET);
});

test("uses one-row lookahead for accurate page metadata without a total count", () => {
  assert.equal(catalogueSearchLookahead({ limit: 2, offset: 2 }), 5);
  assert.deepEqual(paginateCatalogueResults(["a", "b", "c", "d", "e"], {
    limit: 2,
    offset: 2,
  }), {
    catalogue: ["c", "d"],
    hasMore: true,
    nextOffset: 4,
    returned: 2,
    windowExhausted: false,
  });
  assert.deepEqual(paginateCatalogueResults(["a", "b", "c", "d"], {
    limit: 2,
    offset: 2,
  }), {
    catalogue: ["c", "d"],
    hasMore: false,
    nextOffset: null,
    returned: 2,
    windowExhausted: false,
  });
});

test("reports when more rows exist beyond the bounded offset window", () => {
  const page = paginateCatalogueResults(["a", "b", "c"], {
    limit: 2,
    offset: CATALOGUE_SEARCH_MAX_OFFSET,
  });

  // The helper normally receives an offset-sized prefix from the database.
  // Simulate that prefix without allocating one thousand fixture objects.
  const bounded = paginateCatalogueResults(
    Array.from({ length: CATALOGUE_SEARCH_MAX_OFFSET + 3 }, (_, index) => index),
    { limit: 2, offset: CATALOGUE_SEARCH_MAX_OFFSET },
  );

  assert.equal(page.returned, 0);
  assert.deepEqual(bounded.catalogue, [CATALOGUE_SEARCH_MAX_OFFSET, CATALOGUE_SEARCH_MAX_OFFSET + 1]);
  assert.equal(bounded.hasMore, true);
  assert.equal(bounded.nextOffset, null);
  assert.equal(bounded.windowExhausted, true);
});

test("deterministic id tie-breakers keep offset pages disjoint", () => {
  const sorted = sortCatalogueSearchResults([
    item("card-c", "Pikachu", 500),
    item("card-a", "Pikachu", 500),
    item("card-b", "Pikachu", 500),
  ], "value-desc");
  const first = paginateCatalogueResults(sorted, { limit: 2, offset: 0 });
  const second = paginateCatalogueResults(sorted, { limit: 2, offset: 2 });

  assert.deepEqual(sorted.map((entry) => entry.id), ["card-a", "card-b", "card-c"]);
  assert.deepEqual(first.catalogue.map((entry) => entry.id), ["card-a", "card-b"]);
  assert.deepEqual(second.catalogue.map((entry) => entry.id), ["card-c"]);
  assert.equal(first.hasMore, true);
  assert.equal(second.hasMore, false);
});

test("search payload compaction preserves the chosen valuation and latest variant prices", () => {
  const catalogueItem = {
    ...item("card-a", "Pikachu", 900),
    priceHistory: [
      point("2026-08-20T00:00:00.000Z", 400, "Normal"),
      point("2026-08-21T00:00:00.000Z", 500, "Normal"),
      point("2026-08-20T00:00:00.000Z", 800, "Reverse Holofoil"),
      point("2026-08-22T00:00:00.000Z", 900, "Reverse Holofoil"),
    ],
  };
  const compact = compactCatalogueSearchHistory(catalogueItem);

  assert.equal(compact.valueMinor, 900);
  assert.deepEqual(compact.priceHistory.map((entry) => entry.valueMinor), [500, 900]);
});

function item(id, name, valueMinor) {
  return {
    id,
    type: "card",
    name,
    set: "Test Set",
    number: "1",
    rarity: "Common",
    hasPrice: true,
    valueMinor,
    confidence: "Fair",
  };
}

function point(observedAt, valueMinor, variantLabel) {
  return {
    observedAt,
    valueMinor,
    confidence: "Fair",
    source: "pulse-uk",
    variantLabel,
  };
}
