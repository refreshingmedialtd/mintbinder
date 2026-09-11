import assert from "node:assert/strict";
import test from "node:test";
import { catalogueSearchTermGroups } from "../src/lib/catalogue/search-query.ts";
import { buildCatalogueVariantOptions } from "../src/lib/catalogue/variants.ts";
import {
  reviewedTcgcsvCatalogueTargets,
  syncReviewedTcgcsvCardCatalogue,
} from "../scripts/reviewed-tcgcsv-card-catalogue.mjs";
import { deterministicUuid } from "../scripts/tcgcsv-sealed-products.mjs";

const OBSERVED_AT = "2026-09-11T12:00:00.000Z";
const USD_TO_GBP = 0.75;

const providerGroups = new Map([
  ["3/24451", {
    prices: [
      price(685562, 2.55),
      price(685563, 29.36),
    ],
    products: [
      product(685562, "Tyrunt - 070", "070"),
      product(685563, "Tyrunt - 070 (Pokemon Center Exclusive)", "070"),
    ],
  }],
  ["3/23323", {
    prices: [
      price(527918, 1.2),
      price(528026, 1.4),
      price(527972, 1.6),
    ],
    products: [
      product(527918, "Sun Seed", "027/034"),
      product(528026, "Drops in the Ocean", "021/034"),
      product(527972, "Scorching Charcoal", "026/034"),
    ],
  }],
  ["85/23923", {
    prices: [price(603855, 20, "1st Edition Holofoil")],
    products: [product(603855, "Rayquaza EX - 061/078", "061/078")],
  }],
  ["3/2374", {
    prices: [
      price(668959, 0.46),
      price(648587, 2.42),
      price(648585, 1.43),
    ],
    products: [
      product(668959, "Zoroark (White Flare Stamped)", "062/086"),
      product(648587, "Blastoise ex (Stellar Crown Stamp)", "030/142"),
      product(648585, "Venusaur ex (Stellar Crown Stamp)", "001/142"),
    ],
  }],
]);

const expectedSearches = [
  {
    name: "レックウザEX",
    query: "Japanese Rayquaza 061/078",
    variants: [["1st Edition Holofoil", "603855", 1500]],
  },
  {
    name: "Tyrunt",
    query: "Tyrunt MEP 070",
    variants: [
      ["Holofoil", "685562", 191],
      ["Pokémon Center Stamp Holofoil", "685563", 2202],
    ],
  },
  {
    name: "Sun Seed",
    query: "Sun Seed 027/034",
    variants: [["Holofoil", "527918", 90]],
  },
  {
    name: "Drops in the Ocean",
    query: "Drops in the Ocean 021/034",
    variants: [["Holofoil", "528026", 105]],
  },
  {
    name: "Scorching Charcoal",
    query: "Scorching Coal 026/034",
    variants: [["Holofoil", "527972", 120]],
  },
  {
    name: "Zoroark",
    query: "Zoroark 062/086 White Flare Stamp",
    variants: [["White Flare Stamp Holofoil", "668959", 35]],
  },
  {
    name: "Blastoise ex",
    query: "Blastoise ex 030/142 Stellar Crown Stamp",
    variants: [["Stellar Crown Stamp Holofoil", "648587", 182]],
  },
  {
    name: "Venusaur ex",
    query: "Venusaur 001/142 Stellar Crown Stamp",
    variants: [["Stellar Crown Stamp Holofoil", "648585", 107]],
  },
];

test("reviewed sync makes every reported card searchable with all nine exact priced products", async () => {
  const database = inMemoryCatalogue();

  for (const target of reviewedTcgcsvCatalogueTargets()) {
    await syncReviewedTcgcsvCardCatalogue({
      categoryId: target.categoryId,
      fetchImpl: providerFetch(target.categoryId, target.groupId),
      groupId: target.groupId,
      prisma: database.prisma,
      usdToGbpRate: USD_TO_GBP,
    });
  }

  assert.equal(database.cards.size, 8, "the nine provider products represent eight card printings");
  assert.equal(database.snapshots.length, 9, "each exact provider product retains its own price identity");

  for (const expected of expectedSearches) {
    const matches = [...database.cards.values()].filter((card) => matchesCatalogueSearch(card, expected.query));

    assert.equal(matches.length, 1, `${expected.query} should return exactly one reviewed printing`);
    assert.equal(matches[0].name, expected.name);

    const cardSnapshots = database.snapshots.filter((snapshot) => snapshot.cardPrintingId === matches[0].id);
    const actualPriceIdentities = cardSnapshots
      .map((snapshot) => [snapshot.variantLabel, snapshot.sourceRef, snapshot.priceMinor])
      .sort((left, right) => left[0].localeCompare(right[0]));
    const expectedPriceIdentities = [...expected.variants]
      .sort((left, right) => left[0].localeCompare(right[0]));

    assert.deepEqual(actualPriceIdentities, expectedPriceIdentities, `${expected.name} price identities drifted`);

    const variantOptions = buildCatalogueVariantOptions({
      itemType: "card",
      priceHistory: cardSnapshots.map(pricePoint),
      rarity: matches[0].rarity,
      setName: matches[0].cardSetName,
      variantMetadata: matches[0].variantMetadata,
    });
    const optionsByLabel = new Map(variantOptions.map((option) => [option.label, option]));

    for (const [label, , valueMinor] of expected.variants) {
      assert.equal(optionsByLabel.get(label)?.valueMinor, valueMinor, `${expected.name} ${label} should expose its own price`);
    }
  }
});

