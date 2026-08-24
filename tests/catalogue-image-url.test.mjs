import assert from "node:assert/strict";
import test from "node:test";

import { isOptimizableCatalogueImageUrl } from "../src/lib/catalogue/image-url.ts";

test("known catalogue image providers and local assets use the image optimizer", () => {
  assert.equal(isOptimizableCatalogueImageUrl("https://images.pokemontcg.io/sv3pt5/199_hires.png"), true);
  assert.equal(isOptimizableCatalogueImageUrl("https://assets.tcgdex.net/en/sv/sv3pt5/199/high.webp"), true);
  assert.equal(isOptimizableCatalogueImageUrl("https://tcgplayer-cdn.tcgplayer.com/product/123_in_1000x1000.jpg"), true);
  assert.equal(isOptimizableCatalogueImageUrl("/binder-placeholder.svg"), true);
});

test("unknown, insecure, and malformed remote sources remain unoptimized", () => {
  assert.equal(isOptimizableCatalogueImageUrl("https://legacy.example/card.png"), false);
  assert.equal(isOptimizableCatalogueImageUrl("http://images.pokemontcg.io/card.png"), false);
  assert.equal(isOptimizableCatalogueImageUrl("//images.pokemontcg.io/card.png"), false);
  assert.equal(isOptimizableCatalogueImageUrl("not a url"), false);
});
