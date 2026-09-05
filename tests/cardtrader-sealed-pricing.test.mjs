import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCardTraderBlueprintIndex,
  cardTraderMarketplacePrice,
  cardTraderSealedOptionsFromEnv,
  matchCardTraderExpansion,
  normalizeCardTraderProductIds,
  normalizeManualAliases,
  resolveCardTraderBlueprint,
  syncCardTraderSealedPrices,
} from "../scripts/cardtrader-sealed-pricing.mjs";
import { cardTraderSealedImportOptionsFromEnv } from "../scripts/import-cardtrader-sealed-prices.mjs";

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
      apiRetryAttempts: 3,
      apiRetryWaitMs: 500,
      apiTimeoutMs: 10_000,
      enabled: true,
      eurToGbpRate: 0.84,
      limit: 7,
      manualAliases: undefined,
      priceOnlyUnpriced: true,
      setLimit: 2,
      token: "token",
      usdToGbpRate: 0.75,
      waitMs: 250,
      writePrices: false,
    },
  );
});

test("validates and bounds importer-only CardTrader product IDs", () => {
  const first = "11111111-1111-1111-1111-111111111111";
  const second = "22222222-2222-2222-2222-222222222222";

  assert.deepEqual(normalizeCardTraderProductIds(`${first}, ${second},${first}`), [first, second]);
  assert.throws(
    () => normalizeCardTraderProductIds("not-a-uuid"),
    /must all be valid UUIDs/,
  );
  assert.throws(
    () => normalizeCardTraderProductIds(
      Array.from({ length: 21 }, (_, index) =>
        `${String(index + 1).padStart(8, "0")}-0000-0000-0000-000000000000`
      ),
    ),
    /at most 20 product IDs/,
  );
});

test("applies targeted IDs only to the direct CardTrader importer options", () => {
  const first = "11111111-1111-1111-1111-111111111111";
  const second = "22222222-2222-2222-2222-222222222222";
  const options = cardTraderSealedImportOptionsFromEnv({
    CARDTRADER_API_TOKEN: "token",
    CARDTRADER_SEALED_PRODUCT_IDS: `${first},${second}`,
  });

  assert.deepEqual(options.productIds, [first, second]);
  assert.equal(options.limit, 2);
  assert.equal(options.setLimit, 2);
  assert.equal(
    Object.hasOwn(cardTraderSealedOptionsFromEnv({ CARDTRADER_API_TOKEN: "token" }), "productIds"),
    false,
  );
});

test("filters a targeted CardTrader sync to its validated product IDs", async () => {
  const productId = "11111111-1111-1111-1111-111111111111";
  let where;
  const prisma = {
    sealedProduct: {
      findMany: async (request) => {
        where = request.where;
        return [];
      },
    },
  };

  const summary = await syncCardTraderSealedPrices({
    prisma,
    productIds: [productId],
    token: "token",
    waitMs: 0,
  });

  assert.deepEqual(where.id, { in: [productId] });
  assert.equal(summary.targetedProductCount, 1);
  assert.equal(summary.status, "degraded");
});

test("matches expansion-scoped blueprints by UPC before normalized name and type", () => {
  const blueprints = [
    {
      fixed_properties: [{ name: "UPC", value: "820650123456" }],
      id: 20,
      name: "Different regional display name",
    },
    {
      fixed_properties: [{ name: "UPC", value: "820650999999" }],
      id: 21,
      name: "Silver Tempest Booster Box",
    },
  ];
  const result = resolveCardTraderBlueprint(
    sealedProduct({ metadata: { upc: "8 20650 123456" } }),
    buildCardTraderBlueprintIndex(blueprints),
  );

  assert.equal(result.blueprint.id, 20);
  assert.equal(result.method, "identifier");
});

test("uses exact normalized name and compatible sealed type as a conservative fallback", () => {
  const result = resolveCardTraderBlueprint(
    sealedProduct({ name: "Pokémon TCG: Alakazam V Box", productType: "COLLECTION_BOX" }),
    buildCardTraderBlueprintIndex([
      { id: 20, name: "Pokemon Alakazam V Box" },
      { id: 21, name: "Alakazam V Box Case" },
    ]),
  );

  assert.equal(result.blueprint.id, 20);
  assert.equal(result.method, "normalizedNameType");
});

test("rejects ambiguous normalized fallback matches and emits review candidates", () => {
  const result = resolveCardTraderBlueprint(
    sealedProduct({ name: "Alakazam V Box", productType: "COLLECTION_BOX" }),
    buildCardTraderBlueprintIndex([
      { id: 20, name: "Alakazam V Box" },
      { id: 21, name: "Pokemon Alakazam V Box" },
    ]),
  );

  assert.equal(result.blueprint, null);
  assert.equal(result.ambiguous, true);
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), [20, 21]);
});

test("matches a uniquely reordered sealed product name with the same complete token set and type", () => {
  const result = resolveCardTraderBlueprint(
    sealedProduct({
      name: "Mega Evolution 3 Pack Blister [Psyduck]",
      productType: "BLISTER",
    }),
    buildCardTraderBlueprintIndex([
      { id: 20, name: "Mega Evolution: Psyduck 3-Pack Blister" },
      { id: 21, name: "Mega Evolution: Golduck 3-Pack Blister" },
    ]),
  );

  assert.equal(result.blueprint.id, 20);
  assert.equal(result.method, "normalizedTokenType");
});

