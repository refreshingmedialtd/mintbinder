import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSealedImageRepairPlan,
  sealedImageRepairTargets,
  upgradedTcgcsvSealedImageUrl,
} from "../src/lib/catalogue/sealed-image-repair.ts";

test("collects repairable sealed image targets from TCGCSV metadata", () => {
  assert.deepEqual(
    sealedImageRepairTargets([
      {
        id: "sealed-1",
        imageUrl: null,
        metadata: { groupId: 3170 },
        providerIds: { tcgcsv: "100" },
      },
      {
        id: "sealed-2",
        imageUrl: "",
        metadata: { groupId: "6052" },
        providerIds: { tcgplayer: 200 },
      },
      {
        id: "already-has-image",
        imageUrl: "https://images.example/existing.jpg",
        metadata: { groupId: 3170 },
        providerIds: { tcgcsv: "101" },
      },
      {
        id: "missing-group",
        imageUrl: null,
        metadata: {},
        providerIds: { tcgcsv: "102" },
      },
    ]),
    [
      { groupId: "3170", id: "sealed-1", productId: "100" },
      { groupId: "6052", id: "sealed-2", productId: "200" },
    ],
  );
});

test("plans sealed image repairs without overwriting existing images", () => {
  const plan = buildSealedImageRepairPlan(
    [
      {
        id: "sealed-1",
        imageUrl: null,
        metadata: { groupId: 3170 },
        providerIds: { tcgcsv: "100" },
      },
      {
        id: "sealed-2",
        imageUrl: null,
        metadata: { groupId: 3170 },
        providerIds: { tcgcsv: "101" },
      },
      {
        id: "already-has-image",
        imageUrl: "https://images.example/existing.jpg",
        metadata: { groupId: 3170 },
        providerIds: { tcgcsv: "102" },
      },
    ],
    [
      {
        groupId: 3170,
        imageUrl: "https://images.example/product_200w.jpg",
        productId: 100,
      },
      {
        groupId: 3170,
        imageUrl: null,
        productId: 101,
      },
      {
        groupId: 3170,
        imageUrl: "https://images.example/existing-replacement_200w.jpg",
        productId: 102,
      },
    ],
  );

  assert.deepEqual(plan, [
    {
      groupId: "3170",
      id: "sealed-1",
      imageUrl: "https://images.example/product_in_1000x1000.jpg",
      productId: "100",
    },
  ]);
});

test("upgrades TCGCSV thumbnail image URLs", () => {
  assert.equal(
    upgradedTcgcsvSealedImageUrl("https://images.example/product_200w.jpg"),
    "https://images.example/product_in_1000x1000.jpg",
  );
  assert.equal(upgradedTcgcsvSealedImageUrl(""), undefined);
});
