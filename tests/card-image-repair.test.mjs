import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCardImageRepairPlan,
  pokemonTcgImageUrlsFromProviderIds,
} from "../src/lib/catalogue/image-repair.ts";

test("derives Pokemon TCG small and large image URLs from provider IDs", () => {
  assert.deepEqual(
    pokemonTcgImageUrlsFromProviderIds({ pokemon_tcg_api: "sv3pt5-199" }),
    {
      large: "https://images.pokemontcg.io/sv3pt5/199_hires.png",
      providerId: "sv3pt5-199",
      small: "https://images.pokemontcg.io/sv3pt5/199.png",
    },
  );
  assert.equal(pokemonTcgImageUrlsFromProviderIds({ pokemon_tcg_api: "bad" }), undefined);
  assert.equal(pokemonTcgImageUrlsFromProviderIds({ pokemon_tcg_api: "mcd18-1" }), undefined);
});

test("plans repairs for missing card image fields without overwriting existing URLs", () => {
  const plan = buildCardImageRepairPlan([
    {
      id: "missing-both",
      imageLargeUrl: null,
      imageSmallUrl: "",
      providerIds: { pokemon_tcg_api: "sv3pt5-199" },
    },
    {
      id: "missing-small",
      imageLargeUrl: "https://cdn.example/card-hires.png",
      imageSmallUrl: null,
      providerIds: { pokemon_tcg_api: "swsh7-215" },
    },
    {
      id: "complete",
      imageLargeUrl: "https://cdn.example/large.png",
      imageSmallUrl: "https://cdn.example/small.png",
      providerIds: { pokemon_tcg_api: "swsh12pt5-160" },
    },
    {
      id: "malformed-provider",
      imageLargeUrl: null,
      imageSmallUrl: null,
      providerIds: { pokemon_tcg_api: "bad" },
    },
  ]);

  assert.deepEqual(plan, [
    {
      id: "missing-both",
      imageLargeUrl: "https://images.pokemontcg.io/sv3pt5/199_hires.png",
      imageSmallUrl: "https://images.pokemontcg.io/sv3pt5/199.png",
      providerId: "sv3pt5-199",
    },
    {
      id: "missing-small",
      imageSmallUrl: "https://images.pokemontcg.io/swsh7/215.png",
      providerId: "swsh7-215",
    },
  ]);
});

test("repairs known Pokemon TCG card-back placeholders from TCGCSV product images", () => {
  const plan = buildCardImageRepairPlan(
    [
      {
        id: "mcd18-1",
        imageLargeUrl: "https://images.pokemontcg.io/mcd18/1_hires.png",
        imageSmallUrl: "https://images.pokemontcg.io/mcd18/1.png",
        name: "Growlithe",
        number: "1",
        providerIds: { pokemon_tcg_api: "mcd18-1" },
      },
    ],
    new Map([
      [
        "mcd18",
        [
          {
            extendedData: [{ name: "Number", value: "001/012" }],
            imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/180450_200w.jpg",
            name: "Growlithe - 1/12",
            productId: 180450,
          },
        ],
      ],
    ]),
  );

  assert.deepEqual(plan, [
    {
      id: "mcd18-1",
      imageLargeUrl: "https://tcgplayer-cdn.tcgplayer.com/product/180450_in_1000x1000.jpg",
      imageSmallUrl: "https://tcgplayer-cdn.tcgplayer.com/product/180450_200w.jpg",
      providerId: "mcd18-1",
    },
  ]);
});
