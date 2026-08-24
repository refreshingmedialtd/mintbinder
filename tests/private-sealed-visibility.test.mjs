import assert from "node:assert/strict";
import test from "node:test";
import {
  visibleSealedProductWhere,
  visibleSealedProductsWhere,
} from "../src/lib/db/visibility.ts";

test("scopes sealed products to global catalogue entries or the current owner", () => {
  assert.deepEqual(visibleSealedProductWhere("user-1", "sealed-1"), {
    id: "sealed-1",
    OR: [
      { visibility: "GLOBAL" },
      { createdByUserId: "user-1" },
    ],
  });
});

test("keeps paginated sealed-product hydration scoped after the id query", () => {
  assert.deepEqual(visibleSealedProductsWhere("user-1", ["sealed-1", "sealed-2"]), {
    id: { in: ["sealed-1", "sealed-2"] },
    OR: [
      { visibility: "GLOBAL" },
      { createdByUserId: "user-1" },
    ],
  });
});

test("never produces an unscoped private sealed-product lookup", () => {
  const where = visibleSealedProductWhere("user-1", "sealed-1");

  assert.equal(where.createdByUserId, undefined);
  assert.equal(
    where.OR.some((condition) => condition.createdByUserId === "user-1"),
    true,
  );
  assert.equal(
    where.OR.some((condition) => condition.visibility === "GLOBAL"),
    true,
  );
});
