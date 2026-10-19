import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEbayUkSearchQuery,
  classifyEbayUkSoldListing,
  ebayUkSoldOptionsFromEnv,
  estimateEbayUkSoldPrice,
  robustComparableSales,
  selectEbayUkSoldTargets,
  syncEbayUkSoldPrices,
} from "../scripts/ebay-uk-sold-pricing.mjs";

const now = new Date("2026-10-09T12:00:00.000Z");
const target = {
  card: {
    cardSet: { name: "Team Rocket", printedTotal: 82, total: 83 },
    id: "11111111-1111-4111-8111-111111111111",
    language: "en",
    name: "Dark Raichu",
    number: "83",
    rarity: "Rare Secret",
    variantMetadata: {},
  },
  condition: "NEAR_MINT",
  demand: "owned",
  variantLabel: "1st Edition Holofoil",
};

function sale(overrides = {}) {
  return {
    condition: "Ungraded",
    endedAt: "2026-10-08",
    itemId: `item-${Math.random()}`,
    sellerUsername: `seller-${Math.random()}`,
    soldCurrency: "GBP",
    title: "Pokemon Dark Raichu 83/82 Team Rocket 1st Edition Holo Near Mint",
    totalPrice: "100.00",
    url: "https://www.ebay.co.uk/itm/1234567890",
    ...overrides,
  };
}

test("UK sold pricing remains fail-closed by default", () => {
  const options = ebayUkSoldOptionsFromEnv({});
  assert.equal(options.enabled, false);
  assert.equal(options.customerVisible, false);
  assert.equal(options.writePrices, false);
  assert.equal(options.limit, 10);
  assert.equal(options.timeoutMs, 95_000);
});

test("automatic benchmarking prioritizes meaningful owned value over recent low-value additions", async () => {
  const card = (id, name, priceMinor) => ({
    cardSet: { name: "Team Rocket", printedTotal: 82, total: 83 },
    id,
    language: "en",
    name,
    number: "83",
    priceSnapshots: [{ language: "en", priceMinor, variantLabel: "Holofoil" }],
    rarity: "Rare Secret",
    variantMetadata: {},
  });
  const prisma = {
    collectionItem: {
      findMany: async () => [
        {
          cardPrinting: card("new-low", "Recent card", 100),
          condition: "NEAR_MINT",
          quantity: 1,
          updatedAt: new Date("2026-10-09"),
          variantLabel: "Holofoil",
        },
        {
          cardPrinting: card("older-high", "Representative card", 50_000),
          condition: "NEAR_MINT",
          quantity: 1,
          updatedAt: new Date("2026-09-01"),
          variantLabel: "Holofoil",
        },
      ],
    },
    wishlistItem: { findMany: async () => [] },
  };

  const selected = await selectEbayUkSoldTargets(prisma, { limit: 1 });
  assert.equal(selected[0].card.id, "older-high");
});

test("builds a focused UK card query without title terms sellers commonly omit", () => {
  assert.equal(
    buildEbayUkSearchQuery(target),
    "Dark Raichu 83/82 1st Edition holo",
  );
});

test("uses subset-prefixed denominators and does not invent promo denominators", () => {
  assert.match(buildEbayUkSearchQuery({
    ...target,
    card: {
      ...target.card,
      cardSet: { ...target.card.cardSet, name: "Crown Zenith Galarian Gallery", printedTotal: 70 },
      name: "Deoxys",
      number: "GG12",
    },
    variantLabel: "Holofoil",
  }), /GG12\/GG70/);
  assert.match(buildEbayUkSearchQuery({
    ...target,
    card: {
      ...target.card,
      cardSet: { ...target.card.cardSet, name: "MEP Black Star Promos", printedTotal: 86 },
      name: "Tyrunt",
      number: "MEP 070",
    },
    variantLabel: "Holofoil",
  }), /MEP 070 MEP holo/);
});

