import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertBillingCheckoutRetirementHealthy,
  BillingCheckoutRetirementIncompleteError,
  runBillingCheckoutRetirement,
} from "../src/lib/billing/checkout-retirement.ts";
import { createSquareCheckoutCorrelation } from "../src/lib/billing/square-checkout-correlation.ts";
import { inspectImmediateSquareRetirement } from "../src/lib/billing/square-retirement-precheck.ts";

const NOW = new Date("2026-08-24T12:00:00.000Z");
const CORRELATION_KEY = "11111111-1111-4111-8111-111111111111";
const CORRELATION_SECRET = "square-retirement-correlation-test-secret";

test("request-time Square retirement precheck detects payment evidence without deleting", async () => {
  const beforePayment = immediateSquareRetirementDouble({
    paymentResults: [[{ id: "payment-race", order_id: "order-1", status: "COMPLETED" }]],
  });

  const result = await inspectImmediateSquareRetirement({
    checkoutCreatedAt: NOW,
    providerCheckoutId: "link-1",
    providerOrderId: "order-1",
    square: beforePayment,
  });

  assert.deepEqual(result, { kind: "completed", orderId: "order-1" });
  assert.equal(beforePayment.calls.paymentSearches.length, 1);
});

test("request-time Square retirement leaves a payment-free OPEN order to the worker", async () => {
  const square = immediateSquareRetirementDouble({ paymentResults: [[]] });

  const result = await inspectImmediateSquareRetirement({
    checkoutCreatedAt: NOW,
    providerCheckoutId: "link-1",
    providerOrderId: "order-1",
    square,
  });

  assert.deepEqual(result, { kind: "deferred", orderId: "order-1" });
  assert.equal(square.calls.paymentSearches.length, 1);
  assert.equal(square.calls.paymentSearches[0].orderId, "order-1");
  assert.equal(
    square.calls.paymentSearches[0].beginTime.toISOString(),
    "2026-08-24T11:55:00.000Z",
  );
});

test("request-time Square retirement fails closed on malformed payment or tender evidence", async (t) => {
  await t.test("payments", async () => {
    const square = immediateSquareRetirementDouble({ paymentResults: [null] });
    const result = await inspectImmediateSquareRetirement({
      checkoutCreatedAt: NOW,
      providerCheckoutId: "link-1",
      providerOrderId: "order-1",
      square,
    });

    assert.equal(result.kind, "invalid");
    assert.match(result.message, /Payments returned an invalid exact-order result/i);
  });

  await t.test("tenders", async () => {
    const square = immediateSquareRetirementDouble({
      orderResults: [{ state: "OPEN", tenders: { unexpected: true } }],
    });
    const result = await inspectImmediateSquareRetirement({
      checkoutCreatedAt: NOW,
      providerCheckoutId: "link-1",
      providerOrderId: "order-1",
      square,
    });

    assert.equal(result.kind, "invalid");
    assert.match(result.message, /invalid tender evidence/i);
  });
});

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

test("never shortens the production settlement window below fifteen minutes", async () => {
  const row = intent({
    providerCheckoutId: null,
    status: "recoverable",
    updatedAt: new Date("2026-08-24T11:46:00.000Z"),
  });
  const store = checkoutStore([row]);

  const result = await runBillingCheckoutRetirement({
    now: NOW,
    prisma: store,
    providers: providerDouble(),
    staleAfterMs: 1_000,
  });

  assert.equal(result.candidates, 0);
  assert.equal(result.staleBefore, "2026-08-24T11:45:00.000Z");
  assert.equal(row.status, "recoverable");
});

