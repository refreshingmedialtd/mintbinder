import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/lib/db/app-data.ts", import.meta.url), "utf8");

test("tenant price hydration preserves exact card and sealed condition streams", () => {
  const queryStart = source.indexOf('WITH "ranked_prices" AS');
  const queryEnd = source.indexOf('const byCard = groupReferencedPrices', queryStart);
  const query = source.slice(queryStart, queryEnd);

  assert.ok(queryStart >= 0 && queryEnd > queryStart, "expected the referenced-price hydration query");
  assert.match(query, /"item_type" = 'card'::item_type[\s\S]*"condition"::text = 'near_mint'/);
  assert.match(query, /"item_type" = 'sealed_product'::item_type[\s\S]*"condition"::text = 'sealed'/);
});

test("storage totals reuse the fully mapped catalogue instead of dummy card metadata", () => {
  assert.match(source, /mapStorageLocations\(storageLocations, collection, catalogue\)/);
  assert.match(
    source,
    /exactCollectionItemValueMinor\(item, catalogueById\.get\(item\.catalogueId\)\)/,
  );
  assert.doesNotMatch(source, /name: "Collection item"/);
});

test("restricted provider rows are filtered before every nested history limit", () => {
  const nestedHistories = [...source.matchAll(/priceSnapshots:\s*\{/g)];
  const prefilteredHistories = [...source.matchAll(/priceSnapshots:\s*\{[\s\S]{0,180}?where: customerVisiblePriceSnapshotWhere/g)];

  assert.ok(nestedHistories.length > 0);
  assert.equal(prefilteredHistories.length, nestedHistories.length);
});

test("value-sorted catalogue SQL excludes restricted sources before its price limit", () => {
  for (const functionName of ["searchCardPrintingsByValue", "searchSealedProductsByValue"]) {
    const start = source.indexOf(`async function ${functionName}`);
    const nextFunction = source.indexOf("\nasync function ", start + 1);
    const body = source.slice(start, nextFunction < 0 ? undefined : nextFunction);
    const restriction = body.indexOf("customerVisiblePriceSnapshotSql()");
    const limit = body.indexOf("LIMIT ${PRICE_HISTORY_LIMIT}");

    assert.ok(start >= 0, `expected ${functionName}`);
    assert.ok(restriction >= 0 && restriction < limit, `${functionName} must filter before limiting`);
  }
});
