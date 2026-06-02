import assert from "node:assert/strict";
import test from "node:test";
import {
  bestPriceChartingSealedPrice,
  findPriceChartingMatch,
  priceChartingNameScore,
  priceChartingSealedOptionsFromEnv,
  syncPriceChartingSealedPrices,
} from "../scripts/pricecharting-sealed-pricing.mjs";

test("reads PriceCharting sealed pricing options from env", () => {
  assert.deepEqual(
    priceChartingSealedOptionsFromEnv({
      PRICECHARTING_API_TOKEN: "token",
      PRICECHARTING_SEALED_LIMIT: "8",
      PRICECHARTING_SEALED_PRICE_ONLY_UNPRICED: "false",
      PRICECHARTING_SEALED_USE_NAME_SEARCH: "false",
      PRICECHARTING_SEALED_WAIT_MS: "1500",
      PRICECHARTING_SEALED_WRITE_PRICES: "true",
      PRICECHARTING_USD_TO_GBP_RATE: "0.8",
    }),
    {
      limit: 8,
      priceOnlyUnpriced: false,
      token: "token",
      usdToGbpRate: 0.8,
      useNameSearch: false,
      waitMs: 1500,
      writePrices: true,
    },
  );
});

test("selects PriceCharting new price for sealed products", () => {
  assert.deepEqual(
    bestPriceChartingSealedPrice({ "new-price": 12000, status: "success" }),
    { field: "new-price", priceMinor: 12000 },
  );
  assert.equal(bestPriceChartingSealedPrice({ "loose-price": 9000, status: "success" }), null);
});

test("scores strong sealed product name matches and rejects wrong product types", () => {
  assert.equal(
    priceChartingNameScore(
      { name: "Silver Tempest Booster Box", productType: "BOOSTER_BOX" },
      { "product-name": "Pokemon Silver Tempest Booster Box" },
    ),
    1,
  );
  assert.equal(
    priceChartingNameScore(
      { name: "Silver Tempest Booster Box", productType: "BOOSTER_BOX" },
      { "product-name": "Lugia VSTAR Silver Tempest" },
    ),
    0,
  );
});

test("matches PriceCharting products by UPC before name search", async () => {
  const requests = [];
  const product = {
    id: "sealed-1",
    metadata: { upc: "0820650851234" },
    name: "Silver Tempest Booster Box",
    productType: "BOOSTER_BOX",
    providerIds: {},
  };
  const match = await findPriceChartingMatch({
    product,
    request: async (params) => {
      requests.push(params);
      return {
        "new-price": 25000,
        "product-name": "Pokemon Silver Tempest Booster Box",
        id: "12345",
        status: "success",
        upc: "0820650851234",
      };
    },
  });

  assert.deepEqual(requests, [{ upc: "0820650851234" }]);
  assert.equal(match.matchType, "upc");
  assert.equal(match.confidenceScore, 72);
});

test("imports PriceCharting sealed price snapshots", async () => {
  const snapshots = [];
  const prisma = {
    priceSnapshot: {
      create: async ({ data }) => {
        snapshots.push(data);
        return { id: "snapshot-1", ...data };
      },
    },
    sealedProduct: {
      findMany: async () => [
        {
          id: "sealed-1",
          metadata: { upc: "0820650851234" },
          name: "Silver Tempest Booster Box",
          productType: "BOOSTER_BOX",
          providerIds: {},
          relatedCardSet: { name: "Silver Tempest", series: "Sword & Shield" },
        },
      ],
    },
  };
  const fetchImpl = async (url) => {
    assert.equal(url.searchParams.get("t"), "token");
    assert.equal(url.searchParams.get("upc"), "0820650851234");

    return {
      ok: true,
      json: async () => ({
        "console-name": "Pokemon Cards",
        "genre": "Pokemon Card",
        "new-price": 25000,
        "product-name": "Pokemon Silver Tempest Booster Box",
        "upc": "0820650851234",
        id: "12345",
        status: "success",
      }),
    };
  };

  const summary = await syncPriceChartingSealedPrices({
    fetchImpl,
    limit: 1,
    prisma,
    token: "token",
    usdToGbpRate: 0.8,
    waitMs: 0,
  });

  assert.equal(summary.candidatesChecked, 1);
  assert.equal(summary.candidatesMatched, 1);
  assert.equal(summary.pricingSnapshotsCreated, 1);
  assert.equal(snapshots[0].sealedProductId, "sealed-1");
  assert.equal(snapshots[0].priceMinor, 20000);
  assert.equal(snapshots[0].source, "pricecharting-sealed");
  assert.equal(snapshots[0].sourceRef, "12345");
});
