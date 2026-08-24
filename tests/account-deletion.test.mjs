import assert from "node:assert/strict";
import test from "node:test";
import { deleteAccountData } from "../src/lib/account/deletion.ts";

test("locks ownership, removes dependent rows, cleans sealed products, then deletes the user", async () => {
  const calls = [];
  const transaction = transactionDouble(calls);
  const result = await deleteAccountData(transaction, "user-1");

  assert.deepEqual(calls.map((call) => call.operation), [
    "lock-user",
    "delete-collection",
    "delete-wishlist",
    "delete-non-global",
    "anonymise-global",
    "delete-user",
  ]);
  assert.match(calls[0].sql, /SELECT "id"[\s\S]*FROM "users"[\s\S]*FOR UPDATE/);
  assert.deepEqual(calls[0].values, ["user-1"]);
  assert.deepEqual(calls[3].args.where, {
    createdByUserId: "user-1",
    visibility: { in: ["PRIVATE", "PENDING_REVIEW"] },
  });
  assert.deepEqual(calls[4].args, {
    where: {
      createdByUserId: "user-1",
      visibility: "GLOBAL",
    },
    data: {
      createdByUserId: null,
      notes: null,
    },
  });
  assert.deepEqual(result, {
    anonymizedGlobalProducts: 1,
    deletedNonGlobalProducts: 2,
  });
});

test("refuses cleanup when the user row cannot be locked", async () => {
  const calls = [];
  const transaction = transactionDouble(calls, { lockedUsers: [] });

  await assert.rejects(deleteAccountData(transaction, "missing-user"), /could not be locked/);
  assert.deepEqual(calls.map((call) => call.operation), ["lock-user"]);
});

test("a creator insert queued behind account deletion cannot become an orphan", async () => {
  const calls = [];
  let userExists = true;
  let lockAcquired;
  let createQueued;
  let continueCleanup;
  let releaseUserLock;
  const acquired = new Promise((resolve) => { lockAcquired = resolve; });
  const queued = new Promise((resolve) => { createQueued = resolve; });
  const cleanupCanContinue = new Promise((resolve) => { continueCleanup = resolve; });
  const userLockReleased = new Promise((resolve) => { releaseUserLock = resolve; });
  const transaction = transactionDouble(calls, {
    async afterLock() {
      lockAcquired();
    },
    async beforeNonGlobalDelete() {
      await queued;
      continueCleanup();
    },
    async beforeUserDelete() {
      userExists = false;
      releaseUserLock();
    },
  });
  const deletion = deleteAccountData(transaction, "user-1");

  await acquired;
  const concurrentCreate = (async () => {
    createQueued();
    await userLockReleased;
    if (!userExists) throw new Error("Foreign-key owner no longer exists.");
    return { createdByUserId: "user-1" };
  })();
  await cleanupCanContinue;
  await deletion;

  await assert.rejects(concurrentCreate, /owner no longer exists/);
  assert.equal(userExists, false);
  assert.equal(calls.at(-1).operation, "delete-user");
});

function transactionDouble(calls, {
  afterLock,
  beforeNonGlobalDelete,
  beforeUserDelete,
  lockedUsers = [{ id: "user-1" }],
} = {}) {
  return {
    async $queryRaw(strings, ...values) {
      calls.push({ operation: "lock-user", sql: strings.join("?"), values });
      await afterLock?.();
      return lockedUsers;
    },
    collectionItem: {
      async deleteMany(args) {
        calls.push({ operation: "delete-collection", args });
        return { count: 3 };
      },
    },
    sealedProduct: {
      async deleteMany(args) {
        await beforeNonGlobalDelete?.();
        calls.push({ operation: "delete-non-global", args });
        return { count: 2 };
      },
      async updateMany(args) {
        calls.push({ operation: "anonymise-global", args });
        return { count: 1 };
      },
    },
    user: {
      async delete(args) {
        await beforeUserDelete?.();
        calls.push({ operation: "delete-user", args });
        return {};
      },
    },
    wishlistItem: {
      async deleteMany(args) {
        calls.push({ operation: "delete-wishlist", args });
        return { count: 2 };
      },
    },
  };
}
