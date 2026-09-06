import assert from "node:assert/strict";
import test from "node:test";
import {
  lockCollectionItemsForBinderConsistency,
  reconcileBinderSlotsForQuantity,
} from "../src/lib/binders/slot-reconciliation.ts";

test("binder consistency locks are scoped to the owning user and active items", async () => {
  let query;
  const transaction = {
    async $queryRaw(value) {
      query = value;
      return [];
    },
  };

  await lockCollectionItemsForBinderConsistency(
    transaction,
    "11111111-1111-4111-8111-111111111111",
    [
      "33333333-3333-4333-8333-333333333333",
      "22222222-2222-4222-8222-222222222222",
    ],
  );

  const sql = query.strings.join("?");
  assert.match(sql, /"id" IN \(\?::uuid,\?::uuid\)/);
  assert.match(sql, /"user_id" = \?::uuid/);
  assert.match(sql, /"archived_at" IS NULL/);
  assert.equal(query.values.includes("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(query.values.includes("22222222-2222-4222-8222-222222222222"), true);
  assert.equal(query.values.includes("33333333-3333-4333-8333-333333333333"), true);
});

test("quantity reduction clears binder copies above the remaining quantity", async () => {
  const calls = [];
  const transaction = {
    binderSlot: {
      async updateMany(args) {
        calls.push(args);
        return { count: 2 };
      },
    },
  };

  await reconcileBinderSlotsForQuantity(transaction, "lot-1", 1);
  assert.deepEqual(calls[0], {
    where: {
      collectionItemId: "lot-1",
      OR: [{ copyIndex: null }, { copyIndex: { gt: 1 } }],
    },
    data: { collectionItemId: null, copyIndex: null },
  });
});

test("archive or full sale clears every binder copy", async () => {
  let where;
  const transaction = {
    binderSlot: {
      async updateMany(args) {
        where = args.where;
        return { count: 3 };
      },
    },
  };

  await reconcileBinderSlotsForQuantity(transaction, "lot-1", 0);
  assert.deepEqual(where, { collectionItemId: "lot-1" });
});
