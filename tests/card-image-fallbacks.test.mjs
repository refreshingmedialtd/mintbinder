import assert from "node:assert/strict";
import test from "node:test";

import {
  cardImageCandidates,
  catalogueItemImageCandidates,
  scrydexCardImageUrlFromProviderIds,
} from "../src/lib/catalogue/card-images.ts";

test("derives a reviewed ScryDex fallback from an English catalogue provider ID", () => {
  assert.equal(
    scrydexCardImageUrlFromProviderIds({ pokemon_tcg_api: "mcd14-2" }),
    "https://images.scrydex.com/pokemon/mcd14-2/medium",
  );
  assert.equal(scrydexCardImageUrlFromProviderIds({ pokemon_tcg_api: "invalid" }), undefined);
  assert.equal(scrydexCardImageUrlFromProviderIds(null), undefined);
});

test("known-bad promotion artwork fails over to independent reviewed image hosts", () => {
  assert.deepEqual(cardImageCandidates({
    imageLargeUrl: "https://images.pokemontcg.io/mcd18/1_hires.png",
    imageSmallUrl: "https://images.pokemontcg.io/mcd18/1.png",
    prices: [{ source: "tcgcsv-card", sourceRef: "180450" }],
    providerIds: { pokemon_tcg_api: "mcd18-1" },
  }), [
    "https://images.scrydex.com/pokemon/mcd18-1/medium",
    "https://tcgplayer-cdn.tcgplayer.com/product/180450_in_1000x1000.jpg",
  ]);
});

test("the UI keeps every distinct candidate so one failed CDN URL does not become No image", () => {
  assert.deepEqual(catalogueItemImageCandidates({
    id: "card-1",
    type: "card",
    name: "Chespin",
    set: "McDonald's Collection 2014",
    number: "2",
    rarity: "Promo",
    image: "https://primary.example/card.png",
    imageFallbacks: [
      "https://primary.example/card.png",
      "https://images.scrydex.com/pokemon/mcd14-2/medium",
    ],
    hasPrice: true,
    valueMinor: 1_003,
    confidence: "Fair",
  }), [
    "https://primary.example/card.png",
    "https://images.scrydex.com/pokemon/mcd14-2/medium",
  ]);
});
