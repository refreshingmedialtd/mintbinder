import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDuplicateCardMergePlan,
  duplicateCardMergeConflict,
  strongerWishlistPriority,
} from "../src/lib/catalogue/duplicate-card-merge.ts";

const generatedAt = new Date("2026-06-02T12:00:00.000Z");

test("builds a dry-run plan for a mergeable duplicate card pair", () => {
  const plan = buildDuplicateCardMergePlan({
    conflicts: [
      wishlistConflict({
        primaryTargetPriceMinor: 12000,
        sourcePriority: "grail",
        sourceTargetPriceMinor: 9000,
      }),
    ],
    duplicateCard: cardRow({
      collectionCount: 2,
      id: "duplicate-card",
      priceSnapshotCount: 5,
      wishlistCount: 3,
    }),
    generatedAt,
    input: {
      duplicateCardId: "duplicate-card",
      primaryCardId: "primary-card",
    },
    primaryCard: cardRow({ id: "primary-card" }),
  });

  assert.equal(plan.report, "duplicate_card_merge");
  assert.equal(plan.mode, "dry_run");
  assert.equal(plan.generatedAt, "2026-06-02T12:00:00.000Z");
  assert.equal(plan.canMerge, true);
  assert.equal(plan.collectionItemsToMove, 2);
  assert.equal(plan.priceSnapshotsToMove, 5);
  assert.equal(plan.wishlistItemsToMove, 2);
  assert.equal(plan.wishlistConflictsToMerge, 1);
  assert.equal(plan.duplicateCardWillBeDeleted, true);
  assert.equal(plan.wishlistConflicts[0].mergedPriority, "grail");
  assert.equal(plan.wishlistConflicts[0].mergedTargetPriceMinor, 9000);
});

test("blocks mismatched provider IDs and same-card merges", () => {
  const mismatched = buildDuplicateCardMergePlan({
    conflicts: [],
    duplicateCard: cardRow({ id: "duplicate-card", providerId: "sv3pt5-198" }),
    input: {
      duplicateCardId: "duplicate-card",
      primaryCardId: "primary-card",
    },
    primaryCard: cardRow({ id: "primary-card", providerId: "sv3pt5-199" }),
  });

  assert.equal(mismatched.canMerge, false);
  assert.match(mismatched.errors.join(" "), /same Pokemon TCG provider ID/);

  const sameCard = buildDuplicateCardMergePlan({
    conflicts: [],
    duplicateCard: cardRow({ id: "same-card" }),
    input: {
      duplicateCardId: "same-card",
      primaryCardId: "same-card",
    },
    primaryCard: cardRow({ id: "same-card" }),
  });

  assert.equal(sameCard.canMerge, false);
  assert.match(sameCard.errors.join(" "), /different/);
});

test("preserves requested IDs when lookup rows are missing", () => {
  const plan = buildDuplicateCardMergePlan({
    conflicts: [],
    input: {
      duplicateCardId: "missing-duplicate",
      primaryCardId: "missing-primary",
    },
  });

  assert.equal(plan.canMerge, false);
  assert.equal(plan.primaryCardId, "missing-primary");
  assert.equal(plan.duplicateCardId, "missing-duplicate");
  assert.deepEqual(plan.errors, [
    "Primary card was not found.",
    "Duplicate card was not found.",
  ]);
});

test("resolves wishlist conflict fields conservatively", () => {
  assert.equal(strongerWishlistPriority("medium", "high"), "high");
  assert.equal(strongerWishlistPriority("grail", "low"), "grail");

  assert.deepEqual(
    duplicateCardMergeConflict(wishlistConflict({
      primaryPriority: "medium",
      primaryTargetCurrency: "GBP",
      primaryTargetPriceMinor: 15000,
      sourcePriority: "high",
      sourceTargetCurrency: "GBP",
      sourceTargetPriceMinor: 12000,
    })),
    {
      mergedPriority: "high",
      mergedTargetCurrency: "GBP",
      mergedTargetPriceMinor: 12000,
      primaryWishlistId: "primary-wish",
      sourceWishlistId: "source-wish",
      userId: "user-1",
    },
  );

  assert.deepEqual(
    duplicateCardMergeConflict(wishlistConflict({
      primaryTargetCurrency: "GBP",
      primaryTargetPriceMinor: 15000,
      sourceTargetCurrency: "USD",
      sourceTargetPriceMinor: 10000,
    })),
    {
      mergedPriority: "high",
      mergedTargetCurrency: "GBP",
      mergedTargetPriceMinor: 15000,
      primaryWishlistId: "primary-wish",
      sourceWishlistId: "source-wish",
      userId: "user-1",
    },
  );
});

function cardRow(overrides = {}) {
  return {
    collectionCount: 0,
    id: "card",
    name: "Charizard ex",
    number: "199/165",
    priceSnapshotCount: 0,
    providerId: "sv3pt5-199",
    setName: "Scarlet & Violet 151",
    wishlistCount: 0,
    ...overrides,
  };
}

function wishlistConflict(overrides = {}) {
  return {
    primaryPriority: "high",
    primaryTargetCurrency: "GBP",
    primaryTargetPriceMinor: 10000,
    primaryWishlistId: "primary-wish",
    sourcePriority: "medium",
    sourceTargetCurrency: "GBP",
    sourceTargetPriceMinor: 11000,
    sourceWishlistId: "source-wish",
    userId: "user-1",
    ...overrides,
  };
}
