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
  preferredCatalogueHeadlinePricePoint,
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

test("uses the regular canonically ordered printing for the card headline", () => {
  const tyruntHistory = [
    {
      observedAt: "2026-09-11T12:00:00.000Z",
      valueMinor: 191,
      confidence: "Weak",
      source: "tcgcsv-card",
      variantLabel: "Holofoil",
    },
    {
      observedAt: "2026-09-11T12:01:00.000Z",
      valueMinor: 2202,
      confidence: "Weak",
      source: "tcgcsv-card",
      variantLabel: "Pokémon Center Stamp Holofoil",
    },
  ];
  const variantOptions = buildCatalogueVariantOptions({
    itemType: "card",
    priceHistory: tyruntHistory,
    rarity: "Promo",
    setName: "Mega Evolution Promo",
    variantMetadata: {
      reviewedVariants: ["Holofoil", "Pokémon Center Stamp Holofoil"],
    },
  });

  assert.deepEqual(
    variantOptions.map(({ label, valueMinor }) => ({ label, valueMinor })),
    [
      { label: "Holofoil", valueMinor: 191 },
      { label: "Pokémon Center Stamp Holofoil", valueMinor: 2202 },
    ],
  );
  assert.equal(
    preferredCatalogueHeadlinePricePoint({
      rarity: "Promo",
      set: "Mega Evolution Promo",
      type: "card",
      variantOptions,
    }, tyruntHistory)?.valueMinor,
    191,
  );
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

test("uses metadata-only holo evidence instead of a non-holo vintage rarity", () => {
  const options = buildCatalogueVariantOptions({
    itemType: "card",
    rarity: "Rare",
    setName: "Team Rocket",
    variantMetadata: {
      availablePrices: ["1stEditionHolofoil", "unlimitedHolofoil"],
    },
  });

  assert.deepEqual(
    options.map((option) => option.label),
    ["Unlimited Holofoil", "1st Edition Holofoil"],
  );
});

test("uses history-only holo evidence instead of a non-holo vintage rarity", () => {
  const options = buildCatalogueVariantOptions({
    itemType: "card",
    priceHistory: [{
      confidence: "Weak",
      observedAt: "2026-09-05T22:01:50.661Z",
      source: "tcgcsv-card",
      valueMinor: 9208,
      variantLabel: "Unlimited Holofoil",
    }],
    rarity: "Rare",
    setName: "Neo Destiny",
  });

  assert.deepEqual(
    options.map(({ label, valueMinor }) => ({ label, valueMinor })),
    [
      { label: "Unlimited Holofoil", valueMinor: 9208 },
      { label: "1st Edition Holofoil", valueMinor: undefined },
    ],
  );
});

test("canonicalizes a generic priced vintage finish with the same evidence used for editions", () => {
  const priceHistory = [{
    confidence: "Weak",
    observedAt: "2026-09-05T22:01:50.661Z",
    source: "tcgcsv-card",
    valueMinor: 9208,
    variantLabel: "Holofoil",
  }];
  const options = buildCatalogueVariantOptions({
    itemType: "card",
    priceHistory,
    rarity: "Rare",
    setName: "Team Rocket",
    variantMetadata: {
      availablePrices: ["holofoil"],
    },
  });
  const item = {
    id: "base5-83",
    type: "card",
    name: "Dark Raichu",
    set: "Team Rocket",
    number: "83",
    rarity: "Rare",
    hasPrice: true,
    valueMinor: 9208,
    confidence: "Weak",
    priceHistory,
    variantOptions: options,
  };

  assert.deepEqual(
    options.map(({ label, valueMinor }) => ({ label, valueMinor })),
    [
      { label: "Unlimited Holofoil", valueMinor: 9208 },
      { label: "1st Edition Holofoil", valueMinor: undefined },
    ],
  );
  assert.equal(catalogueValueMinorForVariant(item, "Unlimited Holofoil"), 9208);
  assert.equal(catalogueValueMinorForVariant(item, "1st Edition Holofoil"), undefined);
});

test("repairs stale Dark Raichu defaults without borrowing prices across editions", () => {
  const pricePoint = (variantLabel, valueMinor) => ({
    confidence: "Weak",
    observedAt: "2026-09-05T22:01:50.661Z",
    source: "tcgcsv-card",
    valueMinor,
    variantLabel,
  });
  const itemWithHistory = (priceHistory) => ({
    id: "base5-83",
    type: "card",
    name: "Dark Raichu",
    set: "Team Rocket",
    number: "83",
    rarity: "Rare",
    hasPrice: true,
    valueMinor: priceHistory[0].valueMinor,
    confidence: "Weak",
    priceHistory,
    variantOptions: buildCatalogueVariantOptions({
      itemType: "card",
      priceHistory,
      rarity: "Rare",
      setName: "Team Rocket",
    }),
  });
  const unlimited = itemWithHistory([
    pricePoint("Unlimited Holofoil", 9208),
  ]);

  assert.equal(catalogueVariantSelectionLabel(unlimited, "Normal"), "Unlimited Holofoil");
  assert.equal(catalogueVariantSelectionLabel(unlimited, "Standard"), "Unlimited Holofoil");
  assert.equal(catalogueVariantWriteLabel(unlimited), "Unlimited Holofoil");
  assert.equal(catalogueValueMinorForVariant(unlimited, "Normal"), 9208);
  assert.equal(catalogueValueMinorForVariant(unlimited, "Standard"), 9208);
  assert.equal(catalogueValueMinorForVariant(unlimited, "1st Edition Holofoil"), undefined);

  const firstEdition = itemWithHistory([
    pricePoint("1st Edition Holofoil", 18_416),
  ]);

  assert.equal(catalogueVariantWriteLabel(firstEdition), "Unlimited Holofoil");
  assert.equal(catalogueValueMinorForVariant(firstEdition, "Normal"), undefined);
  assert.equal(catalogueValueMinorForVariant(firstEdition, "1st Edition Holofoil"), 18_416);
});

test("treats historical Standard as neutral finish evidence for Dark Raichu", () => {
  const priceHistory = [{
    confidence: "Weak",
    observedAt: "2026-09-05T22:01:50.661Z",
    source: "pokemon-tcg-api-cardmarket",
    valueMinor: 9208,
    variantLabel: "Standard",
  }];
  const variantOptions = buildCatalogueVariantOptions({
    itemType: "card",
    priceHistory,
    rarity: "Rare Secret",
    setName: "Team Rocket",
  });
  const item = {
    id: "base5-83",
    type: "card",
    name: "Dark Raichu",
    set: "Team Rocket",
    number: "83",
    rarity: "Rare Secret",
    hasPrice: true,
    valueMinor: 9208,
    confidence: "Weak",
    priceHistory,
    variantOptions,
  };

  assert.deepEqual(
    variantOptions.map(({ label, valueMinor }) => ({ label, valueMinor })),
    [
      { label: "Unlimited Holofoil", valueMinor: 9208 },
      { label: "1st Edition Holofoil", valueMinor: undefined },
    ],
  );
  assert.equal(catalogueVariantWriteLabel(item), "Unlimited Holofoil");
  assert.equal(catalogueValueMinorForVariant(item, "Standard"), 9208);
  assert.equal(catalogueValueMinorForVariant(item, "1st Edition Holofoil"), undefined);

  const conflictedOptions = buildCatalogueVariantOptions({
    itemType: "card",
    priceHistory,
    rarity: "Rare Secret",
    setName: "Team Rocket",
    variantMetadata: {
      availablePrices: ["1stEditionNormal", "unlimitedHolofoil"],
    },
  });
  const conflictedItem = {
    ...item,
    variantOptions: conflictedOptions,
  };

  assert.equal(conflictedOptions.some((option) => option.label === "Standard"), true);
  assert.equal(catalogueValueMinorForVariant(conflictedItem, "Unlimited Holofoil"), undefined);
});

test("recognizes composite non-holo keys as normal vintage finish evidence", () => {
  const options = buildCatalogueVariantOptions({
    itemType: "card",
    rarity: "Rare Holo",
    setName: "Team Rocket",
    variantMetadata: {
      availablePrices: ["1stEditionNormal", "unlimitedNormal"],
    },
  });

  assert.deepEqual(
    options.map((option) => option.label),
    ["Unlimited", "1st Edition"],
  );
});

test("rejects inference when composite normal and holo metadata conflict", () => {
  const options = buildCatalogueVariantOptions({
    itemType: "card",
    rarity: "Rare Secret",
    setName: "Team Rocket",
    variantMetadata: {
      availablePrices: ["1stEditionNormal", "unlimitedHolofoil"],
    },
  });

  assert.deepEqual(
    options.map((option) => option.label),
    ["Unlimited Holofoil", "1st Edition"],
  );
  assert.equal(options.some((option) => option.label === "Unlimited"), false);
  assert.equal(options.some((option) => option.label === "1st Edition Holofoil"), false);

  const item = {
    id: "base5-83",
    type: "card",
    name: "Dark Raichu",
    set: "Team Rocket",
    number: "83",
    rarity: "Rare Secret",
    hasPrice: false,
    valueMinor: 0,
    confidence: "Unpriced",
    variantOptions: options,
  };

  assert.equal(catalogueVariantSelectionLabel(item, "Normal"), "Normal");
  assert.equal(catalogueVariantWriteLabel(item), "Standard");
});

test("combines metadata and history evidence so cross-source conflicts fail closed", () => {
  const options = buildCatalogueVariantOptions({
    itemType: "card",
    priceHistory: [{
      confidence: "Weak",
      observedAt: "2026-09-05T22:01:50.661Z",
      source: "tcgcsv-card",
      valueMinor: 9208,
      variantLabel: "Unlimited Holofoil",
    }],
    rarity: "Rare",
    setName: "Team Rocket",
    variantMetadata: {
      availablePrices: ["1stEditionNormal"],
    },
  });

  assert.deepEqual(
    options.map(({ label, valueMinor }) => ({ label, valueMinor })),
    [
      { label: "Unlimited Holofoil", valueMinor: 9208 },
      { label: "1st Edition", valueMinor: undefined },
    ],
  );
  assert.equal(options.some((option) => option.label === "Unlimited"), false);
  assert.equal(options.some((option) => option.label === "1st Edition Holofoil"), false);

  const genericHistory = [{
    confidence: "Weak",
    observedAt: "2026-09-05T22:01:50.661Z",
    source: "tcgcsv-card",
    valueMinor: 5000,
    variantLabel: "Holofoil",
  }];
  const genericOptions = buildCatalogueVariantOptions({
    itemType: "card",
    priceHistory: genericHistory,
    rarity: "Rare",
    setName: "Team Rocket",
    variantMetadata: {
      availablePrices: ["1stEditionNormal"],
    },
  });
  const genericItem = {
    id: "conflicted-card",
    type: "card",
    name: "Conflicted card",
    set: "Team Rocket",
    number: "1",
    rarity: "Rare",
    hasPrice: true,
    valueMinor: 5000,
    confidence: "Weak",
    priceHistory: genericHistory,
    variantOptions: genericOptions,
  };

  assert.deepEqual(genericOptions.map((option) => option.label), ["Holofoil", "1st Edition"]);
  assert.equal(catalogueValueMinorForVariant(genericItem, "Unlimited Holofoil"), undefined);
});

test("does not infer reverse-holo editions for no-reverse WotC sets", () => {
  const options = buildCatalogueVariantOptions({
    itemType: "card",
    rarity: "Rare",
    setName: "Team Rocket",
    variantMetadata: {
      availablePrices: ["reverseHolofoil"],
    },
  });

  assert.deepEqual(options.map((option) => option.label), ["Reverse Holofoil"]);
  assert.equal(options.some((option) => /edition reverse|unlimited reverse/i.test(option.label)), false);
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

test("keeps TCGdex Pokemon Center stamped holos distinct from the regular holo", () => {
  const options = buildCatalogueVariantOptions({
    itemType: "card",
    setName: "MEP Black Star Promos",
    variantMetadata: {
      variants: {
        holo: true,
      },
      variantsDetailed: [
        { size: "standard", type: "holo" },
        { size: "standard", stamp: ["pokemon-center"], type: "holo" },
      ],
    },
  });

  assert.deepEqual(
    options.map((option) => option.label),
    ["Holofoil", "Pokémon Center Stamp Holofoil"],
  );
});

test("preserves set-logo stamps, patterned reverse holos, and stamped jumbo identities", () => {
  const whiteFlare = buildCatalogueVariantOptions({
    itemType: "card",
    setName: "White Flare",
    variantMetadata: {
      variants: {
        holo: true,
        reverse: true,
      },
      variantsDetailed: [
        { size: "standard", type: "holo" },
        { size: "standard", type: "reverse" },
        { foil: "pokeball", size: "standard", type: "reverse" },
        { foil: "masterball", size: "standard", type: "reverse" },
        { size: "standard", stamp: ["set-logo"], type: "holo" },
      ],
    },
  });
  const stellarCrown = buildCatalogueVariantOptions({
    itemType: "card",
    setName: "Stellar Crown",
    variantMetadata: {
      variants: { holo: true },
      variantsDetailed: [
        { size: "standard", type: "holo" },
        { size: "standard", stamp: ["set-logo"], type: "holo" },
        { size: "jumbo", stamp: ["set-logo"], type: "holo" },
      ],
    },
  });

  assert.deepEqual(
    whiteFlare.map((option) => option.label),
    [
      "Holofoil",
      "Reverse Holofoil",
      "Master Ball Reverse Holofoil",
      "Poke Ball Reverse Holofoil",
      "Set Logo Stamp Holofoil",
    ],
  );
  assert.deepEqual(
    stellarCrown.map((option) => option.label),
    [
      "Holofoil",
      "Jumbo Set Logo Stamp Holofoil",
      "Set Logo Stamp Holofoil",
    ],
  );
});

test("lets an explicit reviewed variant list replace ambiguous TCGdex detail labels", () => {
  const options = buildCatalogueVariantOptions({
    itemType: "card",
    setName: "White Flare",
    variantMetadata: {
      reviewedVariants: [
        { label: "Holofoil" },
        { label: "Reverse Holofoil" },
        { label: "White Flare Stamp Holofoil" },
      ],
      variants: {
        holo: true,
        reverse: true,
      },
      variantsDetailed: [
        { size: "standard", stamp: ["set-logo"], type: "holo" },
      ],
    },
  });

  assert.deepEqual(
    options.map((option) => option.label),
    ["Holofoil", "Reverse Holofoil", "White Flare Stamp Holofoil"],
  );
  assert.equal(
    options.some((option) => option.label === "Set Logo Stamp Holofoil"),
    false,
  );
});

test("combines a sole TCGdex finish with its first-edition flag", () => {
  const options = buildCatalogueVariantOptions({
    itemType: "card",
    rarity: "Rare",
    setName: "Team Rocket",
    variantMetadata: {
      variants: {
        firstEdition: true,
        holo: true,
      },
    },
  });

  assert.deepEqual(
    options.map((option) => option.label),
    ["Unlimited Holofoil", "1st Edition Holofoil"],
  );
});