test("normalizes the accented Pokémon Center stamp into a distinct search", () => {
  const stamped = buildEbayUkSearchQuery({
    ...target,
    card: {
      ...target.card,
      cardSet: { name: "MEP Black Star Promos", printedTotal: null, total: 86 },
      name: "Fennekin",
      number: "080",
    },
    variantLabel: "Pokémon Center Stamp Holofoil",
  });
  const regular = buildEbayUkSearchQuery({
    ...target,
    card: {
      ...target.card,
      cardSet: { name: "MEP Black Star Promos", printedTotal: null, total: 86 },
      name: "Fennekin",
      number: "080",
    },
    variantLabel: "Holofoil",
  });

  assert.equal(stamped, "Fennekin 080/086 MEP Pokemon Center stamp");
  assert.equal(regular, "Fennekin 080/086 MEP holo");
  assert.notEqual(stamped, regular);
});

test("matches Pokémon Center stamp identity while rejecting it for a regular holo", () => {
  const stampedTarget = {
    ...target,
    card: {
      ...target.card,
      cardSet: { name: "MEP Black Star Promos", printedTotal: 86, total: 86 },
      name: "Fennekin",
      number: "080",
    },
    variantLabel: "Pokémon Center Stamp Holofoil",
  };
  const listing = sale({
    title: "Pokemon Fennekin 080/086 MEP Pokemon Center Promo Holo Near Mint",
  });

  assert.equal(classifyEbayUkSoldListing(stampedTarget, listing, { now }).accepted, true);
  assert.equal(classifyEbayUkSoldListing({ ...stampedTarget, variantLabel: "Holofoil" }, listing, { now }).reason, "stamp_mismatch");
});

test("prefixed promo numbers can prove the set without an expanded catalogue label", () => {
  const promoTarget = {
    ...target,
    card: {
      ...target.card,
      cardSet: { ...target.card.cardSet, name: "MEP Black Star Promos", printedTotal: 86 },
      name: "Tyrunt",
      number: "MEP 070",
    },
    variantLabel: "Holofoil",
  };
  const result = classifyEbayUkSoldListing(promoTarget, sale({
    title: "Pokemon Tyrunt MEP 070 Mega Evolution Promo Holo Near Mint",
  }), { now });
  assert.equal(result.accepted, true);
});

test("card-name identity matching tolerates punctuation without widening the printing", () => {
  const punctuatedTarget = {
    ...target,
    card: { ...target.card, name: "Latias & Latios-GX", number: "170" },
    variantLabel: "Holofoil",
  };
  const result = classifyEbayUkSoldListing(punctuatedTarget, sale({
    title: "Pokemon Latias and Latios GX 170/82 Team Rocket Holo Near Mint",
  }), { now });
  assert.equal(result.accepted, true);
});

test("accepts one exact raw near-mint UK comparable", () => {
  const result = classifyEbayUkSoldListing(target, sale(), { now });
  assert.equal(result.accepted, true);
  assert.equal(result.sale.totalMinor, 10_000);
});

test("rejects slabs, lots, wrong editions, wrong finishes and implicit condition", () => {
  const cases = [
    [sale({ title: "PSA 9 Pokemon Dark Raichu 83/82 Team Rocket 1st Edition Holo Near Mint" }), "not_single_raw_card"],
    [sale({ title: "Pokemon Dark Raichu lot 83/82 Team Rocket 1st Edition Holo Near Mint" }), "not_single_raw_card"],
    [sale({ title: "Pokemon Dark Raichu 83/82 Team Rocket Unlimited Holo Near Mint" }), "first_edition_mismatch"],
    [sale({ title: "Pokemon Dark Raichu 83/82 Team Rocket 1st Edition Reverse Holo Near Mint" }), "reverse_holo_mismatch"],
    [sale({ condition: "Ungraded", title: "Pokemon Dark Raichu 83/82 Team Rocket 1st Edition Holo" }), "near_mint_not_explicit"],
  ];

  for (const [listing, reason] of cases) {
    assert.deepEqual(classifyEbayUkSoldListing(target, listing, { now }), {
      accepted: false,
      reason,
    });
  }
});

