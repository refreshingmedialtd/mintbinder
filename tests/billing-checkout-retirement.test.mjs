import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBillingCheckoutRetirementHealthy,
  BillingCheckoutRetirementIncompleteError,
  runBillingCheckoutRetirement,
} from "../src/lib/billing/checkout-retirement.ts";

const NOW = new Date("2026-08-24T12:00:00.000Z");

test("claims a bounded cross-account batch without requiring a user request", async () => {
  const rows = Array.from({ length: 220 }, (_, index) => intent({
    id: `intent-${index.toString().padStart(3, "0")}`,
    idempotencyKey: `key-${index}`,
    providerCheckoutId: null,
  }));
  const store = checkoutStore(rows);
  const result = await runBillingCheckoutRetirement({
    batchSize: 5_000,
    now: NOW,
    prisma: store,
    providers: providerDouble(),
  });

  assert.equal(result.batchSize, 200);
  assert.equal(result.candidates, 200);
  assert.equal(result.claimed, 200);
  assert.equal(result.ambiguous, 200);
  assert.equal(store.calls.findMany[0].where.userId, undefined);
  assert.equal(store.calls.findMany[0].take, 200);
  assert.equal(rows.filter((row) => row.status === "recoverable").length, 200);
  assert.equal(rows.filter((row) => row.status === "ready").length, 20);
});

test("deletes an open Square link only after checking its order twice", async () => {
  const row = intent({ provider: "square", providerCheckoutId: "link-1" });
  const store = checkoutStore([row]);
  const providers = providerDouble({ squareOrderStates: ["OPEN", "OPEN"] });
  const result = await runBillingCheckoutRetirement({ now: NOW, prisma: store, providers });

  assert.equal(providers.calls.squareDeletes, 1);
  assert.deepEqual(providers.calls.squareOrders, ["order-1", "order-1"]);
  assert.equal(result.retired, 1);
  assert.equal(row.status, "retired");
  assert.equal(row.checkoutUrl, null);
  assert.equal(row.expiresAt.getTime(), 0);
});

test("preserves Square correlation when payment completes while link retirement is in progress", async () => {
  const row = intent({ provider: "square", providerCheckoutId: "link-race" });
  const store = checkoutStore([row]);
  const providers = providerDouble({ squareOrderStates: ["OPEN", "COMPLETED"] });
  const result = await runBillingCheckoutRetirement({ now: NOW, prisma: store, providers });

  assert.equal(providers.calls.squareDeletes, 1);
  assert.equal(result.completedPendingReconciliation, 1);
  assert.equal(result.retired, 0);
  assert.equal(row.status, "paid_pending_subscription");
  assert.equal(row.idempotencyKey, "key-1");
  assert.equal(row.providerCheckoutId, "link-race");
});

test("recovers a crash after Square link deletion from the durable order reference", async () => {
  const row = intent({
    provider: "square",
    providerCheckoutId: "link-crash",
    providerOrderId: null,
  });
  const store = checkoutStore([row]);
  const firstProviders = providerDouble({
    squareOrderResults: ["OPEN", new Error("Order lookup timed out after deletion.")],
    squarePaymentLinks: [{ order_id: "order-crash" }],
  });
  const first = await runBillingCheckoutRetirement({ now: NOW, prisma: store, providers: firstProviders });

  assert.equal(firstProviders.calls.squareDeletes, 1);
  assert.equal(first.errors, 1);
  assert.equal(first.retired, 0);
  assert.equal(row.status, "recoverable");
  assert.equal(row.providerOrderId, "order-crash");

  const nextNow = new Date("2026-08-24T12:16:00.000Z");
  const secondProviders = providerDouble({
    squareOrderResults: ["CANCELED"],
    squarePaymentLinks: [null],
  });
  const second = await runBillingCheckoutRetirement({ now: nextNow, prisma: store, providers: secondProviders });

  assert.equal(secondProviders.calls.squareDeletes, 0);
  assert.equal(second.retired, 1);
  assert.equal(second.ambiguous, 0);
  assert.equal(row.status, "retired");
});

