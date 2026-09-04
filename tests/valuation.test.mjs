import assert from "node:assert/strict";
import test from "node:test";
import {
  collectionConditionMultiplier,
  effectiveCollectionVariant,
  collectionItemPriceHistory,
  collectionItemValuation,
  collectionItemValueMinor,
} from "../src/lib/valuation.ts";
import { catalogueVariantWriteLabel } from "../src/lib/catalogue/variants.ts";

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

test("a market-priced premium add remains valued after its canonical DB write", () => {
  const catalogue = catalogueItem({
    id: "team-up-170",
    name: "Latias & Latios-GX",
    set: "Team Up",
    number: "170",
    rarity: "Rare Ultra",
    valueMinor: 316_815,
    priceHistory: [{
      confidence: "Fair",
      observedAt: "2026-09-03T09:00:00.000Z",
      source: "tcgcsv-card",
      valueMinor: 316_815,
      variantLabel: "Holofoil",
    }],
    variantOptions: [
      { label: "Normal" },
      { label: "Holofoil", valueMinor: 316_815 },
    ],
  });
  const selectedAtAdd = collectionItem({ catalogueId: catalogue.id, variant: "Standard" });
  assert.equal(collectionItemValuation(selectedAtAdd, catalogue).kind, "market");

  const persistedVariant = catalogueVariantWriteLabel(catalogue, selectedAtAdd.variant);
  const reloaded = collectionItem({ catalogueId: catalogue.id, variant: persistedVariant });
  const valuation = collectionItemValuation(reloaded, catalogue);

  assert.equal(persistedVariant, "Holofoil");
  assert.equal(valuation.kind, "market");
  assert.equal(valuation.valueMinor, 316_815);
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

test("premium repair preserves an exact graded Normal stream", () => {
  const catalogue = catalogueItem({
    rarity: "Rare Ultra",
    priceHistory: [
      {
        confidence: "Fair",
        observedAt: "2026-09-03T09:00:00.000Z",
        source: "tcgcsv-card",
        valueMinor: 316_815,
        variantLabel: "Holofoil",
      },
      {
        confidence: "Fair",
        observedAt: "2026-09-03T09:00:00.000Z",
        source: "pricecharting-graded-card",
        valueMinor: 450_000,
        variantLabel: "Normal",
        gradedCompany: "PSA",
        gradedScore: 10,
      },
    ],
    variantOptions: [{ label: "Holofoil", valueMinor: 316_815 }],
  });
  const graded = collectionItem({ grade: "PSA 10", variant: "Normal" });
  const raw = collectionItem({ grade: "Raw", variant: "Normal" });

  assert.equal(effectiveCollectionVariant(graded, catalogue), "Normal");
  assert.equal(collectionItemValuation(graded, catalogue).valueMinor, 450_000);
  assert.equal(
    catalogueVariantWriteLabel(catalogue, "Normal", { gradedCompany: "PSA", gradedScore: 10 }),
    "Normal",
  );
  assert.equal(effectiveCollectionVariant(raw, catalogue), "Holofoil");
});

test("premium repair preserves an exact graded literal Standard stream", () => {
  const catalogue = catalogueItem({
    rarity: "Rare Ultra",
    priceHistory: [
      {
        confidence: "Fair",
        observedAt: "2026-09-03T09:00:00.000Z",
        source: "tcgcsv-card",
        valueMinor: 316_815,
        variantLabel: "Holofoil",
      },
      {
        confidence: "Fair",
        observedAt: "2026-09-03T09:00:00.000Z",
        source: "graded-market",
        valueMinor: 425_000,
        variantLabel: "Standard",
        gradedCompany: "BGS",
        gradedScore: 10,
      },
    ],
    variantOptions: [{ label: "Holofoil", valueMinor: 316_815 }],
  });
  const graded = collectionItem({ grade: "BGS 10", variant: "Standard" });

  assert.equal(effectiveCollectionVariant(graded, catalogue), "Standard");
  assert.equal(collectionItemValuation(graded, catalogue).valueMinor, 425_000);
  assert.equal(
    catalogueVariantWriteLabel(catalogue, "Standard", { gradedCompany: "BGS", gradedScore: 10 }),
    "Standard",
  );
});

test("variant repair never lets a raw premium price fall back into a missing PSA grade", () => {
  const catalogue = catalogueItem({
    rarity: "Special Illustration Rare",
    variantOptions: [{ label: "Holofoil", valueMinor: 48_934 }],
  });
  const missingExactGrade = collectionItem({ grade: "PSA 9", variant: "Standard" });
  const valuation = collectionItemValuation(missingExactGrade, catalogue);

  assert.equal(effectiveCollectionVariant(missingExactGrade, catalogue), "Standard");
  assert.equal(valuation.kind, "unvalued");
  assert.equal(valuation.reason, "exact-price-missing");
  assert.equal(valuation.valueMinor, undefined);
});

test("premium graded defaults map to Holofoil only with exact grade evidence", () => {
  const catalogue = catalogueItem({
    rarity: "Special Illustration Rare",
    variantOptions: [{ label: "Holofoil", valueMinor: 1_000 }],
  });
  const exactGrade = collectionItem({ grade: "PSA 10", variant: "Standard" });

  assert.equal(effectiveCollectionVariant(exactGrade, catalogue), "Holofoil");
  assert.equal(collectionItemValuation(exactGrade, catalogue).valueMinor, 10_000);
  assert.equal(
    catalogueVariantWriteLabel(catalogue, "Standard", { gradedCompany: "PSA", gradedScore: 10 }),
    "Holofoil",
  );
});

test("an owned sealed lot retains compatible unlabelled market history", () => {
  const sealedCatalogue = catalogueItem({
    id: "sealed-1",
    type: "sealed",
    name: "Chaos Rising Booster Bundle",
    number: "Sealed",
    rarity: "Booster Bundle",
    valueMinor: 2_656,
    priceHistory: [{
      confidence: "Fair",
      observedAt: "2026-09-03T09:00:00.000Z",
      source: "legacy-sealed-market",
      valueMinor: 2_656,
    }],
    variantOptions: [{ label: "Factory sealed", valueMinor: 2_656 }],
  });
  const owned = collectionItem({
    catalogueId: "sealed-1",
    condition: "Sealed",
    variant: "Factory sealed",
  });

  assert.equal(collectionItemPriceHistory(owned, sealedCatalogue).length, 1);
  assert.equal(collectionItemValuation(owned, sealedCatalogue).valueMinor, 2_656);
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