test("rejects the wrong printing, set, language and currency", () => {
  const cases = [
    [sale({ title: "Pokemon Dark Raichu 82/82 Team Rocket 1st Edition Holo Near Mint" }), "collector_number_mismatch"],
    [sale({ title: "Pokemon Dark Raichu 83/82 Neo Genesis 1st Edition Holo Near Mint" }), "set_mismatch"],
    [sale({ title: "Japanese Pokemon Dark Raichu 83/82 Team Rocket 1st Edition Holo Near Mint" }), "language_mismatch"],
    [sale({ soldCurrency: "USD" }), "invalid_gbp_total"],
  ];

  for (const [listing, reason] of cases) {
    assert.equal(classifyEbayUkSoldListing(target, listing, { now }).reason, reason);
  }
});

test("uses shipping-inclusive totals and removes a statistical outlier", () => {
  const listings = [50, 51, 52, 53, 5_000].map((pounds, index) => sale({
    itemId: `item-${index}`,
    sellerUsername: `seller-${index}`,
    totalPrice: pounds.toFixed(2),
  }));
  const estimate = estimateEbayUkSoldPrice(target, listings, { minComparableSales: 3, now });

  assert.equal(estimate.accepted, true);
  assert.equal(estimate.sampleSize, 4);
  assert.equal(estimate.priceMinor, 5_150);
  assert.equal(estimate.rejectionReasons.statistical_outlier, 1);
  assert.ok(estimate.confidenceScore >= 60);
});

test("robust comparison leaves small honest samples untouched", () => {
  const input = [{ totalMinor: 100 }, { totalMinor: 110 }, { totalMinor: 1_000 }];
  assert.deepEqual(robustComparableSales(input), input);
});

test("shadow sync calls only ebay.co.uk, keeps the key server-side and does not write", async () => {
  const requests = [];
  const writes = [];
  const listings = [99, 100, 101].map((pounds, index) => sale({
    itemId: `item-${index}`,
    sellerUsername: `seller-${index}`,
    totalPrice: pounds.toFixed(2),
  }));
  const fetchImpl = async (url, init) => {
    requests.push({ init, url: String(url) });
    return new Response(JSON.stringify({
      count: listings.length,
      ebaySite: "ebay.co.uk",
      keyword: "dark raichu",
      results: listings,
    }), {
      headers: { "content-type": "application/json", "x-usage-remaining": "49" },
      status: 200,
    });
  };
  const prisma = {
    priceSnapshot: {
      create: async (input) => writes.push(input),
      findFirst: async () => null,
      update: async (input) => writes.push(input),
    },
  };
  const result = await syncEbayUkSoldPrices({
    apiKey: "eb_secret_key",
    customerVisible: false,
    enabled: true,
    fetchImpl,
    limit: 1,
    observedAt: now,
    prisma,
    targets: [target],
    writePrices: false,
  });

  assert.equal(result.estimatesAccepted, 1);
  assert.equal(result.quotaRemaining, 49);
  assert.equal(writes.length, 0);
  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.origin, "https://api.ebaysoldlistingsapi.com");
  assert.equal(requestUrl.searchParams.get("ebaySite"), "ebay.co.uk");
  assert.equal(requestUrl.searchParams.has("eb_secret_key"), false);
  assert.equal(requests[0].init.headers.authorization, "Bearer eb_secret_key");
});

test("write mode fails closed until UK sold estimates are explicitly approved for customers", async () => {
  await assert.rejects(
    syncEbayUkSoldPrices({
      apiKey: "eb_secret_key",
      customerVisible: false,
      enabled: true,
      prisma: {},
      writePrices: true,
    }),
    /EBAY_UK_SOLD_CUSTOMER_VISIBLE=true/,
  );
});