test("reclaims a stale retiring lease left by a hard crash after Square deletion", async () => {
  const row = intent({
    provider: "square",
    providerCheckoutId: "link-hard-crash",
    providerOrderId: "order-hard-crash",
    status: "retiring",
    updatedAt: new Date("2026-08-24T11:30:00.000Z"),
  });
  const store = checkoutStore([row]);
  const providers = providerDouble({
    squareOrderResults: ["CANCELED"],
    squarePaymentLinks: [null],
  });
  const result = await runBillingCheckoutRetirement({ now: NOW, prisma: store, providers });

  assert.equal(result.claimed, 1);
  assert.equal(result.retired, 1);
  assert.equal(providers.calls.squareDeletes, 0);
  assert.equal(row.status, "retired");
});

test("does not overwrite a webhook completion racing the retirement worker", async () => {
  const row = intent({ provider: "square", providerCheckoutId: "link-webhook-race" });
  const store = checkoutStore([row]);
  let releaseDelete;
  let deleteStarted;
  const started = new Promise((resolve) => { deleteStarted = resolve; });
  const release = new Promise((resolve) => { releaseDelete = resolve; });
  const providers = providerDouble({
    async squareDelete() {
      deleteStarted();
      await release;
    },
    squareOrderStates: ["OPEN", "OPEN"],
  });
  const retirement = runBillingCheckoutRetirement({ now: NOW, prisma: store, providers });

  await started;
  row.status = "completed";
  releaseDelete();
  const result = await retirement;

  assert.equal(result.retired, 0);
  assert.equal(result.skipped, 1);
  assert.equal(row.status, "completed");
});

test("keeps completed Stripe sessions pending and expires open sessions", async () => {
  const complete = intent({ id: "stripe-complete", idempotencyKey: "key-complete", provider: "stripe", providerCheckoutId: "cs-complete" });
  const open = intent({ id: "stripe-open", idempotencyKey: "key-open", provider: "stripe", providerCheckoutId: "cs-open" });
  const store = checkoutStore([complete, open]);
  const providers = providerDouble({
    stripeStatuses: {
      "cs-complete": ["complete"],
      "cs-open": ["open", "expired"],
    },
  });
  const result = await runBillingCheckoutRetirement({ now: NOW, prisma: store, providers });

  assert.equal(result.completedPendingReconciliation, 1);
  assert.equal(result.retired, 1);
  assert.deepEqual(providers.calls.stripeExpires, ["cs-open"]);
  assert.equal(complete.status, "paid_pending_subscription");
  assert.equal(open.status, "retired");
});

test("preserves missing, unknown, and unverifiable provider references", async () => {
  const missing = intent({ id: "missing", idempotencyKey: "key-missing", providerCheckoutId: null });
  const unknown = intent({ id: "unknown", idempotencyKey: "key-unknown", provider: "other", providerCheckoutId: "other-1" });
  const missingSquareOrder = intent({ id: "square-missing-order", idempotencyKey: "key-square", provider: "square", providerCheckoutId: "link-no-order" });
  const store = checkoutStore([missing, unknown, missingSquareOrder]);
  const providers = providerDouble({ squareOrderId: null });
  const result = await runBillingCheckoutRetirement({ now: NOW, prisma: store, providers });

  assert.equal(result.ambiguous, 3);
  assert.equal(result.retired, 0);
  assert.equal(providers.calls.squareDeletes, 0);
  assert.equal(result.issues.length, 3);
  assert.equal([missing, unknown, missingSquareOrder].every((row) => row.status === "recoverable"), true);
  assert.equal([missing, unknown, missingSquareOrder].every((row) => row.idempotencyKey.startsWith("key-")), true);
});

test("reclaims stale creating, recoverable, and retiring leases but leaves fresh work alone", async () => {
  const stale = ["creating", "recoverable", "retiring"].map((status, index) => intent({
    id: `stale-${status}`,
    idempotencyKey: `key-stale-${index}`,
    providerCheckoutId: null,
    status,
    updatedAt: new Date("2026-08-24T11:30:00.000Z"),
  }));
  const fresh = intent({
    id: "fresh-creating",
    idempotencyKey: "key-fresh",
    providerCheckoutId: null,
    status: "creating",
    updatedAt: new Date("2026-08-24T11:59:00.000Z"),
  });
  const store = checkoutStore([...stale, fresh]);
  const result = await runBillingCheckoutRetirement({ now: NOW, prisma: store, providers: providerDouble() });

  assert.equal(result.candidates, 3);
  assert.equal(result.claimed, 3);
  assert.equal(fresh.status, "creating");
  assert.equal(stale.every((row) => row.status === "recoverable"), true);
});

