import assert from "node:assert/strict";
import test from "node:test";
import {
  cardPricingOptionsFromEnv,
  compareCardGroupRefreshPriority,
  isCardProduct,
  japanCardPricingOptionsFromEnv,
  matchTcgcsvCardGroupsToSets,
  matchTcgcsvCardProduct,
  resolveTcgcsvVariantIdentities,
  syncTcgcsvCardPrices,
  tcgcsvCardVariantLabel,
} from "../scripts/tcgcsv-card-pricing.mjs";

test("rotates past a recently attempted zero-output pricing group", () => {
  const zeroOutputOldest = {
    cardPrintings: [
      { priceSnapshots: [] },
    ],
    metadata: {},
    name: "Old zero-output group",
  };
  const productiveRecent = {
    cardPrintings: [
      { priceSnapshots: [{ observedAt: new Date("2026-09-06T12:00:00.000Z") }] },
      ...Array.from({ length: 5 }, () => ({ priceSnapshots: [] })),
    ],
    metadata: {},
    name: "Large unpriced group",
  };

  assert.ok(compareCardGroupRefreshPriority(zeroOutputOldest, productiveRecent) < 0);
  zeroOutputOldest.metadata = {
    tcgcsvCardPricingAttempts: {
      "tcgcsv-japan-card": {
        attemptedAt: "2026-09-06T13:00:00.000Z",
        outcome: "zero_output",
      },
    },
  };
  assert.ok(compareCardGroupRefreshPriority(
    productiveRecent,
    zeroOutputOldest,
    { source: "tcgcsv-japan-card" },
  ) < 0);
});

test("detects card products while excluding sealed products", () => {
  assert.equal(isCardProduct({
    extendedData: [{ name: "Number", value: "139/195" }],
    name: "Lugia VSTAR",
  }), true);
  assert.equal(isCardProduct({
    extendedData: [{ name: "CardText", value: "36 packs" }],
    name: "Silver Tempest Booster Box",
  }), false);
  assert.equal(isCardProduct({
    extendedData: [{ name: "Rarity", value: "Code Card" }],
    name: "Code Card - Silver Tempest Booster Pack",
  }), false);
});

test("matches TCGCSV card products to local cards by number and name", () => {
  const cards = [
    { id: "card-1", name: "Lugia VSTAR", number: "139" },
    { id: "card-2", name: "Lugia V", number: "138" },
    { id: "card-3", name: "Poke Pad", number: "81" },
    { id: "card-4", name: "Alakazam", number: "H1" },
    { id: "card-5", name: "Blastoise", number: "2" },
  ];

  assert.deepEqual(
    matchTcgcsvCardProduct(
      {
        extendedData: [{ name: "Number", value: "139/195" }],
        name: "Lugia VSTAR",
      },
      cards,
    ),
    cards[0],
  );
  assert.deepEqual(
    matchTcgcsvCardProduct(
      {
        extendedData: [{ name: "Number", value: "081/088" }],
        name: "Poke Pad - 081/088",
      },
      cards,
    ),
    cards[2],
  );
  assert.deepEqual(
    matchTcgcsvCardProduct(
      {
        extendedData: [{ name: "Number", value: "H01/H32" }],
        name: "Alakazam (H1)",
      },
      cards,
    ),
    cards[3],
  );
  assert.deepEqual(
    matchTcgcsvCardProduct(
      {
        extendedData: [{ name: "Number", value: "2/102" }],
        name: "Blastoise - 1st Edition Holofoil",
      },
      cards,
    ),
    cards[4],
  );
});

test("does not use a name fallback when TCGCSV supplies a mismatched collector number", () => {
  const cards = [{ id: "card-162", name: "Giovanni's Charisma", number: "162" }];

  assert.equal(matchTcgcsvCardProduct({
    extendedData: [{ name: "Number", value: "197/165" }],
    name: "Giovanni's Charisma",
  }, cards), null);
  assert.deepEqual(matchTcgcsvCardProduct({
    extendedData: [{ name: "Rarity", value: "Promo" }],
    name: "Giovanni's Charisma",
  }, cards), cards[0]);
});

