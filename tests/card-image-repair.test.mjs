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
