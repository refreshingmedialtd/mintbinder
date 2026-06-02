import assert from "node:assert/strict";
import test from "node:test";
import { buildDuplicateProviderReview } from "../src/lib/catalogue/duplicate-provider-review.ts";

const generatedAt = new Date("2026-06-02T12:00:00.000Z");

test("builds a duplicate provider review grouped by provider ID and risk", () => {
  const report = buildDuplicateProviderReview([
    duplicateRow({
      collectionCount: 1,
      id: "card-a",
      providerId: "sv3pt5-199",
      updatedAt: "2026-06-01T00:00:00.000Z",
      wishlistCount: 0,
    }),
    duplicateRow({
      collectionCount: 0,
      id: "card-b",
      priceSnapshotCount: 3,
      providerId: "sv3pt5-199",
      updatedAt: "2026-05-01T00:00:00.000Z",
      wishlistCount: 1,
    }),
    duplicateRow({
      id: "card-c",
      providerId: "swsh7-215",
      updatedAt: "2026-04-01T00:00:00.000Z",
    }),
    duplicateRow({
      id: "card-d",
      providerId: "swsh7-215",
      updatedAt: "2026-05-01T00:00:00.000Z",
    }),
  ], generatedAt);

  assert.equal(report.report, "duplicate_provider_review");
  assert.equal(report.generatedAt, "2026-06-02T12:00:00.000Z");
  assert.equal(report.duplicateGroupCount, 2);
  assert.equal(report.duplicateCardCount, 4);
  assert.equal(report.highRiskGroupCount, 1);
  assert.equal(report.lowRiskGroupCount, 1);
  assert.equal(report.groups[0].providerId, "sv3pt5-199");
  assert.equal(report.groups[0].riskLevel, "high");
  assert.equal(report.groups[0].suggestedPrimaryCardId, "card-a");
  assert.equal(report.groups[0].collectionCount, 1);
  assert.equal(report.groups[0].wishlistCount, 1);
  assert.equal(report.groups[0].priceSnapshotCount, 3);
  assert.equal(report.groups[1].riskLevel, "low");
});

test("prefers priced and imaged rows when suggesting a primary card", () => {
  const report = buildDuplicateProviderReview([
    duplicateRow({
      id: "plain",
      imageLargeUrl: null,
      priceSnapshotCount: 0,
      providerId: "sv3pt5-193",
      updatedAt: "2026-06-01T00:00:00.000Z",
    }),
    duplicateRow({
      id: "priced",
      imageLargeUrl: "https://images.example/card.png",
      priceSnapshotCount: 2,
      providerId: "sv3pt5-193",
      updatedAt: "2026-05-01T00:00:00.000Z",
    }),
  ], generatedAt);

  assert.equal(report.groups[0].suggestedPrimaryCardId, "priced");
  assert.equal(report.groups[0].riskLevel, "medium");
});

function duplicateRow(overrides = {}) {
  return {
    collectionCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "card",
    imageLargeUrl: "https://images.example/card-hires.png",
    imageSmallUrl: "https://images.example/card.png",
    name: "Charizard ex",
    number: "199/165",
    priceSnapshotCount: 0,
    providerId: "sv3pt5-199",
    rarity: "Special Illustration Rare",
    series: "Scarlet & Violet",
    setName: "Scarlet & Violet 151",
    updatedAt: "2026-01-02T00:00:00.000Z",
    wishlistCount: 0,
    ...overrides,
  };
}
