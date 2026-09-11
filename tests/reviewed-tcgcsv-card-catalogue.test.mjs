import assert from "node:assert/strict";
import test from "node:test";
import {
  reviewedTcgcsvCatalogueTargets,
  reviewedTcgcsvGroup,
  syncReviewedTcgcsvCardCatalogue,
  validateReviewedTcgcsvProduct,
} from "../scripts/reviewed-tcgcsv-card-catalogue.mjs";

test("the reviewed allowlist contains only the exact provider groups and products", () => {
  assert.deepEqual(
    reviewedTcgcsvCatalogueTargets().map((target) => [target.categoryId, target.groupId, target.productIds]),
    [
      [3, "24451", ["685562", "685563"]],
      [3, "23323", ["527918", "528026", "527972"]],
      [85, "23923", ["603855"]],
      [3, "2374", ["668959", "648587", "648585"]],
    ],
  );
  assert.throws(
    () => reviewedTcgcsvGroup(3, "99999"),
    /not in the reviewed catalogue allowlist/,
  );
});

test("the reviewed Japanese XY6 fixture maps directly to TCGCSV group 23923", () => {
  const group = reviewedTcgcsvGroup(85, "23923");

  assert.equal(group.categoryId, 85);
  assert.equal(group.groupId, "23923");
  assert.equal(group.set.language, "ja");
  assert.equal(group.set.providerIds.tcgdex_ja, "XY6");
  assert.equal(group.set.providerIds.tcgcsv_card_group_code, "XY6");
  assert.equal(group.set.providerIds.tcgcsv_card_group, "23923");
  assert.equal(group.cards[0].products[0].productId, "603855");
});

test("reviewed product validation fails closed when provider identity drifts", () => {
  const productSpec = reviewedTcgcsvGroup(3, "24451").cards[0].products[0];

  validateReviewedTcgcsvProduct(product({
    id: 685562,
    name: "Tyrunt - 070",
    number: "070",
  }), productSpec);
  assert.throws(
    () => validateReviewedTcgcsvProduct(product({
      id: 685562,
      name: "Different card",
      number: "070",
    }), productSpec),
    /no longer matches its approved identity/,
  );
});

test("reviewed catalogue sync creates one Tyrunt card with two exact priced variants", async () => {
  const writes = { cards: [], prices: [], sets: [] };
  const prisma = {
    cardPrinting: {
      findUnique: async () => null,
      upsert: async (query) => writes.cards.push(query),
    },
    cardSet: {
      findUnique: async () => null,
      upsert: async (query) => writes.sets.push(query),
    },
    priceSnapshot: {
      findMany: async () => [],
      upsert: async (query) => writes.prices.push(query),
    },
  };
  prisma.$transaction = async (task) => task(prisma);
  const result = await syncReviewedTcgcsvCardCatalogue({
    categoryId: 3,
    fetchImpl: reviewedFetch({
      groupId: "24451",
      prices: [
        price(685562, 2.55),
        price(685563, 29.36),
      ],
      products: [
        product({ id: 685562, name: "Tyrunt - 070", number: "070" }),
        product({ id: 685563, name: "Tyrunt - 070 (Pokemon Center Exclusive)", number: "070" }),
      ],
    }),
    groupId: "24451",
    prisma,
    usdToGbpRate: 0.75,
  });

  assert.equal(result.cardsUpdated, 1);
  assert.equal(result.priceSnapshotsCreated, 2);
  assert.equal(writes.cards.length, 1);
  assert.deepEqual(
    writes.cards[0].create.variantMetadata.reviewedVariants.map((variant) => variant.label),
    ["Holofoil", "Pokémon Center Stamp Holofoil"],
  );
  assert.ok(writes.cards[0].create.variantMetadata.reviewedSearchTerms.includes("MEP 070"));
  assert.ok(writes.cards[0].create.variantMetadata.reviewedSearchTerms.includes("Pokémon Center Stamp Holofoil"));
  assert.match(writes.cards[0].create.searchText, /mega evolution promo 070/);
  assert.equal(writes.prices[0].create.variantLabel, "Holofoil");
  assert.equal(writes.prices[0].create.priceMinor, 191);
  assert.equal(writes.prices[1].create.variantLabel, "Pokémon Center Stamp Holofoil");
  assert.equal(writes.prices[1].create.priceMinor, 2202);
});

