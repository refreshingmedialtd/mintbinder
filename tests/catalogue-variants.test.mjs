import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCatalogueVariantOptions,
  catalogueValueMinorForVariant,
  catalogueVariantLabels,
  displayVariantLabel,
  pokemonTcgImageUrlFromProviderIds,
} from "../src/lib/catalogue/variants.ts";

const priceHistory = [
  {
    observedAt: "2026-04-01T00:00:00.000Z",
    valueMinor: 1000,
    confidence: "Fair",
    source: "pokemon-tcg-api",
    variantLabel: "Holofoil",
  },
  {
    observedAt: "2026-05-01T00:00:00.000Z",
    valueMinor: 1200,
    confidence: "Strong",
    source: "pokemon-tcg-api",
    variantLabel: "Holofoil",
  },
  {
    observedAt: "2026-05-01T00:00:00.000Z",
    valueMinor: 800,
    confidence: "Fair",
    source: "pokemon-tcg-api",
    variantLabel: "Reverse Holofoil",
  },
];

test("builds catalogue variant options from prices and metadata", () => {
  const options = buildCatalogueVariantOptions({
    itemType: "card",
    priceHistory,
    variantMetadata: {
      availablePrices: ["reverseHolofoil", "holofoil", "normal"],
    },
  });

  assert.deepEqual(
    options.map((option) => option.label),
    ["Normal", "Holofoil", "Reverse Holofoil"],
  );
  assert.equal(options[1].valueMinor, 1200);
  assert.equal(options[1].confidence, "Strong");
  assert.equal(options[2].valueMinor, 800);
});

test("keeps existing custom variants in selector labels", () => {
  assert.deepEqual(
    catalogueVariantLabels(
      {
        id: "card-1",
        type: "card",
        name: "Test Card",
        set: "Test Set",
        number: "1/1",
        rarity: "Rare",
        valueMinor: 1200,
        confidence: "Fair",
        variantOptions: [{ label: "Holofoil" }],
      },
      "Stamped promo",
    ),
    ["Holofoil", "Stamped promo"],
  );
});

test("does not add generic standard labels when imported variants exist", () => {
  assert.deepEqual(
    catalogueVariantLabels({
      id: "card-1",
      type: "card",
      name: "Test Card",
      set: "Test Set",
      number: "1/1",
      rarity: "Rare",
      valueMinor: 1200,
      confidence: "Fair",
      variantOptions: [{ label: "Normal" }, { label: "Reverse Holofoil" }],
    }),
    ["Normal", "Reverse Holofoil"],
  );
});

test("uses variant price when valuing a catalogue item", () => {
  const item = {
    id: "card-1",
    type: "card",
    name: "Test Card",
    set: "Test Set",
    number: "1/1",
    rarity: "Rare",
    valueMinor: 1200,
    confidence: "Fair",
    priceHistory,
  };

  assert.equal(catalogueValueMinorForVariant(item, "Reverse Holofoil"), 800);
  assert.equal(catalogueValueMinorForVariant(item, "Normal"), undefined);
});

test("infers legacy Base Set variants without inventing prices", () => {
  const options = buildCatalogueVariantOptions({
    itemType: "card",
    rarity: "Rare Holo",
    setName: "Base",
    variantMetadata: {
      availablePrices: ["holofoil"],
    },
  });

  assert.deepEqual(
    options.map((option) => option.label),
    ["Unlimited Holofoil", "1st Edition Holofoil", "Shadowless Holofoil"],
  );
  assert.equal(options[0].valueMinor, undefined);
});

test("treats provider legacy Base Set prices as unlimited prints", () => {
  const legacyPriceHistory = priceHistory.filter((point) => point.variantLabel === "Holofoil");
  const options = buildCatalogueVariantOptions({
    itemType: "card",
    priceHistory: legacyPriceHistory,
    rarity: "Rare Holo",
    setName: "Base",
  });

  assert.deepEqual(
    options.map((option) => option.label),
    ["Unlimited Holofoil", "1st Edition Holofoil", "Shadowless Holofoil"],
  );
  assert.equal(options[0].valueMinor, 1200);
});

test("infers standard modern finishes when provider metadata is thin", () => {
  assert.deepEqual(
    buildCatalogueVariantOptions({
      itemType: "card",
      rarity: "Common",
      setName: "Chaos Rising",
    }).map((option) => option.label),
    ["Normal", "Reverse Holofoil"],
  );

  assert.deepEqual(
    buildCatalogueVariantOptions({
      itemType: "card",
      rarity: "Double Rare",
      setName: "Ascended Heroes",
    }).map((option) => option.label),
    ["Holofoil"],
  );
});

test("derives Pokemon TCG image URLs from provider IDs", () => {
  assert.equal(
    pokemonTcgImageUrlFromProviderIds({ pokemon_tcg_api: "sv3pt5-199" }),
    "https://images.pokemontcg.io/sv3pt5/199_hires.png",
  );
  assert.equal(pokemonTcgImageUrlFromProviderIds({ pokemon_tcg_api: "bad" }), undefined);
});

test("formats provider variant keys for display", () => {
  assert.equal(displayVariantLabel("reverseHolofoil"), "Reverse Holofoil");
  assert.equal(displayVariantLabel("1stEditionHolofoil"), "1st Edition Holofoil");
});
