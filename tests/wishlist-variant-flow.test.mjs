import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { wishlistMatchesOwnedVariant } from "../src/lib/wishlist-variant.ts";

test("an exact wishlist finish is only cleared by the same owned finish", () => {
  const holofoil = { catalogueId: "card-1", variant: "Holofoil" };

  assert.equal(wishlistMatchesOwnedVariant(holofoil, "card-1", "Normal"), false);
  assert.equal(wishlistMatchesOwnedVariant(holofoil, "card-1", "holo foil"), true);
  assert.equal(wishlistMatchesOwnedVariant(holofoil, "card-2", "Holofoil"), false);
  assert.equal(
    wishlistMatchesOwnedVariant({ catalogueId: "card-1" }, "card-1", "Reverse Holofoil"),
    true,
  );
});

test("add and wishlist conversion flows carry an explicit catalogue finish", () => {
  const source = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /selectedCatalogueVariant: row\.item\.variant \?\? ""/);
  assert.match(source, /addToWishlist\(itemId, selected\?\.id === itemId \? selectedVariant : undefined\)/);
  assert.match(source, /defaultWishlistVariant\(catalogueItem\) \?\? selectedVariantLabel\(catalogueItem\)/);
  assert.doesNotMatch(source, /catalogueItem\.type === "sealed" \? "Factory sealed" : "Standard"/);
});

test("wishlist-to-owned conversion finishes its persisted delete before refreshing", () => {
  const source = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const addFlow = source.slice(
    source.indexOf("async function addToCollection"),
    source.indexOf("async function createManualSealedProduct"),
  );

  const deleteAt = addFlow.indexOf("await removeWishlistItem(matchingWishlist.id, { quiet: true })");
  const refreshAt = addFlow.indexOf("void refreshAppData({ quiet: true })");

  assert.ok(deleteAt >= 0, "conversion must wait for the persisted wishlist deletion");
  assert.ok(refreshAt > deleteAt, "rehydration must start after the deletion outcome is known");
  assert.match(addFlow, /wishlistRemoved[\s\S]*wishlist target could not be removed/);
  assert.doesNotMatch(addFlow, /void removeWishlistItem\(matchingWishlist\.id/);
});
