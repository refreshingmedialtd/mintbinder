import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCatalogueVariantOptions,
  canonicalCataloguePriceHistory,
  catalogueValueMinorForVariant,
  catalogueVariantSelectionLabel,
  catalogueVariantWriteLabel,
  catalogueVariantLabels,
  displayVariantLabel,
  pokemonTcgImageUrlFromProviderIds,
} from "../src/lib/catalogue/variants.ts";
import { catalogueVariantPriceRows } from "../src/lib/catalogue/variant-price-rows.ts";

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
  assert.equal(options[1].confidence, "Weak");
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

test("keeps exact variant prices distinct in catalogue display rows", () => {
  const rows = catalogueVariantPriceRows({
    id: "card-1",
    type: "card",
    name: "Weedle",
    set: "Chaos Rising",
    number: "1",
    rarity: "Common",
    hasPrice: true,
    valueMinor: 15,
    confidence: "Weak",
    variantOptions: [
      { label: "Normal", valueMinor: 9 },
      { label: "Reverse Holofoil", valueMinor: 15 },
      { label: "Staff stamp" },
    ],
  });

  assert.deepEqual(rows.map(({ label, valueMinor }) => ({ label, valueMinor })), [
    { label: "Normal", valueMinor: 9 },
    { label: "Reverse Holofoil", valueMinor: 15 },
    { label: "Staff stamp", valueMinor: undefined },
  ]);
});