test("matches reviewed unnumbered Sun and Moon energies by their qualified names", () => {
  const cards = [
    { id: "energy-grass", name: "Grass Energy", number: "164" },
    { id: "energy-fire", name: "Fire Energy", number: "165" },
  ];

  assert.deepEqual(matchTcgcsvCardProduct({
    extendedData: [{ name: "Rarity", value: "Common" }],
    name: "Grass Energy (2017 Unnumbered)",
    productId: 127381,
  }, cards), cards[0]);
});

test("maps only the reviewed Aquapolis Porygon artwork products to collector number 103", () => {
  const cards = [{ id: "aquapolis-porygon", name: "Porygon", number: "103" }];

  assert.deepEqual(matchTcgcsvCardProduct({
    extendedData: [{ name: "Number", value: "103a/147" }],
    name: "Porygon (103a)",
    productId: 88306,
  }, cards), cards[0]);
  assert.deepEqual(matchTcgcsvCardProduct({
    extendedData: [{ name: "Number", value: "103b/147" }],
    name: "Porygon (103b)",
    productId: 88307,
  }, cards), cards[0]);
  assert.equal(matchTcgcsvCardProduct({
    extendedData: [{ name: "Number", value: "103a/147" }],
    name: "Porygon (103a)",
    productId: 99999,
  }, cards), null);
});

test("uses printing details and deterministic provider suffixes for parallel variants", () => {
  assert.equal(tcgcsvCardVariantLabel({
    name: "Giovanni's Charisma (Poke Ball Pattern)",
  }, "Holofoil"), "Poke Ball Reverse Holofoil");
  assert.equal(tcgcsvCardVariantLabel({
    name: "Giovanni's Charisma (Master Ball Pattern)",
  }, "Holofoil"), "Master Ball Reverse Holofoil");
  assert.equal(tcgcsvCardVariantLabel({
    name: "Giovanni's Charisma",
    url: "https://example.test/giovannis-charisma-poke-ball-pattern",
  }, "Holofoil"), "Poke Ball Reverse Holofoil");

  const resolved = resolveTcgcsvVariantIdentities([
    {
      cardPrintingId: "card-1",
      product: { name: "Pikachu", productId: 101 },
      subTypeName: "Holofoil",
    },
    {
      cardPrintingId: "card-1",
      product: { name: "Pikachu", productId: 205 },
      subTypeName: "Holofoil",
    },
  ]);

  assert.deepEqual(resolved.map((entry) => entry.variantLabel), [
    "Holofoil",
    "Holofoil · TCGplayer #205",
  ]);
});

test("preserves raw subtypes for cards actually named Poke Ball or Master Ball", () => {
  assert.equal(tcgcsvCardVariantLabel({
    name: "Master Ball - 153/165",
    url: "https://example.test/master-ball-153-165",
  }, "Normal"), "Normal");
  assert.equal(tcgcsvCardVariantLabel({
    name: "Master Ball - 153/165",
    url: "https://example.test/master-ball-153-165",
  }, "Reverse Holofoil"), "Reverse Holofoil");
  assert.equal(tcgcsvCardVariantLabel({
    name: "Poké Ball - 185/198",
    url: "https://example.test/poke-ball-185-198",
  }, "1st Edition Normal"), "1st Edition Normal");

  const resolved = resolveTcgcsvVariantIdentities([
    {
      cardPrintingId: "card-master-ball",
      product: { name: "Master Ball", productId: 153 },
      subTypeName: "Normal",
    },
    {
      cardPrintingId: "card-master-ball",
      product: { name: "Master Ball", productId: 153 },
      subTypeName: "Reverse Holofoil",
    },
  ]);

  assert.deepEqual(resolved.map((entry) => entry.variantLabel), [
    "Normal",
    "Reverse Holofoil",
  ]);
});

