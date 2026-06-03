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
      }),
    ],
    events: [],
    sets: [],
    storageLocations: [],
    wishlist: [],
  });

  assert.equal(intelligence.weakConfidence.count, 0);
  assert.equal(intelligence.valuationCoverage.manualLots, 1);
});
