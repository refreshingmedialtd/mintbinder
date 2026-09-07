import assert from "node:assert/strict";
import test from "node:test";
import { deleteAccountData } from "../src/lib/account/deletion.ts";

test("locks ownership, removes dependent rows, cleans sealed products, then deletes the user", async () => {
  const calls = [];
  const transaction = transactionDouble(calls);
  const result = await deleteAccountData(transaction, "user-1");

  assert.deepEqual(calls.map((call) => call.operation), [
    "lock-billing",
    "lock-user",
    "check-checkouts",
    "check-subscriptions",
    "delete-collection",
    "delete-wishlist",
    "delete-non-global",
    "anonymise-global",
    "delete-user",
  ]);
  assert.deepEqual(calls[0].values, ["mintbinder-billing:user-1"]);
  assert.match(calls[1].sql, /SELECT "id"[\s\S]*"deletion_requested_at"[\s\S]*FROM "users"[\s\S]*FOR UPDATE/);
  assert.deepEqual(calls[1].values, ["user-1"]);
  assert.deepEqual(calls[3].args.where, {
    userId: "user-1",
    provider: { not: "local" },
    plan: { not: "FREE" },
    status: { notIn: ["CANCELED", "INCOMPLETE_EXPIRED"] },
  });
  assert.deepEqual(calls[6].args.where, {
    createdByUserId: "user-1",
    visibility: { in: ["PRIVATE", "PENDING_REVIEW"] },
  });
  assert.deepEqual(calls[7].args, {
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
  assert.deepEqual(calls.map((call) => call.operation), ["lock-billing", "lock-user"]);
});

test("refuses cleanup unless the account-deletion billing fence is active", async () => {
  const calls = [];
  const transaction = transactionDouble(calls, {
    lockedUsers: [{ deletionRequestedAt: null, id: "user-1" }],
  });

  await assert.rejects(deleteAccountData(transaction, "user-1"), /billing fence is not active/);
  assert.deepEqual(calls.map((call) => call.operation), ["lock-billing", "lock-user"]);
});

test("refuses final deletion when provider reconciliation remains unresolved", async () => {
  const calls = [];
  const transaction = transactionDouble(calls, { unresolvedCheckout: { id: "checkout-live" } });

  await assert.rejects(
    deleteAccountData(transaction, "user-1"),
    /checkout reconciliation is not complete/,
  );
  assert.equal(calls.some((call) => call.operation === "delete-user"), false);

  const subscriptionCalls = [];
  const subscriptionTransaction = transactionDouble(subscriptionCalls, {
    nonterminalExternalSubscription: { id: "subscription-live" },
  });
  await assert.rejects(
    deleteAccountData(subscriptionTransaction, "user-1"),
    /subscription reconciliation is not terminal/,
  );
  assert.equal(subscriptionCalls.some((call) => call.operation === "delete-user"), false);
});

test("failed Square checkout provider state remains fenced from final account deletion", async () => {
  const calls = [];
  const transaction = transactionDouble(calls, { unresolvedCheckout: { id: "failed-square" } });

  await assert.rejects(
    deleteAccountData(transaction, "user-1"),
    /checkout reconciliation is not complete/,
  );

  const checkoutCheck = calls.find((call) => call.operation === "check-checkouts");
  const failedSquareFence = checkoutCheck.args.where.OR.find(
    (condition) => condition.provider === "square" && condition.status === "failed",
  );
  assert.deepEqual(failedSquareFence, {
    provider: "square",
    status: "failed",
    OR: [
      { checkoutUrl: { not: null } },
      { providerCheckoutId: { not: null } },
      { providerCustomerId: { not: null } },
      { providerOrderId: { not: null } },
      { providerPaymentId: { not: null } },
    ],
  });
  assert.equal(calls.some((call) => call.operation === "delete-user"), false);
});

test("a provider webhook admitted before final deletion is observed under the billing lock", async () => {
  const calls = [];
  let releaseBillingLock;
  const billingLockAttempted = Promise.withResolvers();
  const billingLockRelease = new Promise((resolve) => { releaseBillingLock = resolve; });
  const state = { nonterminalExternalSubscription: null };
  const transaction = transactionDouble(calls, {
    async beforeBillingLock() {
      billingLockAttempted.resolve();
      await billingLockRelease;
    },
    nonterminalExternalSubscription: () => state.nonterminalExternalSubscription,
  });
  const deletion = deleteAccountData(transaction, "user-1");

  await billingLockAttempted.promise;
  // Represents provider reconciliation that acquired the same lock first and
  // committed while final deletion was queued behind it.
  state.nonterminalExternalSubscription = { id: "subscription-from-admitted-webhook" };
  releaseBillingLock();

  await assert.rejects(deletion, /subscription reconciliation is not terminal/);
  assert.equal(calls.some((call) => call.operation === "delete-user"), false);
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
  beforeBillingLock,
  beforeNonGlobalDelete,
  beforeUserDelete,
  lockedUsers = [{ deletionRequestedAt: new Date("2026-09-07T12:00:00.000Z"), id: "user-1" }],
  nonterminalExternalSubscription = null,
  unresolvedCheckout = null,
} = {}) {
  return {
    async $executeRaw(strings, ...values) {
      calls.push({ operation: "lock-billing", sql: strings.join("?"), values });
      await beforeBillingLock?.();
      return 1;
    },
    async $queryRaw(strings, ...values) {
      calls.push({ operation: "lock-user", sql: strings.join("?"), values });
      await afterLock?.();
      return lockedUsers;
    },
    billingCheckoutIntent: {
      async findFirst(args) {
        calls.push({ operation: "check-checkouts", args });
        return typeof unresolvedCheckout === "function" ? unresolvedCheckout() : unresolvedCheckout;
      },
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
    subscription: {
      async findFirst(args) {
        calls.push({ operation: "check-subscriptions", args });
        return typeof nonterminalExternalSubscription === "function"
          ? nonterminalExternalSubscription()
          : nonterminalExternalSubscription;
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
