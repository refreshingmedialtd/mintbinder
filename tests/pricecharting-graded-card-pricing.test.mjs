import assert from "node:assert/strict";
import test from "node:test";
import {
  findPriceChartingGradedMatches,
  inspectPriceChartingGradeFields,
  parsePriceChartingAliases,
  priceChartingGradedOptionsFromEnv,
  syncPriceChartingGradedCardPrices,
  validatePriceChartingCardIdentity,
} from "../scripts/pricecharting-graded-card-pricing.mjs";

const card = {
  cardSet: { name: "Base Set", series: "Base" },
  id: "card-1",
  language: "en",
  name: "Charizard",
  number: "4/102",
  providerIds: { pokemon_tcg_api: "base1-4" },
};

test("reads bounded PriceCharting graded-card options from env", () => {
  assert.deepEqual(priceChartingGradedOptionsFromEnv({
    PRICECHARTING_API_RETRY_ATTEMPTS: "2",
    PRICECHARTING_API_RETRY_WAIT_MS: "1700",
    PRICECHARTING_API_TIMEOUT_MS: "9000",
    PRICECHARTING_API_TOKEN: "token",
    PRICECHARTING_LICENCE_CONFIRMED: "true",
    PRICECHARTING_GRADED_ALIASES_JSON: '{"card:card-1|holofoil":"123"}',
    PRICECHARTING_GRADED_ENABLED: "true",
    PRICECHARTING_GRADED_LIMIT: "4",
    PRICECHARTING_GRADED_PRICE_ONLY_UNPRICED: "false",
    PRICECHARTING_GRADED_WAIT_MS: "1200",
    PRICECHARTING_GRADED_WRITE_PRICES: "true",
    PRICECHARTING_USD_TO_GBP_RATE: "0.8",
  }), {
    aliases: { "card:card-1|holofoil": "123" },
    enabled: true,
    limit: 4,
    licenceConfirmed: true,
    priceOnlyUnpriced: false,
    retryAttempts: 2,
    retryWaitMs: 1700,
    timeoutMs: 9000,
    token: "token",
    usdToGbpRate: 0.8,
    waitMs: 1200,
    writePrices: true,
  });
});

test("keeps both graded-card activation and writes off by default", () => {
  const options = priceChartingGradedOptionsFromEnv({ PRICECHARTING_API_TOKEN: "token" });

  assert.equal(options.enabled, false);
  assert.equal(options.writePrices, false);
});

test("accepts only company-explicit standard grade fields", () => {
  const inspection = inspectPriceChartingGradeFields({
    "manual-only-price": 40_000,
    "bgs-10-price": 31_000,
    "condition-17-price": 29_000,
    "graded-price": 8_000,
    "new-price": 15_000,
    "condition-19-price": 55_000,
    "condition-20-price": 61_000,
  });

  assert.deepEqual([...inspection.explicitPrices], [
    ["PSA", 40_000],
    ["BGS", 31_000],
    ["CGC", 29_000],
  ]);
  assert.deepEqual(inspection.ambiguousFields, ["graded-price", "new-price"]);
  assert.deepEqual(inspection.qualifiedFields, ["condition-19-price", "condition-20-price"]);
});

test("requires exact Pokémon set, card name, and collector number", () => {
  assert.deepEqual(validatePriceChartingCardIdentity(card, {
    "console-name": "Pokemon Base Set",
    "genre": "Pokemon Card",
    "product-name": "Charizard #4",
    id: "123",
    status: "success",
  }, { variantLabel: "Holofoil" }), { ok: true });

  assert.deepEqual(validatePriceChartingCardIdentity(card, {
    "console-name": "Pokemon Base Set 2",
    "genre": "Pokemon Card",
    "product-name": "Charizard #4",
    id: "124",
    status: "success",
  }, { variantLabel: "Holofoil" }), { ok: false, reason: "set name differs" });
});

test("reports ambiguous exact matches instead of selecting one", async () => {
  const matches = await findPriceChartingGradedMatches({
    card,
    request: async (endpoint) => endpoint === "products"
      ? {
          products: [
            { "console-name": "Pokemon Base Set", "product-name": "Charizard #4", id: "123" },
            { "console-name": "Pokemon Base Set", "product-name": "Charizard #4", id: "124" },
          ],
        }
      : {},
    variants: ["Holofoil"],
  });

  assert.match(matches.get("holofoil").reason, /2 exact products matched/);
});

test("matches an explicit Holo qualifier to the local Holofoil variant", async () => {
  const matches = await findPriceChartingGradedMatches({
    card,
    request: async (endpoint) => endpoint === "products"
      ? {
          products: [{
            "console-name": "Pokemon Base Set",
            "product-name": "Charizard #4 [Holo]",
            id: "123",
          }],
        }
      : {
          "console-name": "Pokemon Base Set",
          "genre": "Pokemon Card",
          "product-name": "Charizard #4 [Holo]",
          id: "123",
          status: "success",
        },
    variants: ["Holofoil"],
  });

  assert.equal(matches.get("holofoil").matchType, "exact_search");
});

