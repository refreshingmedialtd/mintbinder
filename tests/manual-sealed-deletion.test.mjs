import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manual sealed allowance counts only deletable private rows", async () => {
  const source = await readFile(new URL("../src/lib/db/app-data.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /sealedProduct\.count\([\s\S]*?createdByUserId: userId, visibility: CatalogueVisibility\.PRIVATE/,
  );
});

test("private sealed deletion is owner scoped and refuses referenced or global products", async () => {
  const [source, route] = await Promise.all([
    readFile(new URL("../src/lib/db/app-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/sealed-products/route.ts", import.meta.url), "utf8"),
  ]);
  const deletion = source.slice(
    source.indexOf("export async function deleteManualSealedProduct"),
    source.indexOf("export async function createWishlistItem"),
  );
  assert.match(deletion, /createdByUserId: userId/);
  assert.match(deletion, /visibility: CatalogueVisibility\.PRIVATE/);
  assert.match(deletion, /collectionItems: true, wishlistItems: true/);
  assert.match(deletion, /Remove this product from collections and wishlists/);
  assert.match(route, /export async function DELETE/);
});
