import assert from "node:assert/strict";
import test from "node:test";
import {
  orderSealedPricingMatches,
  selectSealedProductBatch,
} from "../scripts/tcgcsv-sealed-importer.mjs";

test("batches sealed products after filtering card rows", () => {
  const products = [
    ...Array.from({ length: 80 }, (_, index) => ({ name: `Card ${index}`, productId: index })),
    { name: "Chaos Rising Booster Bundle", productId: 1001 },
    { name: "Chaos Rising Elite Trainer Box", productId: 1002 },
  ];
  const batch = selectSealedProductBatch({ metadata: {}, productLimit: 40, products });

  assert.deepEqual(batch.products.map((product) => product.productId), [1001, 1002]);
  assert.equal(batch.complete, true);
  assert.equal(batch.sealedProductsAvailable, 2);
  assert.equal(batch.sealedProductsSkipped, 80);
});

test("resets legacy raw-product cursors for the sealed-only rotation", () => {
  const products = [
    { name: "Booster Box", productId: 1 },
    { name: "Booster Bundle", productId: 2 },
  ];
  const batch = selectSealedProductBatch({
    metadata: { scheduledSealedPricingNextProductIndex: 120 },
    productLimit: 1,
    products,
  });

  assert.equal(batch.products[0].productId, 1);
  assert.equal(batch.nextProductIndex, 1);
});

test("prioritizes a set when any owned sealed product has stale pricing", () => {
  const ordered = orderSealedPricingMatches([
    {
      group: { groupId: 1, name: "Unowned Set" },
      set: { id: "unowned", metadata: {}, sealedProducts: [] },
    },
    {
      group: { groupId: 2, name: "Owned Set" },
      set: {
        id: "owned",
        metadata: {},
        sealedProducts: [
          { priceSnapshots: [{ observedAt: new Date("2099-01-01T00:00:00.000Z") }] },
          { priceSnapshots: [{ observedAt: new Date("2020-01-01T00:00:00.000Z") }] },
        ],
      },
    },
  ]);

  assert.equal(ordered[0].set.id, "owned");
});