test("scheduled imports never relabel historical TCGCSV snapshots", async () => {
  const createdSnapshots = [];
  let historicalUpdateCalls = 0;
  const prisma = {
    cardPrinting: {
      findMany: async () => [{
        id: "card-master-ball",
        imageLargeUrl: "https://example.test/master-ball-large.jpg",
        imageSmallUrl: "https://example.test/master-ball-small.jpg",
        name: "Master Ball",
        number: "153",
      }],
    },
    cardSet: {
      findMany: async () => [{
        cardPrintings: [{ priceSnapshots: [] }],
        id: "set-test",
        language: "en",
        name: "Test Set",
        providerIds: { pokemon_tcg_api: "tst" },
        total: 1,
      }],
    },
    priceSnapshot: {
      create: async ({ data }) => {
        createdSnapshots.push(data);
        return { id: `snapshot-${createdSnapshots.length}`, ...data };
      },
      findMany: async ({ where }) => [{
        cardPrintingId: "card-master-ball",
        metadata: {
          baseVariantLabel: "Master Ball Reverse Holofoil",
          subTypeName: where.metadata.equals,
          tcgplayerUrl: "https://example.test/master-ball-153-165",
        },
        sourceRef: "555153",
        variantLabel: "Master Ball Reverse Holofoil",
      }],
      updateMany: async () => {
        historicalUpdateCalls += 1;
        return { count: 1 };
      },
    },
  };
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => {
      if (url.endsWith("/groups")) {
        return {
          success: true,
          results: [{ abbreviation: "TST", groupId: 999, name: "Test Set" }],
        };
      }

      if (url.endsWith("/products")) {
        return {
          success: true,
          results: [{
            extendedData: [{ name: "Number", value: "153/165" }],
            name: "Master Ball - 153/165",
            productId: 555153,
            url: "https://example.test/master-ball-153-165",
          }],
        };
      }

      return {
        success: true,
        results: [
          { marketPrice: 1, productId: 555153, subTypeName: "Normal" },
          { marketPrice: 2, productId: 555153, subTypeName: "Reverse Holofoil" },
        ],
      };
    },
  });

  const summary = await syncTcgcsvCardPrices({
    fetchImpl,
    priceOnlyUnpriced: false,
    prisma,
    usdToGbpRate: 0.8,
    waitMs: 0,
    writeImages: false,
  });

  assert.equal(historicalUpdateCalls, 0);
  assert.equal(summary.identitySnapshotsRelabelled, 0);
  assert.deepEqual(createdSnapshots.map((snapshot) => snapshot.variantLabel), [
    "Normal",
    "Reverse Holofoil",
  ]);
});

test("preserves an existing generic variant identity when a new lower provider ID appears", () => {
  const resolved = resolveTcgcsvVariantIdentities([
    {
      cardPrintingId: "card-1",
      preserveBaseLabel: true,
      product: { name: "Pikachu", productId: 205 },
      subTypeName: "Holofoil",
    },
    {
      cardPrintingId: "card-1",
      product: { name: "Pikachu", productId: 101 },
      subTypeName: "Holofoil",
    },
  ]);

  assert.deepEqual(resolved.map((entry) => entry.variantLabel), [
    "Holofoil",
    "Holofoil · TCGplayer #101",
  ]);
});

test("matches card-only TCGCSV promo and trainer kit groups to local sets", () => {
  const sets = [
    { id: "set-tk2a", name: "EX Trainer Kit 2 Plusle", providerId: "tk2a" },
    { id: "set-tk2b", name: "EX Trainer Kit 2 Minun", providerId: "tk2b" },
    { id: "set-xyp", name: "XY Black Star Promos", providerId: "xyp" },
    { id: "set-swshp", name: "SWSH Black Star Promos", providerId: "swshp" },
  ];

  assert.deepEqual(
    matchTcgcsvCardGroupsToSets(
      [
        { groupId: 1542, name: "EX Trainer Kit 2: Plusle & Minun" },
        { groupId: 1451, name: "XY Promos" },
        { groupId: 2545, name: "SWSH: Sword & Shield Promo Cards", abbreviation: "SWSD" },
      ],
      sets,
    ),
    [
      { group: { groupId: 1542, name: "EX Trainer Kit 2: Plusle & Minun" }, set: sets[0] },
      { group: { groupId: 1542, name: "EX Trainer Kit 2: Plusle & Minun" }, set: sets[1] },
      { group: { groupId: 1451, name: "XY Promos" }, set: sets[2] },
      { group: { groupId: 2545, name: "SWSH: Sword & Shield Promo Cards", abbreviation: "SWSD" }, set: sets[3] },
    ],
  );
});

