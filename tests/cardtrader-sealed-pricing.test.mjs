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
  selectCardTraderCandidates,
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
      refreshEveryHours: 4,
      setLimit: 2,
      token: "token",
      usdToGbpRate: 0.75,
      waitMs: 250,
      writePrices: false,
    },
  );
});

test("reserves every fourth UTC-hour slot for priced CardTrader refreshes", () => {
  const products = [
    rotationProduct("priced-old", "set-refresh", {
      attemptedAt: "2026-08-01T00:00:00.000Z",
      observedAt: "2026-08-01T00:00:00.000Z",
    }),
    rotationProduct("priced-new", "set-other", {
      attemptedAt: "2026-09-01T00:00:00.000Z",
      observedAt: "2026-09-01T00:00:00.000Z",
    }),
    rotationProduct("refresh-filler", "set-refresh", {
      attemptedAt: "2026-07-01T00:00:00.000Z",
    }),
    rotationProduct("discovery-old", "set-discovery", {
      attemptedAt: "2026-06-01T00:00:00.000Z",
    }),
  ];
  const selection = selectCardTraderCandidates(products, {
    limit: 5,
    now: "2026-09-05T12:50:00.000Z",
    refreshEveryHours: 4,
    setLimit: 1,
  });

  assert.equal(selection.mode, "refresh");
  assert.deepEqual(selection.candidates.map((product) => product.id), [
    "priced-old",
    "refresh-filler",
  ]);
});

test("uses the other three UTC-hour slots for oldest-attempt discovery", () => {
  const products = [
    rotationProduct("priced", "set-priced", {
      observedAt: "2026-08-01T00:00:00.000Z",
    }),
    rotationProduct("discovery-new", "set-new", {
      attemptedAt: "2026-09-01T00:00:00.000Z",
    }),
    rotationProduct("discovery-old", "set-old", {
      attemptedAt: "2026-06-01T00:00:00.000Z",
    }),
    rotationProduct("same-set-filler", "set-old", {
      attemptedAt: "2026-08-01T00:00:00.000Z",
    }),
  ];
  const selection = selectCardTraderCandidates(products, {
    limit: 5,
    now: "2026-09-05T13:50:00.000Z",
    refreshEveryHours: 4,
    setLimit: 1,
  });

  assert.equal(selection.mode, "discovery");
  assert.deepEqual(selection.candidates.map((product) => product.id), [
    "discovery-old",
    "same-set-filler",
  ]);
});

test("keeps automatic rotation inside one set and five products", () => {
  const products = [
    ...Array.from({ length: 7 }, (_, index) => rotationProduct(`a-${index}`, "set-anchor")),
    ...Array.from({ length: 3 }, (_, index) => rotationProduct(`z-${index}`, "set-other")),
  ];
  const selection = selectCardTraderCandidates(products, {
    limit: 5,
    now: "2026-09-05T13:50:00.000Z",
    setLimit: 1,
  });
  const reversedSelection = selectCardTraderCandidates([...products].reverse(), {
    limit: 5,
    now: "2026-09-05T13:50:00.000Z",
    setLimit: 1,
  });

  assert.equal(selection.candidates.length, 5);
  assert.deepEqual(
    reversedSelection.candidates.map((product) => product.id),
    selection.candidates.map((product) => product.id),
  );
  assert.deepEqual(new Set(selection.candidates.map((product) => product.relatedCardSet.id)), new Set([
    "set-anchor",
  ]));
});

test("automatic selection falls back when one rotation pool is empty", () => {
  const unpriced = [rotationProduct("unpriced", "set-unpriced")];
  const priced = [rotationProduct("priced", "set-priced", {
    observedAt: "2026-08-01T00:00:00.000Z",
  })];

  assert.equal(selectCardTraderCandidates(unpriced, {
    now: "2026-09-05T12:50:00.000Z",
  }).mode, "discovery");
  assert.equal(selectCardTraderCandidates(priced, {
    now: "2026-09-05T13:50:00.000Z",
  }).mode, "refresh");
});

