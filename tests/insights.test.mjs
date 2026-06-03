import assert from "node:assert/strict";
import test from "node:test";
import { buildCollectionIntelligence } from "../src/lib/insights.ts";

function catalogueItem(overrides = {}) {
  return {
    id: "card-priced",
    type: "card",
    name: "Test Card",
    set: "Test Set",
    number: "1/100",
    rarity: "Rare",
    hasPrice: true,
    valueMinor: 1000,
    confidence: "Strong",
    priceObservedAt: "2026-06-01T00:00:00.000Z",
    priceSource: "pokemon-tcg-api",
    ...overrides,
  };
}

function collectionItem(overrides = {}) {
  return {
    id: "owned-priced",
    catalogueId: "card-priced",
    quantity: 1,
    condition: "Near mint",
    language: "English",
    variant: "Standard",
    grade: "Raw",
    location: "Binder",
    ...overrides,
  };
}

test("summarizes valuation coverage and review actions", () => {
  const catalogue = [
    catalogueItem(),
    catalogueItem({
      id: "card-weak",
      name: "Weak Card",
      confidence: "Weak",
      valueMinor: 2000,
    }),
    catalogueItem({
      id: "sealed-manual",
      type: "sealed",
      name: "Manual Sealed",
      hasPrice: false,
      valueMinor: 0,
    }),
    catalogueItem({
      id: "sealed-unvalued",
      type: "sealed",
      name: "Unvalued Sealed",
      hasPrice: false,
      valueMinor: 0,
    }),
  ];
  const intelligence = buildCollectionIntelligence({
    catalogueById: new Map(catalogue.map((item) => [item.id, item])),
    collection: [
      collectionItem(),
      collectionItem({ id: "owned-weak", catalogueId: "card-weak" }),
      collectionItem({
        id: "owned-manual",
        catalogueId: "sealed-manual",
        grade: "N/A",
        overrideValueMinor: 5000,
      }),
      collectionItem({
        id: "owned-unvalued",
        catalogueId: "sealed-unvalued",
        grade: "N/A",
        quantity: 2,
      }),
    ],
    events: [],
    sets: [],
    storageLocations: [],
    wishlist: [],
  });

  assert.deepEqual(intelligence.valuationCoverage, {
    coveragePercent: 75,
    knownLots: 3,
    knownValueMinor: 8000,
    manualLots: 1,
    manualNotesMissing: 1,
    manualValueMinor: 5000,
    marketLots: 2,
    totalLots: 4,
    unvaluedLots: 1,
    unvaluedQuantity: 2,
  });
  assert.equal(intelligence.weakConfidence.count, 1);
  assert.deepEqual(
    intelligence.actionQueue
      .map((action) => action.id)
      .filter((id) => id === "unvalued-lots" || id === "manual-valuations" || id === "weak-price-confidence"),
    ["unvalued-lots", "manual-valuations", "weak-price-confidence"],
  );
});

test("does not treat manual estimates as weak market confidence", () => {
  const manualWeakCatalogue = catalogueItem({
    id: "manual-weak",
    confidence: "Weak",
    hasPrice: true,
    valueMinor: 100,
  });
  const intelligence = buildCollectionIntelligence({
    catalogueById: new Map([[manualWeakCatalogue.id, manualWeakCatalogue]]),
    collection: [
      collectionItem({
        id: "owned-manual-weak",
        catalogueId: manualWeakCatalogue.id,
        overrideValueMinor: 3000,
        valuationNote: "Recent sale comp.",
      }),
    ],
    events: [],
    sets: [],
    storageLocations: [],
    wishlist: [],
  });

  assert.equal(intelligence.weakConfidence.count, 0);
  assert.equal(intelligence.valuationCoverage.manualLots, 1);
  assert.equal(intelligence.valuationCoverage.manualNotesMissing, 0);
});

test("explains wishlist and weak-confidence price alerts", () => {
  const hitCard = catalogueItem({
    id: "target-hit",
    name: "Target Hit",
    priceSource: "tcgcsv-card",
    valueMinor: 1000,
  });
  const watchCard = catalogueItem({
    id: "target-watch",
    name: "Target Watch",
    valueMinor: 1000,
  });
  const outsideBandCard = catalogueItem({
    id: "outside-band",
    name: "Outside Band",
    valueMinor: 1000,
  });
  const weakCard = catalogueItem({
    id: "weak-market",
    confidence: "Weak",
    name: "Weak Market",
    priceSource: "tcgcsv",
    valueMinor: 2500,
  });

  const intelligence = buildCollectionIntelligence({
    catalogueById: new Map(
      [hitCard, watchCard, outsideBandCard, weakCard].map((item) => [item.id, item]),
    ),
    collection: [
      collectionItem({
        id: "owned-weak-market",
        catalogueId: weakCard.id,
      }),
    ],
    events: [],
    sets: [],
    storageLocations: [],
    wishlist: [
      { id: "wish-hit", catalogueId: hitCard.id, priority: "High", targetPriceMinor: 1200 },
      { id: "wish-watch", catalogueId: watchCard.id, priority: "Medium", targetPriceMinor: 950 },
      { id: "wish-outside", catalogueId: outsideBandCard.id, priority: "Low", targetPriceMinor: 800 },
    ],
  });

  assert.deepEqual(
    intelligence.priceAlerts.map((alert) => [alert.id, alert.status]),
    [
      ["wishlist-wish-hit", "Hit"],
      ["wishlist-wish-watch", "Watch"],
      ["confidence-owned-weak-market", "Refresh"],
    ],
  );

  assert.equal(intelligence.priceAlerts[0].explanation, "GBP 2.00 below your target.");
  assert.equal(intelligence.priceAlerts[0].deltaMinor, -200);
  assert.equal(intelligence.priceAlerts[0].priceSource, "tcgcsv-card");
  assert.equal(
    intelligence.priceAlerts[1].explanation,
    "GBP 0.50 above target, inside the 10% watch band.",
  );
  assert.equal(intelligence.priceAlerts[1].watchBandMinor, 1045);
  assert.equal(
    intelligence.priceAlerts[2].explanation,
    "Weak confidence from TCGCSV observed 01 Jun 2026; refresh pricing or add a manual estimate.",
  );
});
