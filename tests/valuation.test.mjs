import assert from "node:assert/strict";
import test from "node:test";
import {
  collectionConditionMultiplier,
  collectionItemPriceHistory,
  collectionItemValuation,
  collectionItemValueMinor,
} from "../src/lib/valuation.ts";

function catalogueItem(overrides = {}) {
  return {
    id: "card-1",
    type: "card",
    name: "Test Card",
    set: "Test Set",
    number: "1",
    rarity: "Rare",
    hasPrice: true,
    valueMinor: 1_500,
    confidence: "Strong",
    priceHistory: [
      {
        confidence: "Strong",
        observedAt: "2026-08-20T00:00:00.000Z",
        source: "tcgcsv-card",
        valueMinor: 1_000,
        variantLabel: "Holofoil",
      },
      {
        confidence: "Fair",
        observedAt: "2026-08-21T00:00:00.000Z",
        source: "pricecharting-graded-card",
        valueMinor: 10_000,
        variantLabel: "Holofoil",
        gradedCompany: "PSA",
        gradedScore: 10,
      },
    ],
    ...overrides,
  };
}

function collectionItem(overrides = {}) {
  return {
    id: "owned-1",
    catalogueId: "card-1",
    quantity: 1,
    condition: "Near mint",
    language: "English",
    variant: "Holofoil",
    grade: "Raw",
    location: "Binder",
    ...overrides,
  };
}

test("values only the exact selected raw variant and applies condition per copy", () => {
  const item = collectionItem({ condition: "Lightly played", quantity: 3 });
  const valuation = collectionItemValuation(item, catalogueItem());

  assert.equal(valuation.kind, "market");
  assert.equal(valuation.unitValueMinor, 1_000);
  assert.equal(valuation.conditionMultiplier, 0.7);
  assert.equal(valuation.valueMinor, 2_100);
  assert.equal(collectionItemValueMinor(item, catalogueItem()), 2_100);
});

test("explicit unpriced variants fail closed instead of inheriting the headline", () => {
  const valuation = collectionItemValuation(
    collectionItem({ variant: "Normal" }),
    catalogueItem(),
  );

  assert.equal(valuation.kind, "unvalued");
  assert.equal(valuation.reason, "exact-price-missing");
  assert.equal(valuation.valueMinor, undefined);
});

test("repairs the obsolete Normal default for a proven premium holo-only card", () => {
  const valuation = collectionItemValuation(
    collectionItem({ variant: "Normal" }),
    catalogueItem({
      rarity: "Rare Ultra",
      variantOptions: [{ label: "Holofoil", valueMinor: 1_000 }],
    }),
  );

  assert.equal(valuation.kind, "market");
  assert.equal(valuation.valueMinor, 1_000);
});

test("graded lots require exact company, score and variant and receive no raw condition adjustment", () => {
  const exact = collectionItem({ condition: "Poor", grade: "PSA 10", quantity: 2 });
  const missingScore = collectionItem({ grade: "PSA 9" });
  const catalogue = catalogueItem();

  assert.equal(collectionItemValueMinor(exact, catalogue), 20_000);
  assert.equal(collectionItemValuation(exact, catalogue).conditionMultiplier, 1);
  assert.deepEqual(
    collectionItemPriceHistory(exact, catalogue).map((point) => point.valueMinor),
    [10_000],
  );
  assert.equal(collectionItemValueMinor(missingScore, catalogue), undefined);
});

test("manual overrides are total-lot values and survive a missing catalogue reference", () => {
  const item = collectionItem({ overrideValueMinor: 12_345, quantity: 5 });
  const valuation = collectionItemValuation(item, undefined);

  assert.equal(valuation.kind, "manual");
  assert.equal(valuation.valueMinor, 12_345);
});

test("central condition policy preserves sealed and graded values", () => {
  assert.equal(collectionConditionMultiplier("Mint", "card"), 1.05);
  assert.equal(collectionConditionMultiplier("Light Played", "card"), 0.7);
  assert.equal(collectionConditionMultiplier("Poor", "sealed"), 1);
  assert.equal(collectionConditionMultiplier("Poor", "card", true), 1);
});