test("the protected retirement route ignores caller clocks and stale-window overrides", async () => {
  const route = await readFile(
    new URL("../src/app/api/jobs/billing-checkout-retirement/route.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(route, /body\.now|staleAfterMinutes|parseOptionalDate/);
  assert.match(route, /runBillingCheckoutRetirement\(\{\s*batchSize: input\.batchSize,\s*\}\)/);
  assert.match(route, /scheduled: body\.scheduled === true/);
});

test("requires a second stale provider pass before declaring a Square order payment-free", async () => {
  const row = intent({ provider: "square", providerCheckoutId: "link-1" });
  const store = checkoutStore([row]);
  const providers = providerDouble({ squareOrderStates: ["OPEN", "CANCELED", "CANCELED"] });
  const first = await runBillingCheckoutRetirement({ now: NOW, prisma: store, providers });

  assert.equal(providers.calls.squareDeletes, 1);
  assert.equal(first.settling, 1);
  assert.equal(first.retired, 0);
  assert.equal(row.status, "retiring");
  assert.equal(row.checkoutUrl, null);
  assert.equal(row.providerCheckoutId, null);
  assert.equal(row.expiresAt.getTime(), 0);
  assert.equal(row.leaseExpiresAt.toISOString(), "2026-08-24T12:05:00.000Z");

  const second = await runBillingCheckoutRetirement({
    now: new Date("2026-08-24T12:16:00.000Z"),
    prisma: store,
    providers,
  });
  assert.equal(second.retired, 1);
  assert.equal(row.status, "retired_payment_free");
  assert.deepEqual(providers.calls.squareOrders, ["order-1", "order-1", "order-1"]);
  assert.equal(providers.calls.squarePaymentSearches.length, 3);
  assert.equal(providers.calls.squarePaymentSearches.every((call) => call.orderId === "order-1"), true);
  assert.equal(
    providers.calls.squarePaymentSearches.every(
      (call) => call.beginTime.toISOString() === "2026-08-24T09:55:00.000Z",
    ),
    true,
  );
});

test("keeps order-only completion visible for manual reconciliation", async () => {
  const row = intent({ provider: "square", providerCheckoutId: "link-race" });
  const store = checkoutStore([row]);
  const providers = providerDouble({ squareOrderStates: ["OPEN", "COMPLETED"] });
  const result = await runBillingCheckoutRetirement({ now: NOW, prisma: store, providers });

  assert.equal(providers.calls.squareDeletes, 1);
  assert.equal(result.completedPendingReconciliation, 0);
  assert.equal(result.ambiguous, 1);
  assert.equal(result.retired, 0);
  assert.equal(row.status, "retiring");
  assert.equal(row.idempotencyKey, "key-1");
  assert.equal(row.providerCheckoutId, null);
  assert.equal(row.providerPaymentId, null);
});

test("persists one uniquely proven exact completed Square payment for reconciliation", async () => {
  const row = intent({ id: "intent-payment", idempotencyKey: CORRELATION_KEY });
  const providers = providerDouble({
    squareOrderResults: [{ state: "OPEN", tenders: [] }],
    squarePaymentResults: [[
      { id: "payment-1", order_id: "order-1", status: "COMPLETED" },
      { id: "payment-failed", order_id: "order-1", status: "FAILED" },
    ]],
    squareRetrievedPayments: [exactCompletedPayment()],
  });
  const result = await runBillingCheckoutRetirement({
    now: NOW,
    prisma: checkoutStore([row]),
    providers,
  });

  assert.equal(result.completedPendingReconciliation, 1);
  assert.equal(result.ambiguous, 0);
  assert.equal(result.retired, 0);
  assert.equal(providers.calls.squareDeletes, 0);
  assert.equal(row.status, "paid_pending_subscription");
  assert.equal(row.providerPaymentId, "payment-1");
});

test("never stores a search result until exact Square payment retrieval proves every checkout binding", async () => {
  const cases = [
    ["payment ID", exactCompletedPayment({ id: "different-payment" }), {}],
    ["signed note", exactCompletedPayment({ note: "not-a-valid-correlation" }), {}],
    ["customer", exactCompletedPayment({ customer_id: " " }), {}],
    ["order", exactCompletedPayment({ order_id: "different-order" }), {}],
    ["amount", exactCompletedPayment({ amount_money: { amount: 998, currency: "GBP" } }), {}],
    ["currency", exactCompletedPayment({ amount_money: { amount: 999, currency: "USD" } }), {}],
    ["plan snapshot", exactCompletedPayment(), { providerPlanVariationId: null }],
  ];

  for (const [label, payment, intentOverrides] of cases) {
    const row = intent({
      id: `invalid-payment-${label.replace(" ", "-")}`,
      idempotencyKey: CORRELATION_KEY,
      ...intentOverrides,
    });
    const providers = providerDouble({
      squareOrderResults: [{ state: "COMPLETED", tenders: [{ id: "tender-1" }] }],
      squarePaymentResults: [[{ id: "payment-1", order_id: "order-1", status: "COMPLETED" }]],
      squareRetrievedPayments: [payment],
    });
    const result = await runBillingCheckoutRetirement({
      now: NOW,
      prisma: checkoutStore([row]),
      providers,
    });

    assert.equal(result.ambiguous, 1, label);
    assert.equal(result.completedPendingReconciliation, 0, label);
    assert.equal(row.providerPaymentId, null, label);
    assert.equal(row.status, "recoverable", label);
  }
});

test("keeps tender-only and ambiguous Square payment evidence visible for manual reconciliation", async () => {
  for (const [label, providerOptions] of [
    ["tender", {
      squareOrderResults: [{ state: "OPEN", tenders: [{ id: "tender-1" }] }],
      squarePaymentResults: [[]],
    }],
    ["noncompleted-payment", {
      squareOrderResults: [{ state: "OPEN", tenders: [] }],
      squarePaymentResults: [[{ id: "payment-1", order_id: "order-1", status: "APPROVED" }]],
    }],
    ["multiple-completed-payments", {
      squareOrderResults: [{ state: "COMPLETED", tenders: [] }],
      squarePaymentResults: [[
        { id: "payment-1", order_id: "order-1", status: "COMPLETED" },
        { id: "payment-2", order_id: "order-1", status: "COMPLETED" },
      ]],
    }],
  ]) {
    const row = intent({ id: `intent-${label}`, idempotencyKey: `key-${label}` });
    const providers = providerDouble(providerOptions);
    const result = await runBillingCheckoutRetirement({
      now: NOW,
      prisma: checkoutStore([row]),
      providers,
    });

    assert.equal(result.completedPendingReconciliation, 0, label);
    assert.equal(result.ambiguous, 1, label);
    assert.equal(result.retired, 0, label);
    assert.equal(providers.calls.squareDeletes, 0, label);
    assert.equal(row.status, "recoverable", label);
    assert.equal(row.providerPaymentId, null, label);
  }
});

test("provider payment-search errors fail closed without deleting the Square link", async () => {
  const row = intent();
  const providers = providerDouble({
    squarePaymentResults: [new Error("Square Payments API unavailable")],
  });
  const result = await runBillingCheckoutRetirement({
    now: NOW,
    prisma: checkoutStore([row]),
    providers,
  });

  assert.equal(result.errors, 1);
  assert.equal(result.retired, 0);
  assert.equal(providers.calls.squareDeletes, 0);
  assert.equal(row.status, "recoverable");
});

test("requires an exact Square link and canceled-order proof from deletion", async () => {
  for (const [label, providerOptions] of [
    ["wrong-link", { squareDeletedLinkId: "another-link" }],
    ["wrong-order", { squareCancelledOrderId: "another-order" }],
    ["missing-order", { squareCancelledOrderId: "" }],
  ]) {
    const row = intent({ id: `delete-proof-${label}`, idempotencyKey: `delete-proof-${label}-key` });
    const providers = providerDouble(providerOptions);
    const result = await runBillingCheckoutRetirement({
      now: NOW,
      prisma: checkoutStore([row]),
      providers,
    });

    assert.equal(result.ambiguous, 1, label);
    assert.equal(result.retired, 0, label);
    assert.equal(result.settling, 0, label);
    assert.equal(row.status, "recoverable", label);
  }
});

test("OPEN or DRAFT lag after exact Square deletion remains fenced in settling", async () => {
  for (const state of ["OPEN", "DRAFT"]) {
    const row = intent({ id: `post-delete-${state}`, idempotencyKey: `post-delete-${state}-key` });
    const providers = providerDouble({ squareOrderStates: ["OPEN", state] });
    const result = await runBillingCheckoutRetirement({
      now: NOW,
      prisma: checkoutStore([row]),
      providers,
    });

    assert.equal(result.ambiguous, 0, state);
    assert.equal(result.settling, 1, state);
    assert.equal(row.status, "retiring", state);
    assert.equal(row.providerCheckoutId, null, state);
  }
});

test("malformed Square payment or tender responses fail closed without deleting the link", async () => {
  for (const [label, providerOptions] of [
    ["payments", { squarePaymentResults: [{ invalid: true }] }],
    ["tenders", { squareOrderResults: [{ state: "OPEN", tenders: { invalid: true } }] }],
  ]) {
    const row = intent({ id: `malformed-${label}`, idempotencyKey: `malformed-${label}-key` });
    const providers = providerDouble(providerOptions);
    const result = await runBillingCheckoutRetirement({
      now: NOW,
      prisma: checkoutStore([row]),
      providers,
    });

    assert.equal(result.errors, 1, label);
    assert.equal(result.retired, 0, label);
    assert.equal(providers.calls.squareDeletes, 0, label);
    assert.equal(row.status, "recoverable", label);
  }
});

test("mismatched Square payment-link or order reads fail closed before deletion", async () => {
  for (const [label, providerOptions] of [
    ["payment-link", { squarePaymentLinks: [{ id: "link-other", order_id: "order-1" }] }],
    ["order", { squareOrderResults: [{ id: "order-other", state: "OPEN", tenders: [] }] }],
  ]) {
    const row = intent({ id: `wrong-read-${label}`, idempotencyKey: `wrong-read-${label}-key` });
    const providers = providerDouble(providerOptions);
    const result = await runBillingCheckoutRetirement({
      now: NOW,
      prisma: checkoutStore([row]),
      providers,
    });

    assert.equal(result.errors, 1, label);
    assert.equal(result.retired, 0, label);
    assert.equal(providers.calls.squareDeletes, 0, label);
    assert.equal(row.status, "recoverable", label);
  }
});

test("rechecks legacy retired Square references through two exact canceled-order passes", async () => {
  const paymentFree = intent({
    id: "legacy-payment-free",
    idempotencyKey: "legacy-payment-free-key",
    providerOrderId: "legacy-order",
    status: "retired",
  });
  const paid = intent({
    id: "legacy-paid",
    idempotencyKey: CORRELATION_KEY,
    checkoutUrl: null,
    providerCheckoutId: null,
    providerOrderId: "legacy-paid-order",
    providerPaymentId: "legacy-payment",
    status: "retired",
  });
  const store = checkoutStore([paymentFree, paid]);
  const providers = providerDouble({
    squareOrderId: "legacy-order",
    squareOrderResults: [
      { state: "CANCELED", tenders: [] },
      { state: "CANCELED", tenders: [] },
    ],
    squarePaymentLinks: [null],
    squarePaymentResults: [[], []],
    squareRetrievedPayments: [exactCompletedPayment({
      id: "legacy-payment",
      order_id: "legacy-paid-order",
    })],
  });
  const first = await runBillingCheckoutRetirement({ now: NOW, prisma: store, providers });

  assert.equal(first.candidates, 2);
  assert.equal(first.settling, 1);
  assert.equal(first.retired, 0);
  assert.equal(first.completedPendingReconciliation, 1);
  assert.equal(paymentFree.status, "retiring");
  assert.equal(paymentFree.providerCheckoutId, null);
  assert.equal(paid.status, "paid_pending_subscription");

  const second = await runBillingCheckoutRetirement({
    now: new Date("2026-08-24T12:16:00.000Z"),
    prisma: store,
    providers,
  });
  assert.equal(second.retired, 1);
  assert.equal(paymentFree.status, "retired_payment_free");
});

test("keeps a legacy stored Square payment ID manual until exact payment correlation is re-proven", async () => {
  const row = intent({
    checkoutUrl: null,
    id: "legacy-unproven-payment",
    idempotencyKey: CORRELATION_KEY,
    providerCheckoutId: null,
    providerOrderId: "legacy-order",
    providerPaymentId: "legacy-payment",
    status: "retired",
  });
  const providers = providerDouble({
    squareRetrievedPayments: [exactCompletedPayment({
      id: "different-payment",
      order_id: "legacy-order",
    })],
  });

  const result = await runBillingCheckoutRetirement({
    now: NOW,
    prisma: checkoutStore([row]),
    providers,
  });

  assert.equal(result.completedPendingReconciliation, 0);
  assert.equal(result.ambiguous, 1);
  assert.equal(row.providerPaymentId, "legacy-payment");
  assert.equal(row.status, "retiring");
});

test("a detached legacy retired order-only candidate receives the claimed retiring status", async () => {
  const row = intent({
    checkoutUrl: null,
    id: "legacy-detached-order",
    idempotencyKey: "legacy-detached-order-key",
    providerCheckoutId: null,
    providerOrderId: "legacy-detached-order",
    status: "retired",
  });
  const store = checkoutStore([row]);
  const providers = providerDouble({
    squareOrderId: "legacy-detached-order",
    squareOrderResults: [{ state: "CANCELED", tenders: [] }],
    squarePaymentResults: [[]],
  });

  const result = await runBillingCheckoutRetirement({ now: NOW, prisma: store, providers });

  assert.equal(result.claimed, 1);
  assert.equal(result.ambiguous, 0);
  assert.equal(result.retired, 1);
  assert.equal(row.status, "retired_payment_free");
  assert.equal(row.providerOrderId, "legacy-detached-order");
});

test("checkpoints exact Square cancellation before a post-delete provider failure", async () => {
  const row = intent({
    provider: "square",
    providerCheckoutId: "link-crash",
    providerOrderId: null,
  });
  const store = checkoutStore([row]);
  const firstProviders = providerDouble({
    squareOrderId: "order-crash",
    squareOrderResults: ["OPEN", new Error("Order lookup timed out after deletion.")],
    squarePaymentLinks: [{ order_id: "order-crash" }],
  });
  const first = await runBillingCheckoutRetirement({ now: NOW, prisma: store, providers: firstProviders });

  assert.equal(firstProviders.calls.squareDeletes, 1);
  assert.equal(first.errors, 1);
  assert.equal(first.retired, 0);
  assert.equal(row.status, "retiring");
  assert.equal(row.providerCheckoutId, null);
  assert.equal(row.providerOrderId, "order-crash");

  const nextNow = new Date("2026-08-24T12:16:00.000Z");
  const secondProviders = providerDouble({ squareOrderResults: ["CANCELED"], squarePaymentLinks: [null] });
  const second = await runBillingCheckoutRetirement({ now: nextNow, prisma: store, providers: secondProviders });

  assert.equal(secondProviders.calls.squareDeletes, 0);
  assert.equal(second.settling, 0);
  assert.equal(second.retired, 1);
  assert.equal(second.ambiguous, 0);
  assert.equal(row.status, "retired_payment_free");
});

test("recovers a crash after Square DELETE but before the durable cancellation checkpoint", async () => {
  const row = intent({
    provider: "square",
    providerCheckoutId: "link-hard-crash",
    providerOrderId: "order-hard-crash",
    status: "retiring",
    updatedAt: new Date("2026-08-24T11:30:00.000Z"),
  });
  const store = checkoutStore([row]);
  const providers = providerDouble({
    squareOrderResults: ["CANCELED", "CANCELED"],
    squarePaymentLinks: [null],
  });
  const first = await runBillingCheckoutRetirement({ now: NOW, prisma: store, providers });

  assert.equal(first.claimed, 1);
  assert.equal(first.settling, 1);
  assert.equal(first.retired, 0);
  assert.equal(providers.calls.squareDeletes, 0);
  assert.equal(row.status, "retiring");
  assert.equal(row.providerCheckoutId, null);

  const second = await runBillingCheckoutRetirement({
    now: new Date("2026-08-24T12:16:00.000Z"),
    prisma: store,
    providers,
  });
  assert.equal(second.retired, 1);
  assert.equal(row.status, "retired_payment_free");
});

test("does not trust a malformed cancellation checkpoint that still has a checkout URL", async () => {
  const row = intent({
    checkoutUrl: "https://checkout.example/still-live",
    providerCheckoutId: null,
    providerOrderId: "order-malformed-marker",
    status: "retiring",
    updatedAt: new Date("2026-08-24T11:30:00.000Z"),
  });
  const result = await runBillingCheckoutRetirement({
    now: NOW,
    prisma: checkoutStore([row]),
    providers: providerDouble({
      squareOrderId: "order-malformed-marker",
      squareOrderStates: ["CANCELED"],
    }),
  });

  assert.equal(result.ambiguous, 1);
  assert.equal(result.retired, 0);
  assert.equal(row.status, "recoverable");
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
  const pendingPayment = { ...healthy, completedPendingReconciliation: 1 };
  assert.throws(
    () => assertBillingCheckoutRetirementHealthy(pendingPayment),
    (error) =>
      error instanceof BillingCheckoutRetirementIncompleteError &&
      error.resultPayload === pendingPayment,
  );
});

function intent(overrides = {}) {
  return {
    checkoutUrl: "https://checkout.example/session",
    createdAt: new Date("2026-08-24T10:00:00.000Z"),
    expectedAmountMinor: 999,
    expectedCurrency: "GBP",
    expiresAt: new Date("2026-08-24T11:00:00.000Z"),
    id: "intent-1",
    idempotencyKey: "key-1",
    leaseExpiresAt: new Date("2026-08-24T10:05:00.000Z"),
    plan: "PLUS_MONTHLY",
    provider: "square",
    providerCheckoutId: "link-1",
    providerCustomerId: "customer-1",
    providerOrderId: null,
    providerPaymentId: null,
    providerPlanVariationId: "variation-1",
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
            (["creating", "recoverable", "retiring"].includes(row.status) && row.updatedAt <= staleBefore) ||
            (row.provider === "square" && row.status === "retired" && Boolean(
              row.checkoutUrl || row.providerCheckoutId || row.providerOrderId || row.providerPaymentId
            ))
          ))
          .sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id))
          .slice(0, args.take)
          .map((row) => ({ ...row }));
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
  squareCancelledOrderId,
  squareDeletedLinkId,
  squareOrderId = "order-1",
  squareOrderResults,
  squareOrderStates = ["OPEN", "OPEN"],
  squarePaymentResults,
  squarePaymentLinks,
  squareRetrievedPayments,
  stripeStatuses = {},
} = {}) {
  const calls = {
    squareDeletes: 0,
    squareOrders: [],
    squarePayments: [],
    squarePaymentSearches: [],
    stripeExpires: [],
  };
  const squareResults = [...(squareOrderResults ?? squareOrderStates)];
  const paymentLinks = squarePaymentLinks ? [...squarePaymentLinks] : null;
  const paymentResults = squarePaymentResults ? [...squarePaymentResults] : null;
  const retrievedPayments = squareRetrievedPayments ? [...squareRetrievedPayments] : null;
  let defaultPaymentLinkExists = true;
  const stripeStateQueues = Object.fromEntries(
    Object.entries(stripeStatuses).map(([key, value]) => [key, [...value]]),
  );
  return {
    calls,
    square: {
      correlationSecret: CORRELATION_SECRET,
      async deletePaymentLink(id) {
        calls.squareDeletes += 1;
        defaultPaymentLinkExists = false;
        const result = await squareDelete?.(id);
        return result ?? {
          cancelledOrderId: squareCancelledOrderId ?? squareOrderId,
          id: squareDeletedLinkId ?? id,
        };
      },
      async retrieveOrder(orderId) {
        calls.squareOrders.push(orderId);
        const result = squareResults.shift();
        if (result instanceof Error) throw result;
        return typeof result === "string" || result === undefined
          ? { id: orderId, state: result ?? "OPEN", tenders: [] }
          : { id: orderId, ...result };
      },
      async retrievePayment(paymentId) {
        calls.squarePayments.push(paymentId);
        return retrievedPayments ? retrievedPayments.shift() ?? null : null;
      },
      async retrievePaymentLink(paymentLinkId) {
        const result = paymentLinks ? paymentLinks.shift() : defaultPaymentLinkExists
          ? { order_id: squareOrderId }
          : null;
        return result ? { id: paymentLinkId, ...result } : null;
      },
      async searchPaymentsByOrder(input) {
        calls.squarePaymentSearches.push(input);
        const result = paymentResults ? paymentResults.shift() : [];
        if (result instanceof Error) throw result;
        return result ?? [];
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

function exactCompletedPayment(overrides = {}) {
  return {
    amount_money: { amount: 999, currency: "GBP" },
    customer_id: "customer-1",
    id: "payment-1",
    note: createSquareCheckoutCorrelation(CORRELATION_KEY, CORRELATION_SECRET),
    order_id: "order-1",
    status: "COMPLETED",
    ...overrides,
  };
}

function immediateSquareRetirementDouble({
  orderResults = [{ state: "OPEN", tenders: [] }],
  paymentLink = { order_id: "order-1" },
  paymentResults = [[]],
} = {}) {
  const orders = [...orderResults];
  const payments = [...paymentResults];
  const calls = { paymentSearches: [] };
  return {
    calls,
    async retrieveOrder() {
      return orders.shift() ?? null;
    },
    async retrievePaymentLink() {
      return paymentLink;
    },
    async searchPaymentsByOrder(input) {
      calls.paymentSearches.push(input);
      return payments.length ? payments.shift() : [];
    },
  };
}
