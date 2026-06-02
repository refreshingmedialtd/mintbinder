import assert from "node:assert/strict";
import test from "node:test";
import {
  cardPricingOptionsFromEnv,
  isCardProduct,
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
  assert.equal(summary.pricingSnapshotsCreated, 1);
  assert.equal(snapshots[0].cardPrintingId, "card-1");
  assert.equal(snapshots[0].priceMinor, 960);
  assert.equal(snapshots[0].source, "tcgcsv-card");
  assert.equal(snapshots[0].variantLabel, "Holofoil");
});

test("reads card pricing options from env", () => {
  assert.deepEqual(
    cardPricingOptionsFromEnv({
      TCGCSV_CARD_GROUP_IDS: "3170, 6052",
      TCGCSV_CARD_GROUP_LIMIT: "2",
      TCGCSV_CARD_PRICE_ONLY_UNPRICED: "false",
      TCGCSV_CARD_WRITE_PRICES: "true",
      TCGCSV_USD_TO_GBP_RATE: "0.8",
    }),
    {
      groupIds: ["3170", "6052"],
      groupLimit: 2,
      priceOnlyUnpriced: false,
      usdToGbpRate: 0.8,
      writePrices: true,
    },
  );
});