const reviewedEnglishGroupMappings = [
  [22873, "SV01: Scarlet & Violet Base Set", "Scarlet & Violet", "sv1"],
  [23237, "SV: Scarlet & Violet 151", "151", "sv3pt5"],
  [1375, "Expedition", "Expedition Base Set", "ecard1"],
  [1387, "XY Base Set", "XY", "xy1"],
  [1402, "HeartGold SoulSilver", "HeartGold & SoulSilver", "hgss1"],
  [1381, "Triumphant", "HS—Triumphant", "hgss4"],
  [1403, "Undaunted", "HS—Undaunted", "hgss3"],
  [1399, "Unleashed", "HS—Unleashed", "hgss2"],
  [2782, "McDonald's 25th Anniversary Promos", "McDonald's Collection 2021", "mcd21"],
  [1455, "Best of Promos", "Best of Game", "bp"],
];

for (const [groupId, groupName, setName, providerId] of reviewedEnglishGroupMappings) {
  test(`maps reviewed TCGCSV group ${groupId} to ${providerId}`, () => {
    const group = { groupId, name: groupName };
    const set = { id: `set-${providerId}`, name: setName, providerId };

    assert.deepEqual(matchTcgcsvCardGroupsToSets([group], [set]), [{ group, set }]);
  });
}

test("requires both parts of a reviewed TCGCSV group identity", () => {
  const sets = [
    { id: "set-sv1", name: "Scarlet & Violet", providerId: "sv1" },
    { id: "set-ecard1", name: "Expedition Base Set", providerId: "ecard1" },
  ];

  assert.deepEqual(matchTcgcsvCardGroupsToSets([
    { groupId: 22873, name: "Unexpected replacement group" },
    { groupId: 99999, name: "Expedition" },
  ], sets), []);
});

test("does not apply a reviewed group alias when its provider identity is ambiguous", () => {
  const duplicateSets = [
    { id: "set-sv1-a", name: "Local set A", providerId: "sv1" },
    { id: "set-sv1-b", name: "Local set B", providerId: "sv1" },
  ];

  assert.deepEqual(matchTcgcsvCardGroupsToSets([
    { groupId: 22873, name: "SV01: Scarlet & Violet Base Set" },
  ], duplicateSets), []);
});

test("gives an exact reviewed identity precedence over a coincidental set-name match", () => {
  const reviewedTarget = { id: "set-sv1", name: "Scarlet & Violet", providerId: "sv1" };
  const coincidentalName = {
    id: "set-other",
    name: "Scarlet & Violet Base Set",
    providerId: "other1",
  };
  const group = { groupId: 22873, name: "SV01: Scarlet & Violet Base Set" };

  assert.deepEqual(matchTcgcsvCardGroupsToSets([group], [coincidentalName]), []);
  assert.deepEqual(
    matchTcgcsvCardGroupsToSets([group], [reviewedTarget, coincidentalName]),
    [{ group, set: reviewedTarget }],
  );
});

test("lets a reviewed group exclusively own its local set target", () => {
  const target = { id: "set-sv1", name: "Scarlet & Violet", providerId: "sv1" };
  const genericGroup = { groupId: 99999, name: "Scarlet & Violet" };
  const reviewedGroup = { groupId: 22873, name: "SV01: Scarlet & Violet Base Set" };

  assert.deepEqual(
    matchTcgcsvCardGroupsToSets([genericGroup, reviewedGroup], [target]),
    [{ group: reviewedGroup, set: target }],
  );
  assert.deepEqual(
    matchTcgcsvCardGroupsToSets([reviewedGroup, genericGroup], [target]),
    [{ group: reviewedGroup, set: target }],
  );
});