test("uses a clearly labelled generic estimate only when variants are absent", () => {
  const rows = catalogueVariantPriceRows({
    id: "card-1",
    type: "card",
    name: "Test Card",
    set: "Test Set",
    number: "1",
    rarity: "Rare",
    hasPrice: true,
    valueMinor: 1200,
    confidence: "Fair",
    priceSource: "pokemon-tcg-api",
  });

  assert.deepEqual(rows, [{
    confidence: "Fair",
    label: "Market estimate",
    observedAt: undefined,
    source: "pokemon-tcg-api",
    valueMinor: 1200,
  }]);
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

test("treats legacy Rare Ultra ordering as a premium holo-only rarity", () => {
  const item = {
    id: "team-up-170",
    type: "card",
    name: "Latias & Latios-GX",
    set: "Team Up",
    number: "170",
    rarity: "Rare Ultra",
    hasPrice: true,
    valueMinor: 83_960,
    confidence: "Fair",
    priceHistory: [{
      confidence: "Fair",
      observedAt: "2026-08-25T07:58:05.637Z",
      source: "pokemon-tcg-api-cardmarket",
      valueMinor: 83_960,
      variantLabel: "Holofoil",
    }],
  };
  item.variantOptions = buildCatalogueVariantOptions({
    itemType: item.type,
    priceHistory: item.priceHistory,
    rarity: item.rarity,
    setName: item.set,
    variantMetadata: { availablePrices: ["holofoil"] },
  });

  assert.deepEqual(item.variantOptions.map((option) => option.label), ["Holofoil"]);
  assert.equal(catalogueVariantSelectionLabel(item, undefined), "Holofoil");
  assert.equal(catalogueVariantSelectionLabel(item, "Normal"), "Holofoil");
  assert.equal(catalogueValueMinorForVariant(item, "Normal"), 83_960);

  const legitimateNormal = {
    ...item,
    priceHistory: [
      ...item.priceHistory,
      {
        confidence: "Fair",
        observedAt: "2026-08-25T07:58:05.637Z",
        source: "pokemon-tcg-api-cardmarket",
        valueMinor: 50_000,
        variantLabel: "Normal",
      },
    ],
    variantOptions: [
      { label: "Normal", valueMinor: 50_000 },
      { label: "Holofoil", valueMinor: 83_960 },
    ],
  };
  assert.equal(catalogueVariantSelectionLabel(legitimateNormal, "Normal"), "Normal");
  assert.equal(catalogueValueMinorForVariant(legitimateNormal, "Normal"), 50_000);
});

test("repairs premium legacy defaults despite noisy unpriced metadata", () => {
  const item = {
    id: "sv10-290",
    type: "card",
    name: "Mega Dragonite ex",
    set: "Ascended Heroes",
    number: "290",
    rarity: "Special Illustration Rare",
    hasPrice: true,
    valueMinor: 48_934,
    confidence: "Fair",
    priceHistory: [{
      confidence: "Fair",
      observedAt: "2026-09-03T09:00:00.000Z",
      source: "tcgcsv-card",
      valueMinor: 48_934,
      variantLabel: "Holofoil",
    }],
    variantOptions: [
      { label: "Normal" },
      { label: "Holofoil", valueMinor: 48_934 },
      { label: "Reverse Holofoil" },
    ],
  };

  assert.equal(catalogueVariantSelectionLabel(item, "Normal"), "Holofoil");
  assert.equal(catalogueVariantSelectionLabel(item, "Standard"), "Holofoil");
  assert.equal(catalogueVariantWriteLabel(item), "Holofoil");
  assert.equal(catalogueValueMinorForVariant(item, "Standard"), 48_934);
});

test("maps historical card Standard to priced Normal without changing explicit card semantics", () => {
  const item = {
    id: "sv11-32",
    type: "card",
    name: "Pawmi",
    set: "Phantasmal Flames",
    number: "32",
    rarity: "Common",
    hasPrice: true,
    valueMinor: 7,
    confidence: "Weak",
    priceHistory: [{
      confidence: "Weak",
      observedAt: "2026-09-03T09:00:00.000Z",
      source: "tcgcsv-card",
      valueMinor: 7,
      variantLabel: "Normal",
    }],
    variantOptions: [{ label: "Normal", valueMinor: 7 }, { label: "Reverse Holofoil" }],
  };

  assert.equal(catalogueVariantSelectionLabel(item, "Standard"), "Normal");
  assert.equal(catalogueValueMinorForVariant(item, "Standard"), 7);
  assert.equal(catalogueVariantSelectionLabel(item, "Reverse Holofoil"), "Reverse Holofoil");
  assert.equal(catalogueValueMinorForVariant(item, "Reverse Holofoil"), undefined);
});

test("collapses sealed marketplace aliases into one Factory sealed option and history", () => {
  const aliases = [
    "Normal",
    "Standard",
    "Sealed",
    "Factory sealed",
    "New / sealed",
    "Unopened / sealed",
  ];
  const history = aliases.map((variantLabel, index) => ({
    confidence: "Fair",
    observedAt: `2026-08-${String(index + 1).padStart(2, "0")}T09:00:00.000Z`,
    source: `provider-${index}`,
    valueMinor: 2_600 + index,
    variantLabel,
  }));
  const options = buildCatalogueVariantOptions({ itemType: "sealed", priceHistory: history });
  const item = {
    id: "sealed-bundle",
    type: "sealed",
    name: "Chaos Rising Booster Bundle",
    set: "Chaos Rising",
    number: "Sealed",
    rarity: "Booster Bundle",
    hasPrice: true,
    valueMinor: 2_605,
    confidence: "Fair",
    priceHistory: history,
    variantOptions: options,
  };

  assert.deepEqual(options.map((option) => option.label), ["Factory sealed"]);
  assert.equal(canonicalCataloguePriceHistory("sealed", history).every(
    (point) => point.variantLabel === "Factory sealed",
  ), true);
  for (const alias of aliases) {
    assert.equal(catalogueVariantSelectionLabel(item, alias), "Factory sealed");
    assert.notEqual(catalogueValueMinorForVariant(item, alias), undefined);
  }

  // The same labels retain their raw-card meaning outside sealed products.
  assert.equal(canonicalCataloguePriceHistory("card", history), history);
});

test("collection search indexes the effective catalogue finish", async () => {
  const source = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const collection = source.slice(
    source.indexOf("function CollectionScreen("),
    source.indexOf("function BindersScreen("),
  );

  assert.match(collection, /selectedVariantLabel\(catalogueItem, item\.variant\)/);
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

test("builds catalogue variant options from TCGdex variant metadata", () => {
  const options = buildCatalogueVariantOptions({
    itemType: "card",
    variantMetadata: {
      variants: {
        firstEdition: true,
        normal: true,
        reverse: true,
        wPromo: true,
      },
      variantsDetailed: [
        { size: "standard", type: "holo" },
        { size: "jumbo", type: "normal" },
      ],
    },
  });

  assert.deepEqual(
    options.map((option) => option.label),
    ["Normal", "Holofoil", "Reverse Holofoil", "1st Edition", "Jumbo", "Promo Stamp"],
  );
});
