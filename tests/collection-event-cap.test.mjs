import assert from "node:assert/strict";
import test from "node:test";
import { reserveCollectionEventForDestructiveMutation } from "../src/lib/db/app-data.ts";
import { USER_RESOURCE_LIMITS, UserQuotaExceededError } from "../src/lib/db/user-quotas.ts";

test("a destructive collection mutation can replace one old edit at the exact event cap", async () => {
  const calls = [];
  const transaction = eventTransaction({
    count: USER_RESOURCE_LIMITS.collectionEvents,
    replaceable: { id: "old-edit" },
    calls,
  });

  assert.deepEqual(
    await reserveCollectionEventForDestructiveMutation(transaction, "user-1"),
    { compacted: true },
  );
  assert.deepEqual(calls.at(-1), ["delete", {
    id: "old-edit",
    userId: "user-1",
    eventType: "EDITED",
  }]);
});

test("the cap never sacrifices important history when no edit event is replaceable", async () => {
  await assert.rejects(
    reserveCollectionEventForDestructiveMutation(eventTransaction({
      count: USER_RESOURCE_LIMITS.collectionEvents,
      replaceable: null,
      calls: [],
    }), "user-1"),
    UserQuotaExceededError,
  );
});

function eventTransaction({ count, replaceable, calls }) {
  return {
    collectionEvent: {
      async count(args) { calls.push(["count", args.where]); return count; },
      async findFirst(args) { calls.push(["find", args.where]); return replaceable; },
      async deleteMany(args) { calls.push(["delete", args.where]); return { count: 1 }; },
    },
  };
}