test("rejects an ambiguous reordered-token fallback", () => {
  const result = resolveCardTraderBlueprint(
    sealedProduct({
      name: "Mega Evolution 3 Pack Blister [Psyduck]",
      productType: "BLISTER",
    }),
    buildCardTraderBlueprintIndex([
      { id: 20, name: "Mega Evolution: Psyduck 3-Pack Blister" },
      { id: 21, name: "Psyduck Mega Evolution 3 Pack Blister" },
    ]),
  );

  assert.equal(result.blueprint, null);
  assert.equal(result.ambiguous, true);
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), [20, 21]);
});

test("does not use reordered-token fallback when a product name token is missing or extra", () => {
  const index = buildCardTraderBlueprintIndex([
    { id: 20, name: "Mega Evolution: Psyduck 3-Pack Blister" },
  ]);
  const missingToken = resolveCardTraderBlueprint(
    sealedProduct({
      name: "Evolution 3 Pack Blister [Psyduck]",
      productType: "BLISTER",
    }),
    index,
  );
  const extraToken = resolveCardTraderBlueprint(
    sealedProduct({
      name: "Mega Evolution 3 Pack Promo Blister [Psyduck]",
      productType: "BLISTER",
    }),
    index,
  );

  assert.equal(missingToken.blueprint, null);
  assert.equal(extraToken.blueprint, null);
});

test("does not use reordered-token fallback across incompatible product types", () => {
  const result = resolveCardTraderBlueprint(
    sealedProduct({
      name: "Mega Evolution 3 Pack Blister [Psyduck]",
      productType: "BLISTER",
    }),
    buildCardTraderBlueprintIndex([
      {
        id: 20,
        name: "Mega Evolution: Psyduck 3-Pack Blister",
        product_type: "TIN",
      },
    ]),
  );

  assert.equal(result.blueprint, null);
});

test("manual aliases only resolve to a blueprint inside the matched expansion", () => {
  const index = buildCardTraderBlueprintIndex([{ id: 20, name: "Regional product name" }]);
  const product = sealedProduct();
  const matched = resolveCardTraderBlueprint(
    product,
    index,
    normalizeManualAliases({ "tcgplayer:100": "20" }),
  );
  const missing = resolveCardTraderBlueprint(
    product,
    index,
    normalizeManualAliases({ "tcgplayer:100": "999" }),
  );

  assert.equal(matched.blueprint.id, 20);
  assert.equal(matched.method, "manualAlias");
  assert.equal(missing.blueprint, null);
  assert.match(missing.reason, /not present in the matched expansion/);
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
      return jsonResponse({ data: [{ id: 15, name: "pokemon-tcg", display_name: "Pokémon" }] });
    }

    if (url.pathname.endsWith("/expansions")) {
      return jsonResponse({
        expansions: [{ game_id: 15, id: 10, name: "Silver Tempest" }],
      });
    }

    if (url.pathname.endsWith("/blueprints/export")) {
      assert.equal(url.searchParams.get("expansion_id"), "10");
      return jsonResponse({
        results: [{ id: 20, name: "Silver Tempest Booster Box", tcg_player_id: "100" }],
      });
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

test("includes products without a TCGplayer ID so conservative fallback mapping can produce output", async () => {
  const updates = [];
  const prisma = {
    sealedProduct: {
      findMany: async () => [
        {
          id: "sealed-without-tcgplayer",
          metadata: { groupName: "SWSH12: Silver Tempest" },
          name: "Pokémon TCG: Alakazam V Box",
          priceSnapshots: [],
          productType: "COLLECTION_BOX",
          providerIds: {},
          relatedCardSet: { id: "set-1", name: "Silver Tempest" },
        },
      ],
      update: async ({ data, where }) => {
        updates.push({ data, where });
        return { id: where.id, ...data };
      },
    },
  };
  const fetchImpl = async (url) => {
    if (url.pathname.endsWith("/games")) {
      return jsonResponse({ data: [{ id: 15, display_name: "Pokémon" }] });
    }

    if (url.pathname.endsWith("/expansions")) {
      return jsonResponse({ expansions: [{ game_id: 15, id: 10, name: "Silver Tempest" }] });
    }

    if (url.pathname.endsWith("/blueprints/export")) {
      return jsonResponse({ results: [{ id: 20, name: "Pokemon Alakazam V Box" }] });
    }

    return jsonResponse({ 20: [listing(10_000, "GBP")] });
  };

  const summary = await syncCardTraderSealedPrices({
    fetchImpl,
    limit: 1,
    prisma,
    token: "token",
    waitMs: 0,
    writePrices: false,
  });

  assert.equal(summary.candidatesAvailable, 1);
  assert.equal(summary.blueprintsMatched, 1);
  assert.equal(summary.marketplaceMatches, 1);
  assert.equal(summary.mappingMethods.normalizedNameType, 1);
  assert.equal(summary.status, "succeeded");
  assert.equal(updates[0].data.providerIds.cardtrader, "20");
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

function sealedProduct(overrides = {}) {
  return {
    id: "sealed-1",
    metadata: {},
    name: "Silver Tempest Booster Box",
    productType: "BOOSTER_BOX",
    providerIds: { tcgplayer: "100" },
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
}