test("keeps a reviewed set target reserved when its provider group is absent or renamed", () => {
  const target = { id: "set-sv1", name: "Scarlet & Violet", providerId: "sv1" };
  const genericGroup = { groupId: 99999, name: "Scarlet & Violet" };
  const renamedReviewedGroup = { groupId: 22873, name: "Unexpected replacement group" };

  assert.deepEqual(matchTcgcsvCardGroupsToSets([genericGroup], [target]), []);
  assert.deepEqual(
    matchTcgcsvCardGroupsToSets([genericGroup, renamedReviewedGroup], [target]),
    [],
  );
});

test("maps reviewed Radiant Collection groups alongside their parent set groups", () => {
  const generations = { id: "set-g1", name: "Generations", providerId: "g1" };
  const legendaryTreasures = {
    id: "set-bw11",
    name: "Legendary Treasures",
    providerId: "bw11",
  };
  const groups = [
    { abbreviation: "GEN", groupId: 1728, name: "Generations" },
    { abbreviation: "GEN", groupId: 1729, name: "Generations: Radiant Collection" },
    { abbreviation: "LTR", groupId: 1409, name: "Legendary Treasures" },
    { abbreviation: "LTR", groupId: 1465, name: "Legendary Treasures: Radiant Collection" },
  ];

  assert.deepEqual(matchTcgcsvCardGroupsToSets(groups, [generations, legendaryTreasures]), [
    { group: groups[0], set: generations },
    { group: groups[2], set: legendaryTreasures },
    { group: groups[1], set: generations },
    { group: groups[3], set: legendaryTreasures },
  ]);
});

test("matches Pokemon Japan TCGCSV groups to TCGdex-backed Japanese sets", () => {
  const sets = [
    {
      id: "set-m2a",
      language: "ja",
      name: "MEGA Dream ex",
      providerIds: { tcgdex: "m2a", tcgdex_ja: "m2a" },
    },
    {
      id: "set-m5",
      language: "ja",
      name: "Abyss Eye",
      providerIds: { tcgdex: "m5", tcgdex_ja: "m5" },
    },
  ];

  const matches = matchTcgcsvCardGroupsToSets(
      [
        { abbreviation: "M2a", groupId: 24499, name: "M2a: High Class Pack: MEGA Dream ex" },
        { abbreviation: "M5", groupId: 24711, name: "M5: Abyss Eye" },
      ],
      sets,
    ).sort((left, right) => left.group.groupId - right.group.groupId);

  assert.deepEqual(
    matches,
    [
      { group: { abbreviation: "M2a", groupId: 24499, name: "M2a: High Class Pack: MEGA Dream ex" }, set: sets[0] },
      { group: { abbreviation: "M5", groupId: 24711, name: "M5: Abyss Eye" }, set: sets[1] },
    ],
  );
});

