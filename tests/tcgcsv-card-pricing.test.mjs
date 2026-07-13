import assert from "node:assert/strict";
import test from "node:test";
import {
  cardPricingOptionsFromEnv,
  isCardProduct,
  japanCardPricingOptionsFromEnv,
  matchTcgcsvCardGroupsToSets,
  matchTcgcsvCardProduct,
  syncTcgcsvCardPrices,
} from "../scripts/tcgcsv-card-pricing.mjs";

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
  const snapshots = [];
  const requestedUrls = [];
  const cardSetFinds = [];
  const prisma = {
    cardPrinting: {
      findMany: async () => [
        { id: "card-ja-1", name: "ヤンマ", number: "002" },
      ],
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
  assert.equal(summary.pricingSnapshotsCreated, 1);
  assert.deepEqual(cardSetFinds[0].where, { language: "ja" });
  assert.equal(requestedUrls[0], "https://tcgcsv.com/tcgplayer/85/groups");
  assert.equal(snapshots[0].cardPrintingId, "card-ja-1");
  assert.equal(snapshots[0].language, "ja");
  assert.equal(snapshots[0].priceMinor, 400);
  assert.equal(snapshots[0].source, "tcgcsv-japan-card");
  assert.equal(snapshots[0].metadata.categoryId, 85);
});

test("imports card price snapshots from TCGCSV payloads", async () => {
  const snapshots = [];
  const prisma = {
    cardPrinting: {
      findMany: async () => [
        { id: "card-1", name: "Lugia VSTAR", number: "139" },
      ],
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
  assert.equal(summary.pricingSnapshotsCreated, 2);
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