test("turns ambiguous or provider-error results into tracked-job failures with structured detail", () => {
  const result = {
    ambiguous: 1,
    batchSize: 50,
    candidates: 1,
    claimed: 1,
    completedPendingReconciliation: 0,
    errors: 0,
    issues: [{ intentId: "intent-1", provider: "square", reason: "Missing provider truth." }],
    retired: 0,
    skipped: 0,
    staleBefore: "2026-08-24T11:45:00.000Z",
  };

  assert.throws(
    () => assertBillingCheckoutRetirementHealthy(result),
    (error) => error instanceof BillingCheckoutRetirementIncompleteError && error.resultPayload === result,
  );
  const healthy = { ...result, ambiguous: 0 };
  assert.equal(assertBillingCheckoutRetirementHealthy(healthy), healthy);
});

function intent(overrides = {}) {
  return {
    checkoutUrl: "https://checkout.example/session",
    expiresAt: new Date("2026-08-24T11:00:00.000Z"),
    id: "intent-1",
    idempotencyKey: "key-1",
    provider: "square",
    providerCheckoutId: "link-1",
    providerOrderId: null,
    status: "ready",
    updatedAt: new Date("2026-08-24T10:00:00.000Z"),
    ...overrides,
  };
}

function checkoutStore(rows) {
  const calls = { findMany: [], updateMany: [] };
  return {
    calls,
    billingCheckoutIntent: {
      async findMany(args) {
        calls.findMany.push(args);
        const staleBefore = args.where.OR[1].updatedAt.lte;
        const now = args.where.OR[0].expiresAt.lte;
        return rows
          .filter((row) => (
            (row.status === "ready" && row.expiresAt <= now) ||
            (["creating", "recoverable", "retiring"].includes(row.status) && row.updatedAt <= staleBefore)
          ))
          .sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id))
          .slice(0, args.take);
      },
      async updateMany(args) {
        calls.updateMany.push(args);
        const row = rows.find((candidate) => candidate.id === args.where.id);
        if (!row || !matches(row, args.where)) return { count: 0 };
        Object.assign(row, args.data);
        return { count: 1 };
      },
    },
  };
}

function matches(row, where) {
  return Object.entries(where).every(([field, expected]) => {
    const actual = row[field];
    if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
    if (expected && typeof expected === "object" && "in" in expected) return expected.in.includes(actual);
    return actual === expected;
  });
}

function providerDouble({
  squareDelete,
  squareOrderId = "order-1",
  squareOrderResults,
  squareOrderStates = ["OPEN", "OPEN"],
  squarePaymentLinks,
  stripeStatuses = {},
} = {}) {
  const calls = {
    squareDeletes: 0,
    squareOrders: [],
    stripeExpires: [],
  };
  const squareResults = [...(squareOrderResults ?? squareOrderStates)];
  const paymentLinks = squarePaymentLinks ? [...squarePaymentLinks] : null;
  const stripeStateQueues = Object.fromEntries(
    Object.entries(stripeStatuses).map(([key, value]) => [key, [...value]]),
  );
  return {
    calls,
    square: {
      async deletePaymentLink(id) {
        calls.squareDeletes += 1;
        await squareDelete?.(id);
      },
      async retrieveOrder(orderId) {
        calls.squareOrders.push(orderId);
        const result = squareResults.shift();
        if (result instanceof Error) throw result;
        return { state: result };
      },
      async retrievePaymentLink() {
        return paymentLinks ? paymentLinks.shift() : { order_id: squareOrderId };
      },
    },
    stripe: {
      async expireCheckoutSession(id) {
        calls.stripeExpires.push(id);
      },
      async retrieveCheckoutSession(id) {
        return { status: stripeStateQueues[id]?.shift() };
      },
    },
  };
}
