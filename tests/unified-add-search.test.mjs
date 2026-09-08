import assert from "node:assert/strict";
import { SealedProductType } from "@prisma/client";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sealedProductTypeFromSearchTerm } from "../src/lib/db/app-data.ts";

const pageSource = readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const appDataSource = readFile(new URL("../src/lib/db/app-data.ts", import.meta.url), "utf8");

test("Add searches cards and sealed products together by default", async () => {
  const page = await pageSource;
  const addScreen = page.slice(
    page.indexOf("function AddScreen("),
    page.indexOf("function ManualSealedProductPanel("),
  );

  assert.match(addScreen, /useState<CatalogueTypeFilter>\("all"\)/);
  assert.match(addScreen, /title="Add item"/);
  assert.match(addScreen, />\s*All items\s*<\/button>/);
  assert.match(addScreen, /type: catalogueTypeFilter/g);
  assert.doesNotMatch(addScreen, /type: appState\.addType/);
  assert.match(addScreen, /aria-label="Search cards and sealed products"/);
  assert.match(addScreen, /Search cards, sealed products, sets, or collector numbers/);
  assert.match(addScreen, /catalogueTypeFilter !== "card"/);
});

test("selecting an item does not narrow the combined search request", async () => {
  const page = await pageSource;
  const addScreen = page.slice(
    page.indexOf("function AddScreen("),
    page.indexOf("function ManualSealedProductPanel("),
  );
  const signature = addScreen.slice(
    addScreen.indexOf("const catalogueQuerySignature"),
    addScreen.indexOf("const catalogueQuerySignatureRef"),
  );

  assert.match(signature, /catalogueTypeFilter/);
  assert.doesNotMatch(signature, /appState\.addType/);
  assert.match(addScreen, /addType: item\.type/);
});

test("database catalogue searches keep card aliases inside all-token matching groups", async () => {
  const source = await appDataSource;
  const cardSearch = source.slice(
    source.indexOf("async function searchCardPrintings("),
    source.indexOf("async function searchSealedProducts("),
  );
  const sealedSearch = source.slice(
    source.indexOf("async function searchSealedProducts("),
    source.indexOf("async function searchCardPrintingsByValue("),
  );
  const rawSql = source.slice(
    source.indexOf("function cardCatalogueSearchWhere("),
    source.indexOf("function filterAndSortCatalogue("),
  );

  assert.match(cardSearch, /catalogueSearchTermGroups\(query\.q\)/);
  assert.match(cardSearch, /AND: searchTermGroups\.map/);
  assert.doesNotMatch(cardSearch, /searchTerms\.flatMap/);
  assert.match(sealedSearch, /catalogueSearchTokens\(query\.q\)/);
  assert.match(sealedSearch, /allTokenFilter/);
  assert.match(rawSql, /catalogueSearchTermGroups\(query\.q\)/);
  assert.match(rawSql, /Prisma\.join\(searchGroups, " AND "\)/);
  assert.match(source, /q: normalizeCatalogueSearchQuery\(input\.q\)/);
});

test("cross-kind facets fail closed while sealed-only searches can select the Other product type", async () => {
  const source = await appDataSource;
  const combinedSearch = source.slice(
    source.indexOf("async function searchCatalogueItems("),
    source.indexOf("async function searchCardPrintings("),
  );
  const sealedSearch = source.slice(
    source.indexOf("async function searchSealedProducts("),
    source.indexOf("async function searchCardPrintingsByValue("),
  );
  const sealedSql = source.slice(
    source.indexOf("function sealedCatalogueSearchWhere("),
    source.indexOf("function filterAndSortCatalogue("),
  );
  const fallback = source.slice(
    source.indexOf("function filterAndSortCatalogue("),
    source.indexOf("function dashboardSummary("),
  );

  assert.match(sealedSearch, /query\.rarity !== "all" && !facetProductType[\s\S]*?return \[\]/);
  assert.doesNotMatch(sealedSearch, /sealedProductTypeToEnum\(query\.rarity\)/);
  assert.match(sealedSearch, /sealedProductTypeFromSearchTerm\(query\.rarity, query\.type === "sealed"\)/);
  assert.match(sealedSql, /facetProductType[\s\S]*?: Prisma\.sql`FALSE`/);
  assert.match(sealedSql, /sealedProductTypeFromSearchTerm\(query\.rarity, query\.type === "sealed"\)/);
  assert.doesNotMatch(combinedSearch, /type: "sealed"/);
  assert.match(fallback, /item\.type === "sealed"[\s\S]*?query\.type === "sealed"/);
  assert.match(source, /allowOther && normalized === "other"/);

  assert.equal(sealedProductTypeFromSearchTerm("Other"), undefined);
  assert.equal(sealedProductTypeFromSearchTerm("Other", true), SealedProductType.OTHER);
  assert.equal(sealedProductTypeFromSearchTerm("Rare Holo", true), undefined);
});

test("all database builders receive the normalized, token-safe query", async () => {
  const source = await appDataSource;
  const normalization = source.slice(
    source.indexOf("function normalizeCatalogueSearchInput("),
    source.indexOf("function normalizeCatalogueSearchType("),
  );

  assert.match(normalization, /q: normalizeCatalogueSearchQuery\(input\.q\)/);
  assert.equal((source.match(/catalogueSearchTermGroups\(query\.q\)/g) ?? []).length, 2);
  assert.equal((source.match(/catalogueSearchTokens\(query\.q\)/g) ?? []).length >= 2, true);
});
