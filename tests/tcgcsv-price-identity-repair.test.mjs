import assert from "node:assert/strict";
import test from "node:test";
import { buildTcgcsvPriceIdentityRepairPlan } from "../scripts/repair-tcgcsv-price-identities.mjs";

test("builds a non-destructive relabelling plan for historical parallel printings", () => {
  const rows = [
    {
      cardPrintingId: "card-162",
      metadata: { tcgplayerUrl: "https://example.test/giovanni-normal" },
      source: "tcgcsv-japan-card",
      sourceRef: "566507",
      variantLabel: "Holofoil",
    },
    {
      cardPrintingId: "card-162",
      metadata: { tcgplayerUrl: "https://example.test/giovanni-poke-ball-pattern" },
      source: "tcgcsv-japan-card",
      sourceRef: "566702",
      variantLabel: "Holofoil",
    },
    {
      cardPrintingId: "card-162",
      metadata: { tcgplayerUrl: "https://example.test/giovanni-poke-ball-pattern" },
      source: "tcgcsv-japan-card",
      sourceRef: "566702",
      variantLabel: "Holofoil",
    },
    {
      cardPrintingId: "card-162",
      metadata: { tcgplayerUrl: "https://example.test/giovanni-master-ball-pattern" },
      source: "tcgcsv-japan-card",
      sourceRef: "566855",
      variantLabel: "Holofoil",
    },
  ];
  const plan = buildTcgcsvPriceIdentityRepairPlan(rows);

  assert.equal(plan.collisionStreams, 1);
  assert.equal(plan.snapshotsToRelabel, 3);
  assert.deepEqual(plan.operations.map((operation) => ({
    count: operation.snapshotCount,
    ref: operation.sourceRef,
    to: operation.toVariantLabel,
  })), [
    { count: 2, ref: "566702", to: "Poke Ball Reverse Holofoil" },
    { count: 1, ref: "566855", to: "Master Ball Reverse Holofoil" },
  ]);
});