test("imports Japanese card price snapshots from the Pokemon Japan category", async () => {
  const attemptWrites = [];
  const imageUpdates = [];
  const snapshots = [];
  const requestedUrls = [];
  const cardSetFinds = [];
  const prisma = {
    $executeRaw: async (query) => {
      attemptWrites.push(query);
      return 1;
    },
    cardPrinting: {
      findMany: async () => [
        { id: "card-ja-1", name: "ヤンマ", number: "002" },
      ],
      update: async ({ data, where }) => {
        imageUpdates.push({ data, where });
        return { id: where.id, ...data };
      },
    },
    cardSet: {
      findMany: async (args) => {
        cardSetFinds.push(args);
        return [{
          cardPrintings: [{ _count: { priceSnapshots: 0 } }],
          id: "set-m2a",
          language: "ja",
          name: "MEGA Dream ex",
          providerIds: { tcgdex_ja: "m2a" },
          total: 193,
        }];
      },
    },
    priceSnapshot: {
      create: async ({ data }) => {
        snapshots.push(data);
        return { id: "snapshot-ja-1", ...data };
      },
      findFirst: async () => null,
    },
  };
  const fetchImpl = async (url) => {
    requestedUrls.push(url);

    return {
      ok: true,
      json: async () => {
        if (url.endsWith("/groups")) {
          return {
            success: true,
            results: [{ abbreviation: "M2a", groupId: 24499, name: "M2a: High Class Pack: MEGA Dream ex" }],
          };
        }

        if (url.endsWith("/24499/products")) {
          return {
            success: true,
            results: [
              {
                extendedData: [{ name: "Number", value: "002/193" }],
                name: "Yanma",
                productId: 665673,
                url: "https://example.com/product/665673",
              },
            ],
          };
        }

        return {
          success: true,
          results: [
            {
              marketPrice: 5,
              productId: 665673,
              subTypeName: "Normal",
            },
          ],
        };
      },
    };
  };

  const summary = await syncTcgcsvCardPrices({
    categoryId: 85,
    fetchImpl,
    language: "ja",
    prisma,
    source: "tcgcsv-japan-card",
    usdToGbpRate: 0.8,
    waitMs: 0,
  });

  assert.equal(summary.categoryId, 85);
  assert.equal(summary.language, "ja");
  assert.equal(summary.groupsMatched, 1);
  assert.equal(summary.cardProductsMatched, 1);
  assert.equal(summary.cardImagesUpdated, 1);
  assert.equal(summary.catalogueCardsAvailable, 1);
  assert.equal(summary.catalogueCardsExpected, 193);
  assert.equal(summary.catalogueIncompleteGroups, 1);
  assert.deepEqual(summary.sampleIncompleteGroups, [{
    cardsAvailable: 1,
    cardsExpected: 193,
    groupId: 24499,
    setId: "set-m2a",
    setName: "MEGA Dream ex",
  }]);
  assert.equal(summary.pricingSnapshotsCreated, 1);
  assert.deepEqual(cardSetFinds[0].where, { language: "ja" });
  assert.equal(requestedUrls[0], "https://tcgcsv.com/tcgplayer/85/groups");
  assert.equal(snapshots[0].cardPrintingId, "card-ja-1");
  assert.equal(snapshots[0].language, "ja");
  assert.equal(snapshots[0].priceMinor, 400);
  assert.equal(snapshots[0].source, "tcgcsv-japan-card");
  assert.equal(snapshots[0].metadata.categoryId, 85);
  assert.equal(attemptWrites.length, 1);
  assert.match(attemptWrites[0].text, /UPDATE card_sets/);
  assert.ok(attemptWrites[0].values.includes("tcgcsv-japan-card"));
  assert.ok(attemptWrites[0].values.includes("set-m2a"));
  const attemptRecord = JSON.parse(attemptWrites[0].values.find((value) =>
    typeof value === "string" && value.startsWith('{"attemptedAt"')));
  assert.equal(attemptRecord.groupId, "24499");
  assert.equal(attemptRecord.outcome, "priced");
  assert.equal(attemptRecord.pricingSnapshotsCreated, 1);
  assert.deepEqual(imageUpdates, [
    {
      data: {
        imageLargeUrl: "https://tcgplayer-cdn.tcgplayer.com/product/665673_in_1000x1000.jpg",
        imageSmallUrl: "https://tcgplayer-cdn.tcgplayer.com/product/665673_200w.jpg",
      },
      where: { id: "card-ja-1" },
    },
  ]);
});

