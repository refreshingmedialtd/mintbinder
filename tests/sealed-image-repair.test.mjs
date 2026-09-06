import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSealedImageRepairPlan,
  importedTcgcsvSealedImageState,
  isPermanentSealedImageFailureStatus,
  sealedImageRepairTargets,
  sealedImageMetadataWithQuarantine,
  sealedImageUrlIsQuarantined,
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

test("keeps an exact permanently unavailable provider image quarantined", () => {
  const metadata = sealedImageMetadataWithQuarantine({
    checkedAt: "2026-09-07T10:00:00.000Z",
    metadata: { groupId: 3170, provider: "tcgcsv" },
    status: 403,
    url: "https://images.example/product_in_1000x1000.jpg",
  });

  assert.equal(
    sealedImageUrlIsQuarantined(metadata, "https://images.example/product_200w.jpg"),
    true,
  );
  assert.deepEqual(importedTcgcsvSealedImageState(
    metadata,
    "https://images.example/product_200w.jpg",
  ), {
    imageUrl: null,
    metadata,
  });
  assert.deepEqual(buildSealedImageRepairPlan(
    [{
      id: "sealed-1",
      imageUrl: null,
      metadata,
      providerIds: { tcgcsv: "100" },
    }],
    [{
      groupId: 3170,
      imageUrl: "https://images.example/product_200w.jpg",
      productId: 100,
    }],
  ), []);
});

test("accepts a changed provider image and clears its stale quarantine", () => {
  const metadata = sealedImageMetadataWithQuarantine({
    checkedAt: "2026-09-07T10:00:00.000Z",
    metadata: { groupId: 3170, provider: "tcgcsv" },
    status: 404,
    url: "https://images.example/old_200w.jpg",
  });
  const state = importedTcgcsvSealedImageState(
    metadata,
    "https://images.example/replacement_200w.jpg",
  );

  assert.equal(state.imageUrl, "https://images.example/replacement_in_1000x1000.jpg");
  assert.equal(state.metadata.imageQuarantine, undefined);
  assert.deepEqual(buildSealedImageRepairPlan(
    [{
      id: "sealed-1",
      imageUrl: null,
      metadata,
      providerIds: { tcgcsv: "100" },
    }],
    [{
      groupId: 3170,
      imageUrl: "https://images.example/replacement_200w.jpg",
      productId: 100,
    }],
  ), [{
    groupId: "3170",
    id: "sealed-1",
    imageUrl: "https://images.example/replacement_in_1000x1000.jpg",
    metadata: { groupId: 3170, provider: "tcgcsv" },
    productId: "100",
  }]);
});

test("preserves a different existing fallback when the provider repeats a quarantined image", () => {
  const metadata = sealedImageMetadataWithQuarantine({
    checkedAt: "2026-09-07T10:00:00.000Z",
    metadata: { groupId: 3170 },
    status: 403,
    url: "https://images.example/dead_200w.jpg",
  });
  const state = importedTcgcsvSealedImageState(
    metadata,
    "https://images.example/dead_200w.jpg",
    "https://assets.tcgdex.net/fallback/high.webp",
  );

  assert.equal(state.imageUrl, "https://assets.tcgdex.net/fallback/high.webp");
  assert.deepEqual(state.metadata.imageQuarantine, metadata.imageQuarantine);
});

test("limits sealed image quarantine to reviewed permanent HTTP failures", () => {
  for (const status of [400, 403, 404, 410]) {
    assert.equal(isPermanentSealedImageFailureStatus(status), true);
  }

  for (const status of [0, 302, 401, 429, 500, 503, null]) {
    assert.equal(isPermanentSealedImageFailureStatus(status), false);
  }

  assert.throws(
    () => sealedImageMetadataWithQuarantine({
      checkedAt: "2026-09-07T10:00:00.000Z",
      metadata: {},
      status: 503,
      url: "https://images.example/outage.jpg",
    }),
    /valid URL, permanent HTTP status, and checked time/,
  );
});