test("reviewed supplemental sync updates exact base cards without creating duplicates", async () => {
  const group = reviewedTcgcsvGroup(3, "2374");
  const existingByName = new Map([
    ["Zoroark", existingCard("Zoroark", "62")],
    ["Blastoise ex", existingCard("Blastoise ex", "30")],
    ["Venusaur ex", existingCard("Venusaur ex", "1")],
  ]);
  const updates = [];
  const snapshots = [];
  let findIndex = 0;
  const prisma = {
    cardPrinting: {
      findUnique: async () => existingByName.get(group.cards[findIndex++].expectedExistingName),
      update: async (query) => updates.push(query),
    },
    priceSnapshot: {
      findMany: async () => [],
      upsert: async (query) => snapshots.push(query),
    },
  };
  prisma.$transaction = async (task) => task(prisma);
  const products = [
    product({ id: 668959, name: "Zoroark (White Flare Stamped)", number: "062/086" }),
    product({ id: 648587, name: "Blastoise ex (Stellar Crown Stamp)", number: "030/142" }),
    product({ id: 648585, name: "Venusaur ex (Stellar Crown Stamp)", number: "001/142" }),
  ];
  const result = await syncReviewedTcgcsvCardCatalogue({
    categoryId: 3,
    fetchImpl: reviewedFetch({
      groupId: "2374",
      prices: [price(668959, 0.46), price(648587, 2.42), price(648585, 1.43)],
      products,
    }),
    groupId: "2374",
    prisma,
    usdToGbpRate: 0.75,
  });

  assert.equal(result.cardsUpdated, 3);
  assert.equal(updates.length, 3);
  assert.deepEqual(
    updates.map((entry) => entry.data.variantMetadata.reviewedVariants[0].label),
    [
      "White Flare Stamp Holofoil",
      "Stellar Crown Stamp Holofoil",
      "Stellar Crown Stamp Holofoil",
    ],
  );
  assert.match(updates[1].data.searchText, /030\/142/);
  assert.equal(snapshots.length, 3);
});

test("a late reviewed provider identity drift performs no database writes", async () => {
  let transactionCalls = 0;
  let writes = 0;
  const prisma = {
    $transaction: async (task) => {
      transactionCalls += 1;
      return task(prisma);
    },
    cardPrinting: {
      findUnique: async () => null,
      upsert: async () => { writes += 1; },
    },
    cardSet: {
      findUnique: async () => null,
      upsert: async () => { writes += 1; },
    },
    priceSnapshot: {
      findMany: async () => [],
      upsert: async () => { writes += 1; },
    },
  };

  await assert.rejects(
    syncReviewedTcgcsvCardCatalogue({
      categoryId: 3,
      fetchImpl: reviewedFetch({
        groupId: "23323",
        prices: [price(527918, 1), price(528026, 1), price(527972, 1)],
        products: [
          product({ id: 527918, name: "Sun Seed", number: "027/034" }),
          product({ id: 528026, name: "Drops in the Ocean", number: "021/034" }),
          product({ id: 527972, name: "Provider identity drift", number: "026/034" }),
        ],
      }),
      groupId: "23323",
      prisma,
      usdToGbpRate: 0.75,
    }),
    /no longer matches its approved identity/,
  );

  assert.equal(transactionCalls, 0);
  assert.equal(writes, 0);
});

test("a missing expected price subtype fails closed before database access", async () => {
  let databaseReads = 0;
  let transactionCalls = 0;
  let writes = 0;
  const prisma = rejectingWritePrisma({
    onRead: () => { databaseReads += 1; },
    onTransaction: () => { transactionCalls += 1; },
    onWrite: () => { writes += 1; },
  });

  await assert.rejects(
    syncReviewedTcgcsvCardCatalogue({
      categoryId: 3,
      fetchImpl: reviewedFetch({
        groupId: "24451",
        prices: [
          price(685562, 2.55),
          { ...price(685563, 29.36), subTypeName: "Reverse Holofoil" },
        ],
        products: [
          product({ id: 685562, name: "Tyrunt - 070", number: "070" }),
          product({ id: 685563, name: "Tyrunt - 070 (Pokemon Center Exclusive)", number: "070" }),
        ],
      }),
      groupId: "24451",
      prisma,
      usdToGbpRate: 0.75,
    }),
    (error) => {
      assert.match(error.message, /price validation failed for group 3\/24451/);
      assert.match(error.message, /no catalogue or price data was written/);
      assert.match(error.message, /Product 685563 \(Tyrunt - 070 \(Pokemon Center Exclusive\)\)/);
      assert.match(error.message, /expected price subtype "Holofoil" was not returned/);
      assert.match(error.message, /available subtypes: "Reverse Holofoil"/);
      return true;
    },
  );

  assert.equal(databaseReads, 0);
  assert.equal(transactionCalls, 0);
  assert.equal(writes, 0);
});