function inMemoryCatalogue() {
  const sets = new Map();
  const cards = new Map([
    existingCard("pokemon-tcg-card:rsv10pt5-62", "Zoroark", "62", "White Flare"),
    existingCard("pokemon-tcg-card:sv7-30", "Blastoise ex", "30", "Stellar Crown"),
    existingCard("pokemon-tcg-card:sv7-1", "Venusaur ex", "1", "Stellar Crown"),
  ]);
  const snapshots = [];
  const prisma = {
    cardPrinting: {
      findUnique: async ({ where }) => cards.get(where.id) ?? null,
      update: async ({ data, where }) => {
        const next = { ...cards.get(where.id), ...data };
        cards.set(where.id, next);
        return next;
      },
      upsert: async ({ create, update, where }) => {
        const next = cards.has(where.id)
          ? { ...cards.get(where.id), ...update }
          : { ...create, cardSetName: sets.get(create.cardSetId)?.name };
        cards.set(where.id, next);
        return next;
      },
    },
    cardSet: {
      findUnique: async ({ where }) => sets.get(where.id) ?? null,
      upsert: async ({ create, update, where }) => {
        const next = sets.has(where.id) ? { ...sets.get(where.id), ...update } : create;
        sets.set(where.id, next);
        return next;
      },
    },
    priceSnapshot: {
      findMany: async ({ where }) => snapshots
        .filter((snapshot) => where.id.in.includes(snapshot.id))
        .map(({ id }) => ({ id })),
      upsert: async ({ create, update, where }) => {
        const index = snapshots.findIndex((snapshot) => snapshot.id === where.id);
        const snapshot = {
          ...(index >= 0 ? snapshots[index] : create),
          ...(index >= 0 ? update : {}),
          observedAt: new Date(OBSERVED_AT),
        };
        if (index >= 0) snapshots[index] = snapshot;
        else snapshots.push(snapshot);
        return snapshot;
      },
    },
  };
  prisma.$transaction = async (task) => task(prisma);

  return { cards, prisma, snapshots };
}

function existingCard(seed, name, number, cardSetName) {
  const id = deterministicUuid(seed);

  return [id, {
    cardSetId: `set-${cardSetName.toLowerCase().replaceAll(" ", "-")}`,
    cardSetName,
    id,
    imageLargeUrl: "https://images.example/base-large.jpg",
    imageSmallUrl: "https://images.example/base-small.jpg",
    language: "en",
    name,
    number,
    providerIds: { pokemon_tcg_api: seed.split(":").at(-1) },
    rarity: "Rare",
    region: "international",
    searchText: `${name} ${number} ${cardSetName}`.toLowerCase(),
    variantMetadata: {},
  }];
}

function matchesCatalogueSearch(card, query) {
  const fields = [card.name, card.number, card.cardSetName, card.searchText]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("en-GB");

  return catalogueSearchTermGroups(query).every((terms) =>
    terms.some((term) => fields.includes(term.toLocaleLowerCase("en-GB"))));
}

function pricePoint(snapshot) {
  return {
    confidence: "Fair",
    observedAt: snapshot.observedAt.toISOString(),
    source: snapshot.source,
    valueMinor: snapshot.priceMinor,
    variantLabel: snapshot.variantLabel,
  };
}

function product(productId, name, number) {
  return {
    extendedData: [
      { name: "Number", value: number },
      { name: "Rarity", value: "Promo" },
    ],
    imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_200w.jpg`,
    name,
    productId,
    url: `https://www.tcgplayer.com/product/${productId}/reviewed-card`,
  };
}

function price(productId, marketPrice, subTypeName = "Holofoil") {
  return { marketPrice, productId, subTypeName };
}

function providerFetch(categoryId, groupId) {
  const fixture = providerGroups.get(`${categoryId}/${groupId}`);

  assert.ok(fixture, `missing provider fixture for ${categoryId}/${groupId}`);

  return async (url) => Response.json({
    results: String(url).endsWith("/products") ? fixture.products : fixture.prices,
  });
}
