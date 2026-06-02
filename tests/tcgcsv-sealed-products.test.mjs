import assert from "node:assert/strict";
import test from "node:test";
import {
  bestTcgcsvPrice,
  groupDisplayName,
  isSealedProduct,
  matchTcgcsvGroupsToSets,
  sealedProductType,
} from "../scripts/tcgcsv-sealed-products.mjs";
import {
  sealedImportOptionsFromEnv,
  syncTcgcsvSealedProducts,
} from "../scripts/tcgcsv-sealed-importer.mjs";

test("detects sealed products while excluding cards and code cards", () => {
  assert.equal(isSealedProduct({
    name: "Silver Tempest Booster Box",
    extendedData: [{ name: "CardText", value: "36 packs" }],
  }), true);
  assert.equal(isSealedProduct({
    name: "Code Card - Fall 2022 Collector Chest",
    extendedData: [{ name: "Rarity", value: "Code Card" }],
  }), false);
  assert.equal(isSealedProduct({
    name: "Lugia VSTAR",
    extendedData: [{ name: "Number", value: "139/195" }],
  }), false);
});

test("maps sealed product names to local product types", () => {
  assert.equal(sealedProductType("Silver Tempest Booster Box"), "BOOSTER_BOX");
  assert.equal(sealedProductType("Silver Tempest Elite Trainer Box"), "ELITE_TRAINER_BOX");
  assert.equal(sealedProductType("Mini Tin Display Case"), "CASE");
  assert.equal(sealedProductType("Three Pack Blister"), "BLISTER");
});

test("matches TCGCSV group names to local set names", () => {
  assert.deepEqual(
    matchTcgcsvGroupsToSets(
      [{ groupId: 3170, name: "SWSH12: Silver Tempest" }],
      [{ id: "set-1", name: "Silver Tempest" }],
    ),
    [{ group: { groupId: 3170, name: "SWSH12: Silver Tempest" }, set: { id: "set-1", name: "Silver Tempest" } }],
  );

  assert.equal(groupDisplayName("SWSH12: Silver Tempest"), "Silver Tempest");
  assert.equal(groupDisplayName("SM - Guardians Rising"), "Guardians Rising");

  assert.deepEqual(
    matchTcgcsvGroupsToSets(
      [
        { groupId: 1919, name: "SM - Guardians Rising" },
        { groupId: 2364, name: "McDonald's Promos 2018" },
        { abbreviation: "SM01", groupId: 1863, name: "SM Base Set" },
      ],
      [
        { id: "set-2", name: "Guardians Rising" },
        { id: "set-3", name: "McDonald's Collection 2018" },
        { id: "set-4", name: "Sun & Moon", providerId: "sm1" },
      ],
    ),
    [
      { group: { groupId: 1919, name: "SM - Guardians Rising" }, set: { id: "set-2", name: "Guardians Rising" } },
      { group: { groupId: 2364, name: "McDonald's Promos 2018" }, set: { id: "set-3", name: "McDonald's Collection 2018" } },
      { group: { abbreviation: "SM01", groupId: 1863, name: "SM Base Set" }, set: { id: "set-4", name: "Sun & Moon", providerId: "sm1" } },
    ],
  );
});

test("selects the strongest usable TCGCSV sealed price", () => {
  assert.deepEqual(
    bestTcgcsvPrice([
      { lowPrice: 10, marketPrice: null, midPrice: 12, productId: 1, subTypeName: "Normal" },
      { lowPrice: 9, marketPrice: 11, midPrice: 12, productId: 1, subTypeName: "Damaged" },
    ]),
    {
      confidenceScore: 66,
      subTypeName: "Normal",
      usd: 12,
    },
  );
});

test("imports sealed products and GBP price snapshots from TCGCSV payloads", async () => {
  const upserts = [];
  const snapshots = [];
  const prisma = {
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
    sealedProduct: {
      findFirst: async () => null,
      upsert: async ({ create }) => {
        upserts.push(create);
        return { id: create.id };
      },
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
              extendedData: [{ name: "UPC", value: "123" }],
              imageUrl: "https://images.example/product_200w.jpg",
              modifiedOn: "2026-01-02T00:00:00.000Z",
              name: "Silver Tempest Booster Box",
              presaleInfo: { releasedOn: "2022-11-11T00:00:00.000Z" },
              productId: 100,
              url: "https://example.com/product/100",
            },
            {
              extendedData: [{ name: "Number", value: "139/195" }],
              name: "Lugia VSTAR",
              productId: 101,
            },
          ],
        };
      }

      return {
        success: true,
        results: [
          {
            marketPrice: 100,
            productId: 100,
            subTypeName: "Normal",
          },
        ],
      };
    },
  });

  const summary = await syncTcgcsvSealedProducts({
    fetchImpl,
    prisma,
    usdToGbpRate: 0.8,
    waitMs: 0,
  });

  assert.equal(summary.groupsMatched, 1);
  assert.equal(summary.groupsProcessed, 1);
  assert.equal(summary.productsFetched, 2);
  assert.equal(summary.sealedProductsSkipped, 1);
  assert.equal(summary.sealedProductsUpserted, 1);
  assert.equal(summary.pricingSnapshotsCreated, 1);
  assert.equal(upserts[0].productType, "BOOSTER_BOX");
  assert.equal(upserts[0].metadata.upc, "123");
  assert.equal(snapshots[0].priceMinor, 8000);
  assert.equal(snapshots[0].currency, "GBP");
});

test("reads sealed import options from env", () => {
  assert.deepEqual(
    sealedImportOptionsFromEnv({
      TCGCSV_SEALED_GROUP_IDS: "3170, 6052",
      TCGCSV_SEALED_GROUP_LIMIT: "2",
      TCGCSV_SEALED_PRICE_ONLY_UNPRICED: "false",
      TCGCSV_SEALED_WRITE_PRICES: "true",
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