test("rotates Japanese card pricing through unpriced and oldest-priced groups", async () => {
  const imageUpdates = [];
  const snapshots = [];
  const requestedProductUrls = [];
  const cardsBySet = new Map([
    ["set-empty", [{ id: "card-empty", name: "Pikachu", number: "001" }]],
    ["set-old", [{ id: "card-old", name: "Charmander", number: "002" }]],
    ["set-recent", [{ id: "card-recent", name: "Squirtle", number: "003" }]],
  ]);
  const prisma = {
    cardPrinting: {
      findMany: async ({ where }) => cardsBySet.get(where.cardSetId) ?? [],
      update: async ({ data, where }) => {
        imageUpdates.push({ data, where });
        return { id: where.id, ...data };
      },
    },
    cardSet: {
      findMany: async () => [
        {
          cardPrintings: [{ priceSnapshots: [{ observedAt: new Date("2026-07-13T00:00:00.000Z"), source: "tcgcsv-japan-card" }] }],
          id: "set-recent",
          language: "ja",
          name: "Recent Set",
          providerIds: { tcgdex_ja: "m2a" },
        },
        {
          cardPrintings: [{ priceSnapshots: [{ observedAt: new Date("2026-01-01T00:00:00.000Z"), source: "tcgcsv-japan-card" }] }],
          id: "set-old",
          language: "ja",
          name: "Old Set",
          providerIds: { tcgdex_ja: "m5" },
        },
        {
          cardPrintings: [{ priceSnapshots: [] }],
          id: "set-empty",
          language: "ja",
          name: "Empty Set",
          providerIds: { tcgdex_ja: "m6" },
        },
      ],
    },
    priceSnapshot: {
      create: async ({ data }) => {
        snapshots.push(data);
        return { id: `snapshot-${snapshots.length}`, ...data };
      },
      findFirst: async () => ({ id: "existing-snapshot" }),
    },
  };
  const fetchImpl = async (url) => {
    if (url.includes("/products")) {
      requestedProductUrls.push(url);
    }

    return {
      ok: true,
      json: async () => {
        if (url.endsWith("/groups")) {
          return {
            success: true,
            results: [
              { abbreviation: "M2a", groupId: 301, name: "M2a: Recent Set" },
              { abbreviation: "M5", groupId: 302, name: "M5: Old Set" },
              { abbreviation: "M6", groupId: 303, name: "M6: Empty Set" },
            ],
          };
        }

        if (url.endsWith("/303/products")) {
          return {
            success: true,
            results: [{ extendedData: [{ name: "Number", value: "001/100" }], name: "Pikachu", productId: 3031 }],
          };
        }

        if (url.endsWith("/302/products")) {
          return {
            success: true,
            results: [{ extendedData: [{ name: "Number", value: "002/100" }], name: "Charmander", productId: 3021 }],
          };
        }

        if (url.endsWith("/301/products")) {
          return {
            success: true,
            results: [{ extendedData: [{ name: "Number", value: "003/100" }], name: "Squirtle", productId: 3011 }],
          };
        }

        const productId = url.includes("/303/") ? 3031 : url.includes("/302/") ? 3021 : 3011;

        return {
          success: true,
          results: [{ marketPrice: 5, productId, subTypeName: "Normal" }],
        };
      },
    };
  };

  const summary = await syncTcgcsvCardPrices({
    categoryId: 85,
    fetchImpl,
    groupLimit: 2,
    language: "ja",
    priceOnlyUnpriced: false,
    prisma,
    source: "tcgcsv-japan-card",
    usdToGbpRate: 0.8,
    waitMs: 0,
  });

  assert.equal(summary.groupsMatched, 2);
  assert.equal(summary.cardImagesUpdated, 2);
  assert.equal(summary.pricingSnapshotsCreated, 2);
  assert.deepEqual(requestedProductUrls, [
    "https://tcgcsv.com/tcgplayer/85/303/products",
    "https://tcgcsv.com/tcgplayer/85/302/products",
  ]);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.cardPrintingId), ["card-empty", "card-old"]);
  assert.deepEqual(imageUpdates.map((update) => update.where.id), ["card-empty", "card-old"]);
});