test("targeted selection bypasses the automatic refresh/discovery split", () => {
  const products = [
    rotationProduct("requested-unpriced", "set-one"),
    rotationProduct("requested-priced", "set-two", {
      observedAt: "2026-08-01T00:00:00.000Z",
    }),
  ];
  const selection = selectCardTraderCandidates(products, {
    limit: 2,
    now: "2026-09-05T12:50:00.000Z",
    setLimit: 2,
    targeted: true,
  });

  assert.equal(selection.mode, "targeted");
  assert.deepEqual(new Set(selection.candidates.map((product) => product.id)), new Set([
    "requested-unpriced",
    "requested-priced",
  ]));
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

test("a targeted importer processes every requested ID across sets without automatic rotation", async () => {
  const productIds = [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
  ];
  const updates = [];
  let where;
  const prisma = {
    sealedProduct: {
      findMany: async (request) => {
        where = request.where;
        return productIds.map((id, index) => rotationProduct(id, `set-${index + 1}`));
      },
      update: async ({ where: target }) => {
        updates.push(target.id);
        return target;
      },
    },
  };
  const fetchImpl = async (url) => {
    if (url.pathname.endsWith("/games")) {
      return jsonResponse({ data: [{ id: 15, display_name: "Pokémon" }] });
    }

    return jsonResponse({ expansions: [{ game_id: 15, id: 10, name: "Different Set" }] });
  };
  const summary = await syncCardTraderSealedPrices({
    fetchImpl,
    now: "2026-09-05T12:50:00.000Z",
    prisma,
    productIds,
    setLimit: 1,
    token: "token",
    waitMs: 0,
  });

  assert.deepEqual(where.id, { in: productIds });
  assert.equal(summary.selectionMode, "targeted");
  assert.equal(summary.candidatesChecked, 2);
  assert.equal(summary.setsChecked, 2);
  assert.deepEqual(new Set(updates), new Set(productIds));
});

test("an API-healthy discovery miss completes without operational degradation", async () => {
  const prisma = {
    sealedProduct: {
      findMany: async () => [rotationProduct("sealed-1", "set-one")],
      update: async ({ where }) => where,
    },
  };
  const fetchImpl = async (url) => {
    if (url.pathname.endsWith("/games")) {
      return jsonResponse({ data: [{ id: 15, display_name: "Pokémon" }] });
    }

    return jsonResponse({ expansions: [{ game_id: 15, id: 10, name: "Different Set" }] });
  };
  const summary = await syncCardTraderSealedPrices({
    fetchImpl,
    now: "2026-09-05T13:50:00.000Z",
    prisma,
    token: "token",
    waitMs: 0,
  });

  assert.equal(summary.selectionMode, "discovery");
  assert.equal(summary.status, "succeeded");
  assert.equal(summary.outcome, "no_blueprint_match");
  assert.equal(summary.candidatesChecked, 1);
  assert.equal(summary.pricingSnapshotsCreated, 0);
  assert.equal(summary.pricingSnapshotsUpdated, 0);
});

test("CardTrader API and database failures still reject the import", async () => {
  const candidatePrisma = {
    sealedProduct: {
      findMany: async () => [rotationProduct("sealed-1", "set-one")],
    },
  };

  await assert.rejects(
    syncCardTraderSealedPrices({
      apiRetryAttempts: 1,
      apiRetryWaitMs: 0,
      fetchImpl: async () => jsonResponse({ error: "unavailable" }, 503),
      now: "2026-09-05T13:50:00.000Z",
      prisma: candidatePrisma,
      token: "token",
      waitMs: 0,
    }),
    /CardTrader \/(?:games|expansions) request failed with HTTP 503/,
  );
  await assert.rejects(
    syncCardTraderSealedPrices({
      prisma: {
        sealedProduct: {
          findMany: async () => {
            throw new Error("database unavailable");
          },
        },
      },
      token: "token",
    }),
    /database unavailable/,
  );
});

test("accepts a legitimate empty CardTrader blueprint collection as a discovery miss", async () => {
  const prisma = {
    sealedProduct: {
      findMany: async () => [rotationProduct("sealed-1", "set-one")],
      update: async ({ where }) => where,
    },
  };
  const fetchImpl = async (url) => {
    if (url.pathname.endsWith("/games")) {
      return jsonResponse({ data: [{ id: 15, display_name: "Pokémon" }] });
    }
    if (url.pathname.endsWith("/expansions")) {
      return jsonResponse({ expansions: [{ game_id: 15, id: 10, name: "set-one" }] });
    }

    return jsonResponse([]);
  };
  const summary = await syncCardTraderSealedPrices({
    fetchImpl,
    now: "2026-09-05T13:50:00.000Z",
    prisma,
    token: "token",
    waitMs: 0,
  });

  assert.equal(summary.apiRequests, 3);
  assert.equal(summary.blueprintsAvailable, 0);
  assert.equal(summary.candidatesChecked, 1);
  assert.equal(summary.outcome, "no_blueprint_match");
  assert.equal(summary.selectionMode, "discovery");
  assert.equal(summary.status, "succeeded");
});

test("rejects malformed HTTP-successful CardTrader blueprint payloads", async () => {
  const malformedPayloads = [
    { error: "temporarily unavailable" },
    { error: "temporarily unavailable", results: [] },
    { results: "not a collection" },
    { results: [{ name: "Missing blueprint ID" }] },
    { results: [{ id: "20", name: "String blueprint ID" }] },
    { results: [{ id: 20, name: null }] },
  ];

  for (const blueprintPayload of malformedPayloads) {
    const prisma = {
      sealedProduct: {
        findMany: async () => [rotationProduct("sealed-1", "set-one")],
      },
    };
    const fetchImpl = async (url) => {
      if (url.pathname.endsWith("/games")) {
        return jsonResponse({ data: [{ id: 15, display_name: "Pokémon" }] });
      }
      if (url.pathname.endsWith("/expansions")) {
        return jsonResponse({ expansions: [{ game_id: 15, id: 10, name: "set-one" }] });
      }

      return jsonResponse(blueprintPayload);
    };

    await assert.rejects(
      syncCardTraderSealedPrices({
        fetchImpl,
        now: "2026-09-05T13:50:00.000Z",
        prisma,
        token: "token",
        waitMs: 0,
      }),
      /invalid blueprint payload/,
    );
  }
});

test("rejects a malformed HTTP-successful CardTrader marketplace payload", async () => {
  const prisma = {
    sealedProduct: {
      findMany: async () => [rotationProduct("sealed-1", "set-one")],
      update: async ({ where }) => where,
    },
  };
  const fetchImpl = async (url) => {
    if (url.pathname.endsWith("/games")) {
      return jsonResponse({ data: [{ id: 15, display_name: "Pokémon" }] });
    }
    if (url.pathname.endsWith("/expansions")) {
      return jsonResponse({ expansions: [{ game_id: 15, id: 10, name: "set-one" }] });
    }
    if (url.pathname.endsWith("/blueprints/export")) {
      return jsonResponse({ results: [{ id: 20, name: "sealed-1", product_type: "BOOSTER_PACK" }] });
    }

    return jsonResponse({ error: "temporarily unavailable" });
  };

  await assert.rejects(
    syncCardTraderSealedPrices({
      fetchImpl,
      now: "2026-09-05T13:50:00.000Z",
      prisma,
      token: "token",
      waitMs: 0,
    }),
    /invalid marketplace payload for blueprint 20/,
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

test("a same-day CardTrader refresh updates the daily snapshot instead of growing rows", async () => {
  const snapshotUpdates = [];
  const observedAt = new Date("2026-09-05T12:50:00.000Z");
  const prisma = {
    priceSnapshot: {
      create: async () => {
        throw new Error("unexpected daily create");
      },
      findFirst: async () => ({ id: "snapshot-existing" }),
      update: async (request) => {
        snapshotUpdates.push(request);
        return request.data;
      },
    },
    sealedProduct: {
      findMany: async () => [rotationProduct("sealed-1", "set-one", {
        attemptedAt: "2026-09-01T00:00:00.000Z",
        observedAt: "2026-09-05T08:00:00.000Z",
      })],
      update: async ({ data, where }) => ({ id: where.id, ...data }),
    },
  };
  const fetchImpl = async (url) => {
    if (url.pathname.endsWith("/games")) {
      return jsonResponse({ data: [{ id: 15, display_name: "Pokémon" }] });
    }
    if (url.pathname.endsWith("/expansions")) {
      return jsonResponse({ expansions: [{ game_id: 15, id: 10, name: "set-one" }] });
    }
    if (url.pathname.endsWith("/blueprints/export")) {
      return jsonResponse({ results: [{ id: 20, name: "sealed-1", product_type: "BOOSTER_PACK" }] });
    }

    return jsonResponse({ 20: [listing(10_000, "GBP")] });
  };
  const summary = await syncCardTraderSealedPrices({
    fetchImpl,
    now: observedAt,
    prisma,
    token: "token",
    waitMs: 0,
  });

  assert.equal(summary.selectionMode, "refresh");
  assert.equal(summary.status, "succeeded");
  assert.equal(summary.outcome, "priced");
  assert.equal(summary.pricingSnapshotsCreated, 0);
  assert.equal(summary.pricingSnapshotsUpdated, 1);
  assert.equal(snapshotUpdates.length, 1);
  assert.equal(snapshotUpdates[0].where.id, "snapshot-existing");
  assert.equal(snapshotUpdates[0].data.observedAt.toISOString(), observedAt.toISOString());
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

function rotationProduct(id, setId, { attemptedAt, observedAt } = {}) {
  return {
    id,
    metadata: attemptedAt ? { cardTraderLastAttemptAt: attemptedAt } : {},
    name: id,
    priceSnapshots: observedAt ? [{ observedAt: new Date(observedAt) }] : [],
    productType: "BOOSTER_PACK",
    providerIds: {},
    relatedCardSet: { id: setId, name: setId },
  };
}

function jsonResponse(body, status = 200) {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
}
