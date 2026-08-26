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
