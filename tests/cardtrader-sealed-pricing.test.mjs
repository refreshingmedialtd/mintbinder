import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCardTraderBlueprintIndex,
  cardTraderMarketplacePrice,
  cardTraderSealedOptionsFromEnv,
  matchCardTraderExpansion,
  normalizeManualAliases,
  resolveCardTraderBlueprint,
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