test("a variant-scoped reviewed alias can resolve an otherwise unqualified product", async () => {
  const calls = [];
  const matches = await findPriceChartingGradedMatches({
    aliases: { "pokemon_tcg_api:base1-4|1st edition holofoil": "321" },
    card,
    request: async (endpoint, params) => {
      calls.push({ endpoint, params });
      return {
        "console-name": "Pokemon Base Set",
        "genre": "Pokemon Card",
        "product-name": "Charizard #4",
        id: "321",
        status: "success",
      };
    },
    variants: ["1st Edition Holofoil"],
  });

  assert.deepEqual(calls, [{ endpoint: "product", params: { id: "321" } }]);
  assert.equal(matches.get("1st edition holofoil").matchType, "manual_alias");
});

test("imports PSA/BGS/CGC 10 and reports unsupported or ambiguous fields without writing them", async () => {
  const snapshots = [];
  const prisma = {
    cardPrinting: {
      findMany: async () => [{
        ...card,
        collectionItems: [
          { gradedCompany: "PSA", gradedScore: "10.0", variantLabel: "Holofoil" },
          { gradedCompany: "BGS", gradedScore: 10, variantLabel: "Holofoil" },
          { gradedCompany: "CGC", gradedScore: 10, variantLabel: "Holofoil" },
          { gradedCompany: "PSA", gradedScore: 9, variantLabel: "Holofoil" },
        ],
        priceSnapshots: [],
      }],
    },
    priceSnapshot: {
      create: async ({ data }) => {
        snapshots.push(data);
        return { id: `snapshot-${snapshots.length}`, ...data };
      },
      findFirst: async () => null,
      update: async () => assert.fail("unexpected update"),
    },
  };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(new URL(url));
    const isSearch = url.pathname.endsWith("/products");

    return jsonResponse(isSearch
      ? {
          products: [{
            "console-name": "Pokemon Base Set",
            "product-name": "Charizard #4",
            id: "123",
          }],
          status: "success",
        }
      : {
          "bgs-10-price": 31_000,
          "condition-17-price": 29_000,
          "condition-19-price": 55_000,
          "console-name": "Pokemon Base Set",
          "genre": "Pokemon Card",
          "graded-price": 8_000,
          "manual-only-price": 40_000,
          "product-name": "Charizard #4",
          id: "123",
          status: "success",
        });
  };

  const summary = await syncPriceChartingGradedCardPrices({
    enabled: true,
    fetchImpl,
    limit: 1,
    licenceConfirmed: true,
    observedAt: "2026-08-24T12:00:00.000Z",
    prisma,
    retryAttempts: 1,
    token: "token",
    usdToGbpRate: 0.8,
    waitMs: 0,
    writePrices: true,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].searchParams.get("t"), "token");
  assert.equal(summary.status, "succeeded");
  assert.equal(summary.requestedGradeIdentities, 4);
  assert.equal(summary.supportedGradeIdentities, 3);
  assert.equal(summary.unsupportedGradeIdentities, 1);
  assert.equal(summary.explicitPricesFound, 3);
  assert.equal(summary.ambiguousFieldsObserved, 1);
  assert.equal(summary.qualifiedFieldsObserved, 1);
  assert.equal(summary.pricingSnapshotsCreated, 3);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.gradedCompany), ["PSA", "BGS", "CGC"]);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.priceMinor), [32_000, 24_800, 23_200]);
  assert.ok(snapshots.every((snapshot) => snapshot.gradedScore === 10));
  assert.ok(snapshots.every((snapshot) => snapshot.source === "pricecharting-graded-card"));
  assert.ok(snapshots.every((snapshot) => snapshot.metadata.ambiguousCompanyFieldsIgnored.includes("graded-price")));
});

test("fails closed before persisting graded PriceCharting prices without confirmed permission", async () => {
  await assert.rejects(
    syncPriceChartingGradedCardPrices({
      enabled: true,
      prisma: {
        cardPrinting: { findMany: async () => assert.fail("unexpected database query") },
      },
      token: "token",
      usdToGbpRate: 0.8,
      writePrices: true,
    }),
    /PRICECHARTING_LICENCE_CONFIRMED=true/,
  );
});

test("rejects malformed manual alias JSON", () => {
  assert.throws(() => parsePriceChartingAliases("[]"), /aliases must be a JSON object/);
  assert.throws(() => parsePriceChartingAliases("{"), /is invalid/);
});

test("disabled graded pricing is a no-op before token or database access", async () => {
  let disconnected = false;
  const summary = await syncPriceChartingGradedCardPrices({
    enabled: false,
    prisma: {
      cardPrinting: { findMany: async () => assert.fail("unexpected database query") },
    },
  });

  assert.equal(disconnected, false);
  assert.equal(summary.status, "not_configured");
  assert.equal(summary.enabled, false);
});

function jsonResponse(body, status = 200) {
  return {
    headers: { get: () => null },
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
}
