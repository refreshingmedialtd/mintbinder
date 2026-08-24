import assert from "node:assert/strict";
import test from "node:test";
import {
  cardTraderMarketplacePrice,
  cardTraderSealedOptionsFromEnv,
  matchCardTraderExpansion,
  syncCardTraderSealedPrices,
} from "../scripts/cardtrader-sealed-pricing.mjs";

test("reads CardTrader sealed pricing options and enables them when a token exists", () => {
  assert.deepEqual(
    cardTraderSealedOptionsFromEnv({
      CARDTRADER_API_TOKEN: "token",
      CARDTRADER_EUR_TO_GBP_RATE: "0.84",
      CARDTRADER_SEALED_PRICE_ONLY_UNPRICED: "true",
      CARDTRADER_SEALED_PRODUCT_LIMIT: "7",
      CARDTRADER_SEALED_SET_LIMIT: "2",
      CARDTRADER_SEALED_WAIT_MS: "250",
      CARDTRADER_SEALED_WRITE_PRICES: "false",
      CARDTRADER_USD_TO_GBP_RATE: "0.75",
    }),
    {
      enabled: true,
      eurToGbpRate: 0.84,
      limit: 7,
      priceOnlyUnpriced: true,
      setLimit: 2,
      token: "token",
      usdToGbpRate: 0.75,
      waitMs: 250,
      writePrices: false,
    },
  );
});

test("uses a conservative median of the five lowest eligible CardTrader listings", () => {
  const response = {
    20: [
      listing(1_000, "GBP"),
      listing(1_100, "GBP"),
      listing(1_200, "GBP"),
      listing(1_300, "GBP"),
      listing(1_400, "GBP"),
      listing(100, "GBP", { on_vacation: true }),
      listing(200, "GBP", { graded: true }),
      listing(1_000, "EUR"),
    ],
  };

  assert.deepEqual(cardTraderMarketplacePrice(response, { EUR: 0.8, GBP: 1 }), {
    confidenceScore: 64,
    currencies: ["EUR", "GBP"],
    listingCount: 6,
    offerCount: 5,
    priceMinor: 1_100,
    samplePricesMinor: [800, 1_000, 1_100, 1_200, 1_300],
  });
});

test("matches EX-era CardTrader expansions to local vintage set names", () => {
  assert.deepEqual(
    matchCardTraderExpansion(
      [{ metadata: {}, relatedCardSet: { name: "Hidden Legends" } }],
      [
        { id: 1, name: "Modern Set" },
        { id: 2, name: "EX Hidden Legends" },
      ],
    ),
    { id: 2, name: "EX Hidden Legends" },
  );
});

test("imports a CardTrader sealed marketplace snapshot by direct TCGplayer identity", async () => {
  const snapshots = [];
  const productUpdates = [];
  const requestedUrls = [];
  const prisma = {
    priceSnapshot: {
      create: async ({ data }) => {
        snapshots.push(data);
        return { id: "snapshot-1", ...data };
      },
      findFirst: async () => null,
      update: async () => {
        throw new Error("unexpected daily update");
      },
    },
    sealedProduct: {
      findMany: async () => [
        {
          id: "sealed-1",
          metadata: { groupName: "SWSH12: Silver Tempest" },
          name: "Silver Tempest Booster Box",
          priceSnapshots: [],
          productType: "BOOSTER_BOX",
          providerIds: { tcgplayer: "100" },
          relatedCardSet: { id: "set-1", name: "Silver Tempest" },
        },
      ],
      update: async ({ data, where }) => {
        productUpdates.push({ data, where });
        return { id: where.id, ...data };
      },
    },
  };
  const fetchImpl = async (url, init) => {
    requestedUrls.push(url.toString());
    assert.equal(init.headers.authorization, "Bearer token");

    if (url.pathname.endsWith("/games")) {
      return jsonResponse([{ id: 15, name: "pokemon-tcg", display_name: "Pokémon" }]);
    }

    if (url.pathname.endsWith("/expansions")) {
      return jsonResponse([{ game_id: 15, id: 10, name: "Silver Tempest" }]);
    }

    if (url.pathname.endsWith("/blueprints/export")) {
      assert.equal(url.searchParams.get("expansion_id"), "10");
      return jsonResponse([{ id: 20, name: "Silver Tempest Booster Box", tcg_player_id: "100" }]);
    }

    assert.equal(url.pathname.endsWith("/marketplace/products"), true);
    assert.equal(url.searchParams.get("blueprint_id"), "20");
    assert.equal(url.searchParams.get("language"), "en");
    return jsonResponse({
      20: [
        listing(10_000, "GBP"),
        listing(12_000, "GBP"),
        listing(14_000, "GBP"),
      ],
    });
  };

  const summary = await syncCardTraderSealedPrices({
    fetchImpl,
    limit: 1,
    prisma,
    token: "token",
    waitMs: 0,
  });

  assert.equal(summary.apiRequests, 4);
  assert.equal(summary.blueprintsMatched, 1);
  assert.equal(summary.candidatesChecked, 1);
  assert.equal(summary.pricingSnapshotsCreated, 1);
  assert.equal(productUpdates[0].where.id, "sealed-1");
  assert.equal(productUpdates[0].data.providerIds.cardtrader, "20");
  assert.equal(snapshots[0].priceMinor, 12_000);
  assert.equal(snapshots[0].source, "cardtrader-sealed");
  assert.equal(snapshots[0].sourceRef, "20");
  assert.equal(requestedUrls.length, 4);
});

function listing(cents, currency, extra = {}) {
  return {
    graded: false,
    on_vacation: false,
    price: { cents, currency },
    quantity: 1,
    ...extra,
  };
}

function jsonResponse(body, status = 200) {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
}