test("an unusable matching price fails closed before database access", async () => {
  let databaseReads = 0;
  let transactionCalls = 0;
  let writes = 0;
  const prisma = rejectingWritePrisma({
    onRead: () => { databaseReads += 1; },
    onTransaction: () => { transactionCalls += 1; },
    onWrite: () => { writes += 1; },
  });

  await assert.rejects(
    syncReviewedTcgcsvCardCatalogue({
      categoryId: 85,
      fetchImpl: reviewedFetch({
        groupId: "23923",
        prices: [{
          directLowPrice: null,
          lowPrice: 0,
          marketPrice: 0,
          midPrice: -1,
          productId: 603855,
          subTypeName: "1st Edition Holofoil",
        }],
        products: [
          product({ id: 603855, name: "Rayquaza EX - 061/078", number: "061/078" }),
        ],
      }),
      groupId: "23923",
      prisma,
      usdToGbpRate: 0.75,
    }),
    (error) => {
      assert.match(error.message, /Product 603855 \(Rayquaza EX - 061\/078\)/);
      assert.match(error.message, /price subtype "1st Edition Holofoil"/);
      assert.match(error.message, /no positive marketPrice, midPrice, lowPrice, or directLowPrice/);
      return true;
    },
  );

  assert.equal(databaseReads, 0);
  assert.equal(transactionCalls, 0);
  assert.equal(writes, 0);
});

test("metadata-only reviewed sync does not require provider prices", async () => {
  const writes = { cards: [], sets: [] };
  const prisma = {
    cardPrinting: {
      findUnique: async () => null,
      upsert: async (query) => writes.cards.push(query),
    },
    cardSet: {
      findUnique: async () => null,
      upsert: async (query) => writes.sets.push(query),
    },
    priceSnapshot: {
      findMany: async () => [],
      upsert: async () => assert.fail("metadata-only sync must not write price snapshots"),
    },
  };
  prisma.$transaction = async (task) => task(prisma);

  const result = await syncReviewedTcgcsvCardCatalogue({
    categoryId: 85,
    fetchImpl: reviewedFetch({
      groupId: "23923",
      prices: [],
      products: [
        product({ id: 603855, name: "Rayquaza EX - 061/078", number: "061/078" }),
      ],
    }),
    groupId: "23923",
    prisma,
    writePrices: false,
  });

  assert.equal(result.cardsUpdated, 1);
  assert.equal(result.priceSnapshotsWritten, 0);
  assert.equal(writes.cards.length, 1);
  assert.equal(writes.sets.length, 1);
});

test("a late local base-card identity drift performs no database writes", async () => {
  let findIndex = 0;
  let transactionCalls = 0;
  let writes = 0;
  const existing = [
    existingCard("Zoroark", "62"),
    existingCard("Blastoise ex", "30"),
    existingCard("Wrong local card", "1"),
  ];
  const prisma = {
    $transaction: async (task) => {
      transactionCalls += 1;
      return task(prisma);
    },
    cardPrinting: {
      findUnique: async () => existing[findIndex++],
      update: async () => { writes += 1; },
    },
    priceSnapshot: {
      findMany: async () => [],
      upsert: async () => { writes += 1; },
    },
  };

  await assert.rejects(
    syncReviewedTcgcsvCardCatalogue({
      categoryId: 3,
      fetchImpl: reviewedFetch({
        groupId: "2374",
        prices: [price(668959, 0.46), price(648587, 2.42), price(648585, 1.43)],
        products: [
          product({ id: 668959, name: "Zoroark (White Flare Stamped)", number: "062/086" }),
          product({ id: 648587, name: "Blastoise ex (Stellar Crown Stamp)", number: "030/142" }),
          product({ id: 648585, name: "Venusaur ex (Stellar Crown Stamp)", number: "001/142" }),
        ],
      }),
      groupId: "2374",
      prisma,
      usdToGbpRate: 0.75,
    }),
    /no longer matches its approved identity/,
  );

  assert.equal(transactionCalls, 0);
  assert.equal(writes, 0);
});

