import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVariantMetadataRepairPlan,
  hasAvailablePrices,
  pokemonTcgProviderId,
  repairedVariantMetadata,
  variantMetadataRepairTargets,
} from "../src/lib/catalogue/variant-metadata-repair.ts";

test("collects cards with Pokemon TCG provider IDs and missing available prices", () => {
  assert.deepEqual(
    variantMetadataRepairTargets([
      {
        id: "missing",
        providerIds: { pokemon_tcg_api: "sv3pt5-199" },
        variantMetadata: {},
      },
      {
        id: "empty-array",
        providerIds: { pokemon_tcg_api: "swsh7-215" },
        variantMetadata: { availablePrices: [] },
      },
      {
        id: "complete",
        providerIds: { pokemon_tcg_api: "sv3pt5-193" },
        variantMetadata: { availablePrices: ["holofoil"] },
      },
      {
        id: "missing-provider",
        providerIds: {},
        variantMetadata: {},
      },
    ]),
    [
      { id: "missing", providerId: "sv3pt5-199" },
      { id: "empty-array", providerId: "swsh7-215" },
    ],
  );
});

test("builds variant metadata repair plans from Pokemon TCG price keys", () => {
  const plan = buildVariantMetadataRepairPlan(
    [
      {
        id: "charizard",
        providerIds: { pokemon_tcg_api: "sv3pt5-199" },
        variantMetadata: { finish: "holofoil" },
      },
      {
        id: "no-prices",
        providerIds: { pokemon_tcg_api: "sv3pt5-1" },
        variantMetadata: {},
      },
    ],
    [
      {
        id: "sv3pt5-199",
        cardmarket: { updatedAt: "2026-06-01", url: "https://cardmarket.example/card" },
        tcgplayer: {
          prices: {
            holofoil: { market: 100 },
            reverseHolofoil: { market: 80 },
          },
          updatedAt: "2026-06-01",
          url: "https://tcgplayer.example/card",
        },
      },
      {
        id: "sv3pt5-1",
        tcgplayer: { prices: {} },
      },
    ],
  );

  assert.deepEqual(plan, [
    {
      id: "charizard",
      providerId: "sv3pt5-199",
      variantMetadata: {
        availablePrices: ["holofoil", "reverseHolofoil"],
        cardmarketUpdatedAt: "2026-06-01",
        cardmarketUrl: "https://cardmarket.example/card",
        finish: "holofoil",
        provider: "pokemon-tcg-api",
        tcgplayerUpdatedAt: "2026-06-01",
        tcgplayerUrl: "https://tcgplayer.example/card",
      },
    },
  ]);
});

test("recognizes existing variant metadata and provider IDs", () => {
  assert.equal(hasAvailablePrices({ availablePrices: ["normal"] }), true);
  assert.equal(hasAvailablePrices({ availablePrices: [""] }), false);
  assert.equal(pokemonTcgProviderId({ pokemon_tcg_api: " swsh7-215 " }), "swsh7-215");
  assert.equal(pokemonTcgProviderId({ tcgcsv: "100" }), undefined);
  assert.equal(repairedVariantMetadata({ id: "bad", tcgplayer: { prices: {} } }), null);
});
