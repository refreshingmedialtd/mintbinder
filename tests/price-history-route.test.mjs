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
    '"variantLabel"',
    '"gradedCompany"',
    '"gradedScore"',
  ]) {
    assert.match(groupBy, new RegExp(field.replace(/["_]/g, "\\$&")));
  }
});

test("price-history calculates a parameterized time bucket once before grouping", async () => {
  const route = await readFile(new URL("../src/app/api/price-history/route.ts", import.meta.url), "utf8");
  const bucketed = route.slice(route.indexOf('WITH "bucketed_history"'), route.indexOf('"grouped_history" AS'));
  const grouped = route.slice(route.indexOf('"grouped_history" AS'), route.indexOf('"newest_history" AS'));

  assert.match(bucketed, /date_trunc\(\$\{bucket\}, "observed_at"\) AS "bucket"/);
  assert.match(grouped, /FROM "bucketed_history"/);
  assert.match(grouped, /GROUP BY\s+"bucket"/);
  assert.doesNotMatch(grouped, /date_trunc\(\$\{bucket\}/);
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

  assert.match(addScreen, /showSelectedPriceHistory \? \([\s\S]*?<PriceTrendPanel item=\{selected\}/);
  assert.match(addScreen, /preferredVariant=\{selectedVariant\}/);
  assert.match(addScreen, /onViewHistory=\{\(\) => openPriceHistory\(item\)\}/);
  assert.match(addScreen, /requestedPriceHistoryIdRef/);
  assert.match(addScreen, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(addScreen, /add-details-panel" ref=\{addDetailsPanelRef\} tabIndex=\{-1\}/);
  assert.match(catalogueModal, /showPriceHistory \? <PriceTrendPanel item=\{item\}/);
  assert.match(panel, /const shouldLoadRemoteHistory = isUuid\(item\.id\)/);
  assert.match(panel, /preferredVariant \?\? \(\s*owned \? effectiveCollectionVariant\(owned, item\) : undefined\s*\)/);
  assert.match(panel, /preferredPriceHistorySeriesKey\(\s*relevantHistory,\s*owned \? undefined : historyPreferredVariant/);
  assert.match(panel, /historyPreferredVariant \? undefined : historySeries\[0\]/);
  assert.match(panel, /catalogueMarketValueMinor\(item, preferredVariant\)/);
  assert.match(panel, /setSelectedHistorySeriesKey\(""\);\s*}, \[historyPreferredVariant\]\)/);
  assert.match(panel, /fetch\(`\/api\/price-history\?catalogueId=/);
});

test("price-history range controls remain available when the selected stream has no recent points", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const panel = page.slice(page.indexOf("function PriceTrendPanel"), page.indexOf("type PriceHistoryRange"));
  const controls = page.slice(page.indexOf("function PriceHistoryRangeControls"), page.indexOf("function priceHistoryApiRange"));
  const chart = page.slice(page.indexOf("function PriceHistoryLineChart"), page.indexOf("function filterPriceHistoryByRange"));

  assert.match(panel, /<PriceHistoryRangeControls onRangeChange=\{setRange\} range=\{range\} \/>\s*\{history\.length \? \(/);
  assert.match(controls, /aria-label="Price history timeframe"/);
  assert.match(controls, /onClick=\{\(\) => onRangeChange\(option\.value\)\}/);
  assert.doesNotMatch(chart, /Price history timeframe/);
});

test("price-history hides unlicensed PriceCharting streams", async () => {
  const route = await readFile(new URL("../src/app/api/price-history/route.ts", import.meta.url), "utf8");

  assert.match(route, /customerVisiblePriceSource\(source\)/);
  assert.match(route, /priceChartingLicenceConfirmed\(\)/);
  assert.match(route, /providerPermissionFilter/);
});

test("price-history presents sealed provider aliases as Factory sealed", async () => {
  const route = await readFile(new URL("../src/app/api/price-history/route.ts", import.meta.url), "utf8");

  assert.match(
    route,
    /canonicalVariantLabelForItemType\(itemType, point\.variantLabel\) \?\? null/,
  );
  assert.match(route, /const variantLabelExpression = itemType === "sealed"/);
  assert.match(route, /IN \('normal', 'standard', 'sealed', 'factorysealed', 'newsealed', 'unopenedsealed'\)/);
  assert.match(route, /\$\{variantLabelExpression\} AS "variantLabel"/);
  assert.match(route, /FROM "bucketed_history"[\s\S]*GROUP BY[\s\S]*"variantLabel"/);
});