test("same-day reruns keep search metadata stable and update deterministic snapshots", async () => {
  const database = reviewedDatabase();
  const first = await syncReviewedTcgcsvCardCatalogue({
    categoryId: 3,
    fetchImpl: reviewedFetch({
      groupId: "24451",
      prices: [price(685562, 2.55), price(685563, 29.36)],
      products: [
        product({ id: 685562, name: "Tyrunt - 070", number: "070" }),
        product({ id: 685563, name: "Tyrunt - 070 (Pokemon Center Exclusive)", number: "070" }),
      ],
    }),
    groupId: "24451",
    observedAt: "2026-09-11T08:00:00.000Z",
    prisma: database.prisma,
    usdToGbpRate: 0.75,
  });
  const firstCard = structuredClone([...database.cards.values()][0]);
  const firstSet = structuredClone([...database.sets.values()][0]);

  const second = await syncReviewedTcgcsvCardCatalogue({
    categoryId: 3,
    fetchImpl: reviewedFetch({
      groupId: "24451",
      prices: [
        { ...price(685562, 0), midPrice: 3.2 },
        price(685563, 29.36),
      ],
      products: [
        product({ id: 685562, name: "Tyrunt - 070", number: "070" }),
        product({ id: 685563, name: "Tyrunt - 070 (Pokemon Center Exclusive)", number: "070" }),
      ],
    }),
    groupId: "24451",
    observedAt: "2026-09-11T20:00:00.000Z",
    prisma: database.prisma,
    usdToGbpRate: 0.75,
  });
  const secondCard = [...database.cards.values()][0];
  const secondSet = [...database.sets.values()][0];
  const regularSnapshot = [...database.snapshots.values()]
    .find((snapshot) => snapshot.sourceRef === "685562");

  assert.equal(first.priceSnapshotsCreated, 2);
  assert.equal(second.priceSnapshotsCreated, 0);
  assert.equal(second.priceSnapshotsUpdated, 2);
  assert.equal(second.priceSnapshotsWritten, 2);
  assert.equal(database.snapshots.size, 2);
  assert.equal(secondCard.searchText, firstCard.searchText);
  assert.deepEqual(secondCard.variantMetadata, firstCard.variantMetadata);
  assert.deepEqual(secondSet.metadata, firstSet.metadata);
  assert.equal(regularSnapshot.priceMinor, 240);
  assert.equal(regularSnapshot.metadata.selectedPriceField, "midPrice");
  assert.equal(regularSnapshot.confidenceScore, 66);
});

function product({ id, name, number }) {
  return {
    extendedData: [
      { name: "Number", value: number },
      { name: "Rarity", value: "Promo" },
    ],
    imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${id}_200w.jpg`,
    name,
    productId: id,
    url: `https://www.tcgplayer.com/product/${id}/reviewed-card`,
  };
}

function price(productId, marketPrice) {
  return {
    marketPrice,
    productId,
    subTypeName: "Holofoil",
  };
}

function existingCard(name, number) {
  return {
    cardSetId: "set-id",
    imageLargeUrl: "https://images.example/base-large.jpg",
    imageSmallUrl: "https://images.example/base-small.jpg",
    language: "en",
    name,
    number,
    providerIds: { pokemon_tcg_api: "provider-card" },
    region: "international",
    searchText: `${name} ${number}`.toLowerCase(),
    variantMetadata: { availablePrices: ["holofoil"] },
  };
}

function reviewedFetch({ groupId, prices, products }) {
  return async (url, init) => {
    assert.match(String(url), new RegExp(`/${groupId}/(?:products|prices)$`));
    assert.equal(init?.headers?.accept, "application/json");
    assert.equal(init?.headers?.["user-agent"], "MintBinderLocalImporter/0.1");
    const results = String(url).endsWith("/products") ? products : prices;

    return new Response(JSON.stringify({ results }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
}

function reviewedDatabase() {
  const cards = new Map();
  const sets = new Map();
  const snapshots = new Map();
  const prisma = {
    cardPrinting: {
      findUnique: async ({ where }) => cards.get(where.id) ?? null,
      upsert: async ({ create, update, where }) => {
        const value = cards.has(where.id) ? { ...cards.get(where.id), ...update } : create;
        cards.set(where.id, value);
        return value;
      },
    },
    cardSet: {
      findUnique: async ({ where }) => sets.get(where.id) ?? null,
      upsert: async ({ create, update, where }) => {
        const value = sets.has(where.id) ? { ...sets.get(where.id), ...update } : create;
        sets.set(where.id, value);
        return value;
      },
    },
    priceSnapshot: {
      findMany: async ({ where }) => [...snapshots.values()]
        .filter((snapshot) => where.id.in.includes(snapshot.id))
        .map(({ id }) => ({ id })),
      upsert: async ({ create, update, where }) => {
        const value = snapshots.has(where.id) ? { ...snapshots.get(where.id), ...update } : create;
        snapshots.set(where.id, value);
        return value;
      },
    },
  };
  prisma.$transaction = async (task) => task(prisma);

  return { cards, prisma, sets, snapshots };
}

function rejectingWritePrisma({ onRead, onTransaction, onWrite }) {
  return {
    $transaction: async () => {
      onTransaction();
      throw new Error("unexpected transaction");
    },
    cardPrinting: {
      findUnique: async () => {
        onRead();
        return null;
      },
      upsert: async () => onWrite(),
    },
    cardSet: {
      findUnique: async () => {
        onRead();
        return null;
      },
      upsert: async () => onWrite(),
    },
    priceSnapshot: {
      findMany: async () => {
        onRead();
        return [];
      },
      upsert: async () => onWrite(),
    },
  };
}
