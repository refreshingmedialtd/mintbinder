import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const setDetailSource = pageSource.slice(
  pageSource.indexOf("function SetDetailScreen("),
  pageSource.indexOf("type SetBuilderChase"),
);

test("set cards open the in-place collection form instead of the generic Add screen", () => {
  assert.match(setDetailSource, /setAddItemId\(item\.id\)/);
  assert.match(setDetailSource, /<SetCollectionAddModal/);
  assert.doesNotMatch(setDetailSource, /navigate\("add"\)/);
});

test("saving from a set preserves the set screen and closes only after success", () => {
  assert.match(setDetailSource, /addToCollection\(addItem\.id, formData, \{ navigateToItem: false \}\)/);
  assert.match(setDetailSource, /if \(saved\) \{\s*setAddItemId\(null\)/);
});

test("the direct-add dialog captures the exact lot identity and collection details", () => {
  for (const field of [
    "variant",
    "condition",
    "language",
    "quantity",
    "location",
    "purchaseDate",
    "paid",
    "overrideValue",
    "valuationNote",
    "notes",
  ]) {
    assert.match(setDetailSource, new RegExp(`name=["']${field}["']`), `missing ${field} field`);
  }

  assert.match(setDetailSource, /Add another/);
  assert.match(setDetailSource, /Estimated lot value/);
  assert.match(setDetailSource, /useDialogFocus<HTMLElement>\(true\)/);
});
