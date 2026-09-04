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

test("collection and wishlist mutations canonicalize variants from identity-preserving catalogue evidence", () => {
  const helperStart = source.indexOf("async function mutationCatalogueReference");
  const createStart = source.indexOf("export async function createCollectionItem");
  const helper = source.slice(helperStart, createStart);

  assert.ok(helperStart >= 0 && createStart > helperStart);
  assert.match(helper, /hydrateReferencedPriceSnapshotsByIdentity\(\[reference\]\)/);
  assert.match(helper, /mapCardPrintingToCatalogueItem/);
  assert.match(helper, /mapSealedProductToCatalogueItem/);
  assert.match(helper, /includeGradedHistory: true/);

  for (const functionName of [
    "createCollectionItem",
    "updateCollectionItem",
    "createWishlistItem",
    "updateWishlistItem",
  ]) {
    const start = source.indexOf(`export async function ${functionName}`);
    const next = source.indexOf("\nexport async function ", start + 1);
    const body = source.slice(start, next < 0 ? undefined : next);

    assert.ok(start >= 0, `expected ${functionName}`);
    assert.match(body, /catalogueVariantWriteLabel/);
  }
});

test("collection updates canonicalize against the effective next grade and existing variant", () => {
  const start = source.indexOf("export async function updateCollectionItem");
  const next = source.indexOf("\nexport async function ", start + 1);
  const body = source.slice(start, next);

  assert.match(body, /variantLabel: true/);
  assert.match(body, /const variantNeedsUpdate = input\.variant !== undefined \|\| gradingChanged/);
  assert.match(body, /const requestedVariant = input\.variant === undefined\s*\? existing\.variantLabel/);
  assert.match(body, /gradedCompany: effectiveGradeCompany/);
  assert.match(body, /gradedScore: effectiveGradeScore/);
});

test("collection creates retain grade identity for duplicated slabs", () => {
  const start = source.indexOf("export async function createCollectionItem");
  const next = source.indexOf("\nexport async function ", start + 1);
  const body = source.slice(start, next);

  assert.match(body, /gradingCompanyToEnum\(input\.gradeCompany\)/);
  assert.match(body, /catalogueVariantWriteLabel\(catalogueItem, variant, \{/);
  assert.match(body, /gradedCompany,/);
  assert.match(body, /gradedScore,/);
});

test("identity hydration deterministically prefers the newest import when observations tie", () => {
  const start = source.indexOf("async function hydrateReferencedPriceSnapshotsByIdentity");
  const next = source.indexOf("\nfunction groupReferencedPrices", start);
  const body = source.slice(start, next);

  assert.match(body, /"created_at" AS "createdAt"/);
  assert.match(body, /"id" AS "snapshotId"/);
  assert.match(body, /ORDER BY "observed_at" DESC, "created_at" DESC, "id" DESC/);
  assert.match(body, /ORDER BY "observedAt" DESC, "createdAt" DESC, "snapshotId" DESC/);
});

test("sealed catalogue hydration exposes one canonical Factory sealed history", () => {
  const start = source.indexOf("function mapSealedProductToCatalogueItem");
  const next = source.indexOf("function mapCatalogueSearchCard", start);
  const body = source.slice(start, next);

  assert.match(body, /canonicalCataloguePriceHistory\(\s*"sealed"/);
});