test("imports card price snapshots from TCGCSV payloads", async () => {
  const snapshots = [];
  const imageUpdates = [];
  const prisma = {
    cardPrinting: {
      findMany: async () => [
        { id: "card-1", imageLargeUrl: null, imageSmallUrl: "", name: "Lugia VSTAR", number: "139" },
      ],
      update: async ({ data, where }) => {
        imageUpdates.push({ data, where });
        return { id: where.id, ...data };
      },
    },
    cardSet: {
      findMany: async () => [{ id: "set-1", name: "Silver Tempest" }],
    },
    priceSnapshot: {
      create: async ({ data }) => {
        snapshots.push(data);
        return { id: "snapshot-1", ...data };
      },
      findFirst: async () => null,
    },
  };
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => {
      if (url.endsWith("/groups")) {
        return {
          success: true,
          results: [{ groupId: 3170, name: "SWSH12: Silver Tempest" }],
        };
      }

      if (url.endsWith("/3170/products")) {
        return {
          success: true,
          results: [
            {
              extendedData: [{ name: "Number", value: "139/195" }],
              imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/101_200w.jpg",
              name: "Lugia VSTAR",
              productId: 101,
              url: "https://example.com/product/101",
            },
            {
              extendedData: [{ name: "CardText", value: "36 packs" }],
              name: "Silver Tempest Booster Box",
              productId: 100,
            },
          ],
        };
      }

      return {
        success: true,
        results: [
          {
            marketPrice: 12,
            productId: 101,
            subTypeName: "Holofoil",
          },
          {
            marketPrice: 7,
            productId: 101,
            subTypeName: "Reverse Holofoil",
          },
        ],
      };
    },
  });

  const summary = await syncTcgcsvCardPrices({
    fetchImpl,
    prisma,
    usdToGbpRate: 0.8,
    waitMs: 0,
  });

  assert.equal(summary.groupsMatched, 1);
  assert.equal(summary.groupsProcessed, 1);
  assert.equal(summary.productsFetched, 2);
  assert.equal(summary.cardProductsMatched, 1);
  assert.equal(summary.cardProductsSkipped, 1);
  assert.equal(summary.cardImagesUpdated, 1);
  assert.equal(summary.pricingSnapshotsCreated, 2);
  assert.deepEqual(imageUpdates, [
    {
      data: {
        imageLargeUrl: "https://tcgplayer-cdn.tcgplayer.com/product/101_in_1000x1000.jpg",
        imageSmallUrl: "https://tcgplayer-cdn.tcgplayer.com/product/101_200w.jpg",
      },
      where: { id: "card-1" },
    },
  ]);
  assert.equal(snapshots[0].cardPrintingId, "card-1");
  assert.equal(snapshots[0].priceMinor, 960);
  assert.equal(snapshots[0].source, "tcgcsv-card");
  assert.equal(snapshots[0].variantLabel, "Holofoil");
  assert.equal(snapshots[1].priceMinor, 560);
  assert.equal(snapshots[1].variantLabel, "Reverse Holofoil");
});

test("reads card pricing options from env", () => {
  assert.deepEqual(
    cardPricingOptionsFromEnv({
      TCGCSV_CARD_GROUP_IDS: "3170, 6052",
      TCGCSV_CARD_CATEGORY_ID: "3",
      TCGCSV_CARD_GROUP_LIMIT: "2",
      TCGCSV_CARD_MIN_UNPRICED: "25",
      TCGCSV_CARD_ONLY_UNPRICED_GROUPS: "true",
      TCGCSV_CARD_PRICE_ONLY_UNPRICED: "false",
      TCGCSV_CARD_WRITE_PRICES: "true",
      TCGCSV_USD_TO_GBP_RATE: "0.8",
    }),
    {
      apiRetryAttempts: 3,
      apiRetryWaitMs: 500,
      apiTimeoutMs: 10_000,
      categoryId: 3,
      groupIds: ["3170", "6052"],
      groupLimit: 2,
      language: "en",
      minUnpricedCards: 25,
      onlyUnpricedGroups: true,
      priceOnlyUnpriced: false,
      source: "tcgcsv-card",
      usdToGbpRate: 0.8,
      writePrices: true,
    },
  );
});

test("reads Japanese card pricing options from env", () => {
  assert.deepEqual(
    japanCardPricingOptionsFromEnv({
      TCGCSV_JAPAN_CARD_GROUP_LIMIT: "4",
      TCGCSV_JAPAN_CARD_ONLY_UNPRICED_GROUPS: "false",
      TCGCSV_JAPAN_CARD_PRICE_ONLY_UNPRICED: "false",
      TCGCSV_JAPAN_CARD_WAIT_MS: "250",
      TCGCSV_JAPAN_USD_TO_GBP_RATE: "0.77",
    }),
    {
      apiRetryAttempts: 3,
      apiRetryWaitMs: 500,
      apiTimeoutMs: 10_000,
      categoryId: 85,
      groupIds: [],
      groupLimit: 4,
      language: "ja",
      minUnpricedCards: 1,
      onlyUnpricedGroups: false,
      priceOnlyUnpriced: false,
      source: "tcgcsv-japan-card",
      usdToGbpRate: 0.77,
      waitMs: 250,
      writePrices: true,
    },
  );
});
