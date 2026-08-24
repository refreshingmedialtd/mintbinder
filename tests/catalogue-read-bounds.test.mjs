import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CATALOGUE_LOOKUP_MAX_IDS,
  CATALOGUE_SET_MAX_ITEMS,
  CatalogueLookupValidationError,
  chunkCatalogueLookupIds,
  normalizeCatalogueLookupIds,
} from "../src/lib/catalogue/lookup.ts";

test("production-scale catalogue ID fixtures are split into strictly bounded requests", () => {
  const ids = Array.from({ length: 20_037 }, (_, index) => `catalogue-${index}`);
  const batches = chunkCatalogueLookupIds(ids);

  assert.equal(batches.length, Math.ceil(ids.length / CATALOGUE_LOOKUP_MAX_IDS));
  assert.equal(batches.every((batch) => batch.length <= CATALOGUE_LOOKUP_MAX_IDS), true);
  assert.deepEqual(batches.flat(), ids);
  assert.throws(
    () => normalizeCatalogueLookupIds(ids),
    (error) => error instanceof CatalogueLookupValidationError && /limited/.test(error.message),
  );
});

test("catalogue lookup normalization deduplicates IDs without exceeding the response cap", () => {
  const ids = normalizeCatalogueLookupIds([" card-1 ", "card-1", "sealed-2", ""]);
  assert.deepEqual(ids, ["card-1", "sealed-2"]);
  assert.equal(ids.length <= CATALOGUE_LOOKUP_MAX_IDS, true);
});

test("legacy full catalogue materialization is retired and bounded alternatives enforce caps", async () => {
  const [dataSource, legacyRoute, searchRoute, pageSource] = await Promise.all([
    readFile(new URL("../src/lib/db/app-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/catalogue/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/catalogue/search/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(dataSource, /function getCatalogueItems\b/);
  assert.doesNotMatch(dataSource, /getCatalogueItems\(/);
  assert.match(dataSource, /take: CATALOGUE_SET_MAX_ITEMS/);
  assert.equal(CATALOGUE_SET_MAX_ITEMS, 500);

  assert.match(legacyRoute, /privateReadJson\([\s\S]*410/);
  assert.doesNotMatch(legacyRoute, /getCatalogueData/);
  assert.match(searchRoute, /export async function POST/);
  assert.match(searchRoute, /lookupCatalogueData/);

  assert.doesNotMatch(pageSource, /fetch\("\/api\/catalogue"/);
  assert.match(pageSource, /fetch\("\/api\/catalogue\/search"/);
  assert.match(pageSource, /chunkCatalogueLookupIds/);
});
