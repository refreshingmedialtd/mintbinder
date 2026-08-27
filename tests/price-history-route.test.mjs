import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isValidPriceHistorySource,
  priceHistoryTruncation,
  serializePriceHistoryRows,
} from "../src/lib/pricing/price-history-response.ts";

test("serializes decimal grade scores as safe JSON numbers without losing stream identity", () => {
  const points = serializePriceHistoryRows([
    {
      bucket: new Date("2026-08-24T00:00:00.000Z"),
      condition: null,
      confidenceScore: 58,
      currency: "GBP",
      gradedCompany: "PSA",
      gradedScore: { toString: () => "10.0" },
      language: "en",
      observedAt: new Date("2026-08-24T12:00:00.000Z"),
      pointCount: 1,
      priceMinor: 32_000,
      sampleSize: null,
      source: "pricecharting-graded-card",
      variantLabel: "Holofoil",
    },
  ]);

  assert.equal(points[0].gradedCompany, "PSA");
  assert.equal(points[0].gradedScore, 10);
  assert.equal(points[0].language, "en");
  assert.equal(points[0].bucket, "2026-08-24T00:00:00.000Z");
});

test("validates source filters without turning client input into a server error", () => {
  assert.equal(isValidPriceHistorySource("pricecharting-graded-card"), true);
  assert.equal(isValidPriceHistorySource("tcgcsv-card' OR 1=1"), false);
  assert.equal(isValidPriceHistorySource("x".repeat(81)), false);
});

test("price-history aggregation groups every grade and condition identity field", async () => {
  const route = await readFile(new URL("../src/app/api/price-history/route.ts", import.meta.url), "utf8");
  const groupBy = route.slice(route.indexOf("GROUP BY"), route.indexOf("ORDER BY", route.indexOf("GROUP BY")));

  for (const field of [
    '"condition"',
    '"language"',
    '"variant_label"',
    '"graded_company"',
    '"graded_score"',
  ]) {
    assert.match(groupBy, new RegExp(field.replace(/["_]/g, "\\$&")));
  }
});

test("price-history keeps the newest 5,000 grouped points and discloses truncation", async () => {
  const route = await readFile(new URL("../src/app/api/price-history/route.ts", import.meta.url), "utf8");
  const newestOrder = route.indexOf('"bucket" DESC');
  const limit = route.indexOf("LIMIT 5000", newestOrder);
  const plottingOrder = route.indexOf('"bucket" ASC', limit);

  assert.ok(newestOrder > 0, "the bounded inner query must prioritize the newest bucket");
  assert.ok(limit > newestOrder, "the limit must be applied after newest-first ordering");
  assert.ok(plottingOrder > limit, "selected points must be restored to chronological plotting order");
  assert.deepEqual(priceHistoryTruncation(5_001, 5_000), {
    availablePointCount: 5_001,
    truncated: true,
  });
});

test("price-history UI selects one exact identity series instead of joining every returned point", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const panel = page.slice(page.indexOf("function PriceTrendPanel"), page.indexOf("type PriceHistoryRange"));

  assert.match(panel, /groupPriceHistorySeries\((?:allHistory|relevantHistory)\)/);
  assert.match(panel, /selectedHistorySeriesKey/);
  assert.match(panel, /Each line is one exact finish, grade, condition, language, source and currency/);
  assert.doesNotMatch(panel, /const history = preferredHistory\.length \? preferredHistory : allHistory/);
});

test("price history is available from unowned catalogue previews and loads real short-range history", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const addScreen = page.slice(page.indexOf("function AddScreen"), page.indexOf("function ManualSealedProductPanel"));
  const catalogueModal = page.slice(page.indexOf("function CataloguePreviewModal"), page.indexOf("function WishlistScreen"));
  const panel = page.slice(page.indexOf("function PriceTrendPanel"), page.indexOf("type PriceHistoryRange"));

  assert.match(addScreen, /showSelectedPriceHistory \? <PriceTrendPanel item=\{selected\}/);
  assert.match(catalogueModal, /showPriceHistory \? <PriceTrendPanel item=\{item\}/);
  assert.match(panel, /const shouldLoadRemoteHistory = isUuid\(item\.id\)/);
  assert.match(panel, /fetch\(`\/api\/price-history\?catalogueId=/);
});

test("price-history hides unlicensed PriceCharting streams", async () => {
  const route = await readFile(new URL("../src/app/api/price-history/route.ts", import.meta.url), "utf8");

  assert.match(route, /customerVisiblePriceSource\(source\)/);
  assert.match(route, /priceChartingLicenceConfirmed\(\)/);
  assert.match(route, /providerPermissionFilter/);
});
