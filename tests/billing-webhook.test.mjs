import assert from "node:assert/strict";
import test from "node:test";
import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import {
  squareCustomerHasUnrelatedActiveAgreements,
  squareSubscriptionBlocksCheckout,
  squareSubscriptionNeedsExactCancellationIdForDeletion,
  squareSubscriptionNeedsCancellation,
} from "../src/lib/billing/subscription-safety.ts";
import {
  createSquareCheckoutCorrelation,
  parseSquareCheckoutCorrelation,
  squareCheckoutCorrelationSecret,
  squarePaymentMatchesCheckout,
  squarePaymentOrderMatchesCheckout,
  validateSquareCompletedPaymentCorrelation,
} from "../src/lib/billing/square-checkout-correlation.ts";
import {
  planFromPriceId,
  planFromSquarePlanVariationId,
  squareSubscriptionPeriodEnd,
  statusFromSquare,
  statusFromSquareForLocalAccess,
} from "../src/lib/billing/subscription-mapping.ts";
import {
  createSquareWebhookSignatureHeader,
  createStripeWebhookSignatureHeader,
  verifySquareWebhookPayload,
  verifyStripeWebhookPayload,
} from "../src/lib/billing/webhook-signature.ts";
import { billingWebhookProviderFromHeaders } from "../src/lib/billing/webhook-provider.ts";
import {
  exactSquareInvoiceOrderId,
  exactSquareInvoiceSubscriptionId,
  providerEventMayAttachNewSubscription,
  squareSubscriptionAttachmentDecision,
  squarePlanForProviderEvent,
  stripePlanForProviderEvent,
} from "../src/lib/billing/provider-event-safety.ts";
import { reconcileExactSquareSubscriptionTruth } from "../src/lib/billing/square-account-reconciliation.ts";
import { reconcileSquareCheckoutPaymentTransaction } from "../src/lib/billing/square-payment-transaction.ts";
import { BillingCustomerOwnershipError } from "../src/lib/billing/customer-ownership.ts";

const secret = "whsec_test_secret";
const squareSignatureKey = "square_signature_key";
const squareNotificationUrl = "https://mintbinder.example/api/billing/webhook/square";
const timestamp = 1_800_000_000;
const now = new Date(timestamp * 1000);
const payload = JSON.stringify({
  data: {
    object: {
      id: "cs_test",
    },
  },
  id: "evt_test",
  type: "checkout.session.completed",
});
const squarePayload = JSON.stringify({
  data: {
    id: "sub_test",
    object: {
      subscription: {
        customer_id: "customer_test",
        id: "sub_test",
        plan_variation_id: "square_monthly",
        status: "ACTIVE",
      },
    },
    type: "subscription",
  },
  event_id: "square_evt_test",
  merchant_id: "merchant_test",
  type: "subscription.updated",
});

test("accepts a Stripe webhook with a valid signature", () => {
  const signatureHeader = createStripeWebhookSignatureHeader({ payload, secret, timestamp });
  const event = verifyStripeWebhookPayload({ now, payload, secret, signatureHeader });

  assert.equal(event.id, "evt_test");
  assert.equal(event.type, "checkout.session.completed");
});

test("webhook dispatch remains independent of the active checkout provider", () => {
  const headers = (values) => ({ get: (name) => values[name.toLowerCase()] ?? null });

  assert.equal(billingWebhookProviderFromHeaders(headers({ "stripe-signature": "stripe" })), "stripe");
  assert.equal(
    billingWebhookProviderFromHeaders(headers({ "x-square-hmacsha256-signature": "square" })),
    "square",
  );
  assert.equal(billingWebhookProviderFromHeaders(headers({})), null);
  assert.equal(billingWebhookProviderFromHeaders(headers({
    "stripe-signature": "stripe",
    "x-square-hmacsha256-signature": "square",
  })), null);
});

test("rejects a tampered Stripe webhook payload", () => {
  const signatureHeader = createStripeWebhookSignatureHeader({ payload, secret, timestamp });

  assert.throws(
    () =>
      verifyStripeWebhookPayload({
        now,
        payload: payload.replace("evt_test", "evt_tampered"),
        secret,
        signatureHeader,
      }),
    /No matching Stripe webhook signature/,
  );
});

test("rejects stale Stripe webhook timestamps", () => {
  const signatureHeader = createStripeWebhookSignatureHeader({ payload, secret, timestamp });
  const staleNow = new Date((timestamp + 301) * 1000);

  assert.throws(
    () => verifyStripeWebhookPayload({ now: staleNow, payload, secret, signatureHeader }),
    /outside tolerance/,
  );
});

test("accepts a Square webhook with a valid signature", () => {
  const signatureHeader = createSquareWebhookSignatureHeader({
    notificationUrl: squareNotificationUrl,
    payload: squarePayload,
    signatureKey: squareSignatureKey,
  });
  const event = verifySquareWebhookPayload({
    notificationUrl: squareNotificationUrl,
    payload: squarePayload,
    signatureHeader,
    signatureKey: squareSignatureKey,
  });

  assert.equal(event.type, "subscription.updated");
});

test("rejects a tampered Square webhook payload", () => {
  const signatureHeader = createSquareWebhookSignatureHeader({
    notificationUrl: squareNotificationUrl,
    payload: squarePayload,
    signatureKey: squareSignatureKey,
  });

  assert.throws(
    () =>
      verifySquareWebhookPayload({
        notificationUrl: squareNotificationUrl,
        payload: squarePayload.replace("square_evt_test", "square_evt_tampered"),
        signatureHeader,
        signatureKey: squareSignatureKey,
      }),
    /No matching Square webhook signature/,
  );
});

test("maps Square plans and statuses to local subscriptions", () => {
  const previousMonthly = process.env.SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID;
  const previousYearly = process.env.SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID;

  process.env.SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID = "square_monthly";
  process.env.SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID = "square_yearly";

  try {
    assert.equal(planFromSquarePlanVariationId("square_monthly"), SubscriptionPlan.PLUS_MONTHLY);
    assert.equal(planFromSquarePlanVariationId("square_yearly"), SubscriptionPlan.PLUS_YEARLY);
    assert.equal(planFromSquarePlanVariationId("unknown"), null);
    assert.equal(statusFromSquare("ACTIVE"), SubscriptionStatus.ACTIVE);
    assert.equal(statusFromSquare("PAUSED"), SubscriptionStatus.PAST_DUE);
    assert.equal(statusFromSquare("CANCELED"), SubscriptionStatus.CANCELED);
    assert.equal(statusFromSquare("COMPLETED"), SubscriptionStatus.CANCELED);
    assert.equal(statusFromSquare(undefined), SubscriptionStatus.INCOMPLETE);
  } finally {
    restoreEnv("SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID", previousMonthly);
    restoreEnv("SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID", previousYearly);
  }
});

test("preserves Square Plus access locally during a cancelled paid period", () => {
  const anchor = new Date("2026-06-04T12:00:00.000Z");
  const periodEnd = squareSubscriptionPeriodEnd({
    anchor,
    estimateWhenMissing: true,
    plan: SubscriptionPlan.PLUS_MONTHLY,
  });

  assert.equal(periodEnd?.toISOString(), "2026-07-04T12:00:00.000Z");
  assert.equal(
    statusFromSquareForLocalAccess({
      cancelAtPeriodEnd: true,
      currentPeriodEnd: periodEnd,
      now: anchor,
      plan: SubscriptionPlan.PLUS_MONTHLY,
      status: "CANCELED",
    }),
    SubscriptionStatus.ACTIVE,
  );
  assert.equal(
    statusFromSquareForLocalAccess({
      cancelAtPeriodEnd: false,
      now: anchor,
      plan: SubscriptionPlan.PLUS_MONTHLY,
      status: "CANCELED",
    }),
    SubscriptionStatus.CANCELED,
  );
});

test("distinguishes scheduled Square cancellation from a terminal subscription", () => {
  const scheduled = { canceled_date: "2026-09-01", status: "ACTIVE" };

  assert.equal(squareSubscriptionNeedsCancellation(scheduled), false);
  assert.equal(squareSubscriptionBlocksCheckout(scheduled), true);
  assert.equal(squareSubscriptionBlocksCheckout({ status: "CANCELED" }), false);
  assert.equal(squareSubscriptionBlocksCheckout({ status: "COMPLETED" }), false);
  assert.equal(squareSubscriptionNeedsCancellation({ status: "COMPLETED" }), false);
});

test("preserves an app-created Square profile when provider truth contains an unrelated active agreement", () => {
  const mintBinderSubscriptions = new Set(["mint-subscription"]);

  assert.equal(squareCustomerHasUnrelatedActiveAgreements([
    { id: "mint-subscription", status: "ACTIVE" },
    { id: "unrelated-subscription", status: "ACTIVE" },
  ], mintBinderSubscriptions), true);
  assert.equal(squareCustomerHasUnrelatedActiveAgreements([
    { id: "mint-subscription", status: "ACTIVE" },
    { id: "unrelated-terminal", status: "COMPLETED" },
  ], mintBinderSubscriptions), false);
});

test("preserves an app-created Square profile for an unrelated ACTIVE agreement scheduled to cancel", () => {
  assert.equal(squareCustomerHasUnrelatedActiveAgreements([
    {
      canceled_date: "2026-10-07",
      id: "unrelated-scheduled-subscription",
      status: "ACTIVE",
    },
  ], new Set(["mintbinder-subscription"])), true);

  assert.equal(squareCustomerHasUnrelatedActiveAgreements([
    {
      canceled_date: "2026-10-07",
      id: "unrelated-terminal-subscription",
      status: "CANCELED",
    },
  ], new Set(["mintbinder-subscription"])), false);
});

test("uses a signed opaque Square payment correlation and validates the paid plan", () => {
  const key = "11111111-1111-4111-8111-111111111111";
  const correlationSecret = "a-secret-long-enough-for-correlation-tests";
  const note = createSquareCheckoutCorrelation(key, correlationSecret);

  assert.equal(note.includes("user"), false);
  assert.equal(parseSquareCheckoutCorrelation(note, correlationSecret), key);
  assert.throws(
    () => parseSquareCheckoutCorrelation(`${note.slice(0, -1)}x`, correlationSecret),
    /signature is invalid/,
  );
  assert.equal(squarePaymentMatchesCheckout({
    amountMinor: 249,
    currency: "GBP",
    expectedAmountMinor: 249,
    expectedCurrency: "GBP",
  }), true);
  assert.equal(squarePaymentMatchesCheckout({
    amountMinor: 1999,
    currency: "GBP",
    expectedAmountMinor: 249,
    expectedCurrency: "GBP",
  }), false);
});

test("webhook and retirement payment evidence share the complete immutable correlation validator", () => {
  const correlationSecret = "a-secret-long-enough-for-correlation-tests";
  const intent = {
    expectedAmountMinor: 249,
    expectedCurrency: "GBP",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    plan: "PLUS_MONTHLY",
    provider: "square",
    providerCustomerId: "customer-1",
    providerOrderId: "order-1",
    providerPlanVariationId: "variation-1",
  };
  const payment = {
    amount_money: { amount: 249, currency: "GBP" },
    customer_id: "customer-1",
    id: "payment-1",
    note: createSquareCheckoutCorrelation(intent.idempotencyKey, correlationSecret),
    order_id: "order-1",
    status: "COMPLETED",
  };

  assert.deepEqual(validateSquareCompletedPaymentCorrelation({
    expectedPaymentId: "payment-1",
    intent,
    payment,
    secret: correlationSecret,
  }), { ok: true, customerId: "customer-1", paymentId: "payment-1" });

  assert.deepEqual(validateSquareCompletedPaymentCorrelation({
    expectedPaymentId: "payment-1",
    intent,
    payment: { ...payment, customer_id: "customer-hosted-buyer" },
    secret: correlationSecret,
  }), { ok: true, customerId: "customer-hosted-buyer", paymentId: "payment-1" });

  for (const invalid of [
    { ...payment, id: "payment-other" },
    { ...payment, note: "unsigned" },
    { ...payment, customer_id: "" },
    { ...payment, customer_id: " customer-hosted-buyer " },
    { ...payment, order_id: "order-other" },
    { ...payment, amount_money: { amount: 250, currency: "GBP" } },
  ]) {
    assert.equal(validateSquareCompletedPaymentCorrelation({
      expectedPaymentId: "payment-1",
      intent,
      payment: invalid,
      secret: correlationSecret,
    }).ok, false);
  }
});

test("requires an exact non-empty Square payment order ID match", () => {
  assert.equal(squarePaymentOrderMatchesCheckout({
    orderId: "square-order-1",
    expectedOrderId: "square-order-1",
  }), true);
  assert.equal(squarePaymentOrderMatchesCheckout({
    orderId: "square-order-2",
    expectedOrderId: "square-order-1",
  }), false);
  assert.equal(squarePaymentOrderMatchesCheckout({
    orderId: " square-order-1 ",
    expectedOrderId: "square-order-1",
  }), false);
  assert.equal(squarePaymentOrderMatchesCheckout({
    orderId: "",
    expectedOrderId: "",
  }), false);
  assert.equal(squarePaymentOrderMatchesCheckout({
    orderId: null,
    expectedOrderId: "square-order-1",
  }), false);
  assert.equal(squarePaymentOrderMatchesCheckout({
    orderId: "square-order-1",
    expectedOrderId: null,
  }), false);
});

test("prefers the dedicated Square correlation secret and verifies legacy AUTH_SECRET notes", () => {
  const key = "22222222-2222-4222-8222-222222222222";
  const dedicatedSecret = "dedicated-square-correlation-secret-123456";
  const legacyAuthSecret = "legacy-auth-secret-for-correlation-123456";
  const previousDedicated = process.env.SQUARE_CHECKOUT_CORRELATION_SECRET;
  const previousAuth = process.env.AUTH_SECRET;
  process.env.SQUARE_CHECKOUT_CORRELATION_SECRET = dedicatedSecret;
  process.env.AUTH_SECRET = legacyAuthSecret;
  const previousVerified = process.env.SQUARE_PAYMENT_CORRELATION_VERIFIED;
  process.env.SQUARE_PAYMENT_CORRELATION_VERIFIED = "false";

  try {
    assert.equal(squareCheckoutCorrelationSecret(), dedicatedSecret);

    const currentNote = createSquareCheckoutCorrelation(key);
    assert.equal(parseSquareCheckoutCorrelation(currentNote, dedicatedSecret), key);
    assert.throws(
      () => parseSquareCheckoutCorrelation(currentNote, legacyAuthSecret),
      /signature is invalid/,
    );

    const legacyNote = createSquareCheckoutCorrelation(key, legacyAuthSecret);
    assert.equal(parseSquareCheckoutCorrelation(legacyNote), key);

    process.env.SQUARE_PAYMENT_CORRELATION_VERIFIED = "true";
    assert.throws(
      () => parseSquareCheckoutCorrelation(legacyNote),
      /signature is invalid/,
    );
  } finally {
    restoreEnv("SQUARE_CHECKOUT_CORRELATION_SECRET", previousDedicated);
    restoreEnv("AUTH_SECRET", previousAuth);
    restoreEnv("SQUARE_PAYMENT_CORRELATION_VERIFIED", previousVerified);
  }
});

test("falls back safely to a strong AUTH_SECRET and rejects a configured weak dedicated secret", () => {
  const strongAuthSecret = "strong-auth-secret-for-correlation-123456";

  assert.equal(squareCheckoutCorrelationSecret({
    AUTH_SECRET: strongAuthSecret,
  }), strongAuthSecret);
  assert.throws(
    () => squareCheckoutCorrelationSecret({
      AUTH_SECRET: strongAuthSecret,
      SQUARE_CHECKOUT_CORRELATION_SECRET: "too-short",
    }),
    /SQUARE_CHECKOUT_CORRELATION_SECRET must be at least 32 characters/,
  );
  assert.throws(
    () => squareCheckoutCorrelationSecret({ AUTH_SECRET: "too-short" }),
    /AUTH_SECRET fallback.*at least 32 characters/,
  );
  assert.throws(
    () => squareCheckoutCorrelationSecret({
      AUTH_SECRET: strongAuthSecret,
      SQUARE_PAYMENT_CORRELATION_VERIFIED: "true",
    }),
    /SQUARE_CHECKOUT_CORRELATION_SECRET is required once.*verified/,
  );
  assert.throws(
    () => squareCheckoutCorrelationSecret({
      AUTH_SECRET: strongAuthSecret,
      SQUARE_CHECKOUT_CORRELATION_SECRET: strongAuthSecret,
      SQUARE_PAYMENT_CORRELATION_VERIFIED: "true",
    }),
    /must be independent once.*verified/,
  );
});

test("AUTH_SECRET fallback produces a deterministic correlation during the migration window", () => {
  const key = "33333333-3333-4333-8333-333333333333";
  const previousDedicated = process.env.SQUARE_CHECKOUT_CORRELATION_SECRET;
  const previousAuth = process.env.AUTH_SECRET;
  const previousVerified = process.env.SQUARE_PAYMENT_CORRELATION_VERIFIED;
  delete process.env.SQUARE_CHECKOUT_CORRELATION_SECRET;
  process.env.AUTH_SECRET = "stable-auth-secret-for-square-migration-123456";
  process.env.SQUARE_PAYMENT_CORRELATION_VERIFIED = "false";

  try {
    const first = createSquareCheckoutCorrelation(key);
    const retry = createSquareCheckoutCorrelation(key);

    assert.equal(retry, first);
    assert.equal(parseSquareCheckoutCorrelation(retry), key);
  } finally {
    restoreEnv("SQUARE_CHECKOUT_CORRELATION_SECRET", previousDedicated);
    restoreEnv("AUTH_SECRET", previousAuth);
    restoreEnv("SQUARE_PAYMENT_CORRELATION_VERIFIED", previousVerified);
  }
});

test("Square payment transaction rejects checkout changes made before the row lock is read", async (t) => {
  const initialIntent = squareCheckoutIntent();
  const cases = [
    {
      name: "order",
      lockedIntent: { ...initialIntent, providerOrderId: "order-raced" },
      message: /order ID changed/,
    },
    {
      name: "amount",
      lockedIntent: { ...initialIntent, expectedAmountMinor: 999 },
      message: /amount or currency changed/,
    },
    {
      name: "currency",
      lockedIntent: { ...initialIntent, expectedCurrency: "USD" },
      message: /amount or currency changed/,
    },
    {
      name: "plan",
      lockedIntent: { ...initialIntent, plan: SubscriptionPlan.PLUS_YEARLY },
      message: /plan changed/,
    },
    {
      name: "customer",
      lockedIntent: { ...initialIntent, providerCustomerId: "customer-raced" },
      message: /prepared customer changed/,
    },
    {
      name: "plan variation",
      lockedIntent: { ...initialIntent, providerPlanVariationId: "variation-raced" },
      message: /plan changed/,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const fixture = squarePaymentTransaction(scenario.lockedIntent);
      await assert.rejects(
        reconcileSquareCheckoutPaymentTransaction({
          claimCustomerOwnership: fixture.claimCustomerOwnership,
          customerId: "customer-1",
          idempotencyKey: initialIntent.idempotencyKey,
          initialIntent,
          now: new Date("2026-09-07T12:00:00.000Z"),
          payment: squarePayment(),
          paymentId: "payment-1",
          transaction: fixture.transaction,
        }),
        scenario.message,
      );

      assert.deepEqual(
        fixture.operations.slice(0, 3),
        ["advisory-lock", "row-lock", "read-locked-intent"],
      );
      assert.equal(fixture.operations.includes("claim-customer"), false);
      assert.equal(fixture.operations.some((operation) => operation.startsWith("write-")), false);
    });
  }
});

test("Square payment transaction treats only the same locked payment as an idempotent duplicate", async () => {
  const initialIntent = squareCheckoutIntent();
  const samePayment = squarePaymentTransaction({
    ...initialIntent,
    providerPaymentId: "payment-1",
    status: "completed",
  });

  const result = await reconcileSquareCheckoutPaymentTransaction({
    claimCustomerOwnership: samePayment.claimCustomerOwnership,
    customerId: "customer-1",
    idempotencyKey: initialIntent.idempotencyKey,
    initialIntent,
    payment: squarePayment(),
    paymentId: "payment-1",
    transaction: samePayment.transaction,
  });

  assert.deepEqual(result, {
    activated: false,
    intentId: initialIntent.id,
    userId: initialIntent.userId,
  });
  assert.deepEqual(
    samePayment.operations,
    ["advisory-lock", "row-lock", "read-locked-intent"],
  );

  const differentPayment = squarePaymentTransaction({
    ...initialIntent,
    providerPaymentId: "payment-already-recorded",
    status: "completed",
  });
  await assert.rejects(
    reconcileSquareCheckoutPaymentTransaction({
      claimCustomerOwnership: differentPayment.claimCustomerOwnership,
      customerId: "customer-1",
      idempotencyKey: initialIntent.idempotencyKey,
      initialIntent,
      payment: squarePayment(),
      paymentId: "payment-1",
      transaction: differentPayment.transaction,
    }),
    /already completed by a different payment/,
  );
  assert.deepEqual(
    differentPayment.operations,
    ["advisory-lock", "row-lock", "read-locked-intent"],
  );
});

test("Square payment transaction writes one entitlement from the locked intent", async () => {
  const initialIntent = squareCheckoutIntent();
  const fixture = squarePaymentTransaction(initialIntent);
  const now = new Date("2026-09-07T12:00:00.000Z");

  const result = await reconcileSquareCheckoutPaymentTransaction({
    claimCustomerOwnership: fixture.claimCustomerOwnership,
    customerId: "customer-1",
    idempotencyKey: initialIntent.idempotencyKey,
    initialIntent,
    now,
    payment: squarePayment(),
    paymentId: "payment-1",
    transaction: fixture.transaction,
  });

  assert.equal(result.activated, true);
  assert.deepEqual(fixture.operations, [
    "advisory-lock",
    "row-lock",
    "read-locked-intent",
    "claim-customer",
    "read-subscriptions",
    "advisory-lock",
    "check-external-agreements",
    "write-subscription-create",
    "write-intent",
  ]);
  assert.equal(fixture.subscriptionCreate.data.plan, SubscriptionPlan.PLUS_MONTHLY);
  assert.equal(fixture.intentUpdate.data.providerPaymentId, "payment-1");
  assert.equal(fixture.intentUpdate.data.status, "paid_pending_subscription");
});

test("Square payment claims and activates the exact hosted buyer without changing the prepared customer snapshot", async () => {
  const initialIntent = squareCheckoutIntent({ providerCustomerId: "customer-prepared" });
  const fixture = squarePaymentTransaction(initialIntent);

  const result = await reconcileSquareCheckoutPaymentTransaction({
    claimCustomerOwnership: fixture.claimCustomerOwnership,
    customerId: "customer-hosted-buyer",
    idempotencyKey: initialIntent.idempotencyKey,
    initialIntent,
    now: new Date("2026-09-07T12:00:00.000Z"),
    payment: squarePayment(),
    paymentId: "payment-hosted-buyer",
    transaction: fixture.transaction,
  });

  assert.equal(result.activated, true);
  assert.deepEqual(fixture.claimedCustomer, {
    customerId: "customer-hosted-buyer",
    userId: initialIntent.userId,
  });
  assert.equal(fixture.squareCandidateWhere.providerCustomerId, "customer-hosted-buyer");
  assert.equal(fixture.subscriptionCreate.data.providerCustomerId, "customer-hosted-buyer");
  assert.equal(Object.hasOwn(fixture.intentUpdate.data, "providerCustomerId"), false);
  assert.equal(initialIntent.providerCustomerId, "customer-prepared");
});

test("Square payment cannot activate when the hosted buyer customer belongs to another user", async () => {
  const initialIntent = squareCheckoutIntent({ providerCustomerId: "customer-prepared" });
  const fixture = squarePaymentTransaction(initialIntent, {
    ownershipError: new BillingCustomerOwnershipError(),
  });

  await assert.rejects(
    reconcileSquareCheckoutPaymentTransaction({
      claimCustomerOwnership: fixture.claimCustomerOwnership,
      customerId: "customer-owned-by-other-user",
      idempotencyKey: initialIntent.idempotencyKey,
      initialIntent,
      now: new Date("2026-09-07T12:00:00.000Z"),
      payment: squarePayment(),
      paymentId: "payment-owned-by-other-user",
      transaction: fixture.transaction,
    }),
    BillingCustomerOwnershipError,
  );

  assert.deepEqual(fixture.claimedCustomer, {
    customerId: "customer-owned-by-other-user",
    userId: initialIntent.userId,
  });
  assert.deepEqual(fixture.operations, [
    "advisory-lock",
    "row-lock",
    "read-locked-intent",
    "claim-customer",
  ]);
  assert.equal(fixture.subscriptionCreate, null);
  assert.equal(fixture.intentUpdate, null);
});

test("Square payment fails closed when a Stripe paid agreement won first", async () => {
  const initialIntent = squareCheckoutIntent({ providerCustomerId: "customer-square-loser" });
  const fixture = squarePaymentTransaction(initialIntent, {
    externalSubscriptions: [{
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date("2026-10-07T12:00:00.000Z"),
      plan: SubscriptionPlan.PLUS_MONTHLY,
      provider: "stripe",
      providerSubscriptionId: "sub-stripe-winner",
      status: SubscriptionStatus.ACTIVE,
    }],
  });

  await assert.rejects(
    reconcileSquareCheckoutPaymentTransaction({
      claimCustomerOwnership: fixture.claimCustomerOwnership,
      customerId: "customer-square-loser",
      idempotencyKey: initialIntent.idempotencyKey,
      initialIntent,
      now: new Date("2026-09-07T12:00:00.000Z"),
      payment: squarePayment(),
      paymentId: "payment-square-loser",
      transaction: fixture.transaction,
    }),
    /second square paid agreement.*existing stripe.*did not change Plus access.*refund.*manually/i,
  );
  assert.equal(fixture.operations.some((operation) => operation.startsWith("write-")), false);
});

test("a returning Square customer payment never reuses an older same-plan subscription ID", async () => {
  const initialIntent = squareCheckoutIntent();
  const oldSubscription = {
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date("2026-08-07T12:00:00.000Z"),
    id: "subscription-old",
    plan: SubscriptionPlan.PLUS_MONTHLY,
    provider: "square",
    providerCustomerId: "customer-1",
    providerSubscriptionId: "square-subscription-old",
    status: SubscriptionStatus.CANCELED,
    updatedAt: new Date("2026-08-07T12:00:00.000Z"),
  };
  const fixture = squarePaymentTransaction(initialIntent, {
    externalSubscriptions: [oldSubscription],
    squareCandidates: [oldSubscription],
  });

  const result = await reconcileSquareCheckoutPaymentTransaction({
    claimCustomerOwnership: fixture.claimCustomerOwnership,
    customerId: "customer-1",
    idempotencyKey: initialIntent.idempotencyKey,
    initialIntent,
    now: new Date("2026-09-07T12:00:00.000Z"),
    payment: squarePayment(),
    paymentId: "payment-new",
    transaction: fixture.transaction,
  });

  assert.equal(result.activated, true);
  assert.deepEqual(fixture.detachedSubscriptionIds, ["subscription-old"]);
  assert.equal(fixture.subscriptionCreate.data.providerSubscriptionId, undefined);
  assert.equal(fixture.subscriptionCreate.data.providerCustomerId, "customer-1");
  assert.equal(fixture.intentUpdate.data.providerPaymentId, "payment-new");
  assert.equal(fixture.intentUpdate.data.status, "paid_pending_subscription");
  assert.equal(
    fixture.operations.includes("write-subscription-update"),
    false,
  );
});

test("validates a completed Square payment against its purchase-time snapshot after config changes", () => {
  const previousAmount = process.env.SQUARE_PLUS_MONTHLY_AMOUNT_MINOR;
  const previousCurrency = process.env.SQUARE_CURRENCY;
  process.env.SQUARE_PLUS_MONTHLY_AMOUNT_MINOR = "399";
  process.env.SQUARE_CURRENCY = "USD";

  try {
    assert.equal(squarePaymentMatchesCheckout({
      amountMinor: 249,
      currency: "GBP",
      expectedAmountMinor: 249,
      expectedCurrency: "GBP",
    }), true);
    assert.equal(squarePaymentMatchesCheckout({
      amountMinor: 399,
      currency: "USD",
      expectedAmountMinor: 249,
      expectedCurrency: "GBP",
    }), false);
  } finally {
    restoreEnv("SQUARE_PLUS_MONTHLY_AMOUNT_MINOR", previousAmount);
    restoreEnv("SQUARE_CURRENCY", previousCurrency);
  }
});

test("provider plan mapping fails closed until an event matches immutable checkout data", () => {
  const previousSquareMonthly = process.env.SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID;
  const previousSquareYearly = process.env.SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID;
  const previousStripeMonthly = process.env.STRIPE_PLUS_MONTHLY_PRICE_ID;
  const previousStripeYearly = process.env.STRIPE_PLUS_YEARLY_PRICE_ID;
  process.env.SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID = "square-current-monthly";
  process.env.SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID = "square-current-yearly";
  process.env.STRIPE_PLUS_MONTHLY_PRICE_ID = "stripe-current-monthly";
  process.env.STRIPE_PLUS_YEARLY_PRICE_ID = "stripe-current-yearly";
  const intent = {
    id: "intent-1",
    plan: SubscriptionPlan.PLUS_MONTHLY,
    providerPlanVariationId: "square-purchase-time-monthly",
    status: "paid_pending_subscription",
  };

  try {
    assert.equal(squarePlanForProviderEvent("unrelated-variation", null), null);
    assert.equal(providerEventMayAttachNewSubscription({
      existingProviderSubscriptionId: null,
      matchingIntent: null,
      subscriptionId: "unrelated-subscription",
    }), false);
    assert.equal(
      squarePlanForProviderEvent("square-purchase-time-monthly", intent),
      SubscriptionPlan.PLUS_MONTHLY,
    );
    assert.equal(providerEventMayAttachNewSubscription({
      existingProviderSubscriptionId: null,
      matchingIntent: intent,
      subscriptionId: "correct-subscription",
    }), true);
    assert.equal(stripePlanForProviderEvent("unknown-stripe-price", null), null);
    assert.equal(planFromPriceId("unknown-stripe-price"), null);
  } finally {
    restoreEnv("SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID", previousSquareMonthly);
    restoreEnv("SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID", previousSquareYearly);
    restoreEnv("STRIPE_PLUS_MONTHLY_PRICE_ID", previousStripeMonthly);
    restoreEnv("STRIPE_PLUS_YEARLY_PRICE_ID", previousStripeYearly);
  }
});

test("Square invoices without an exact subscription ID cannot activate customer-only rows", () => {
  assert.equal(exactSquareInvoiceOrderId(undefined), null);
  assert.equal(exactSquareInvoiceOrderId("  "), null);
  assert.equal(exactSquareInvoiceOrderId(" order-1 "), "order-1");
  assert.equal(exactSquareInvoiceSubscriptionId(undefined), null);
  assert.equal(exactSquareInvoiceSubscriptionId("  "), null);
  assert.equal(exactSquareInvoiceSubscriptionId(" square-sub-1 "), "square-sub-1");
});

test("Square subscription attachment requires the exact paid checkout invoice", () => {
  const readyIntent = {
    id: "intent-new",
    plan: SubscriptionPlan.PLUS_MONTHLY,
    providerOrderId: "order-new",
    providerPaymentId: null,
    providerPlanVariationId: "variation-new",
    status: "ready",
  };
  const paidIntent = {
    ...readyIntent,
    providerPaymentId: "payment-new",
    status: "paid_pending_subscription",
  };

  // payment -> subscription.created: the customer-only event is not enough,
  // even if an older same-plan subscription exists for this customer.
  assert.equal(squareSubscriptionAttachmentDecision({
    existingProviderSubscriptionId: null,
    matchingIntent: null,
    planVariationId: "variation-new",
    subscriptionId: "subscription-new",
  }), "ignore_unproven");

  // invoice -> payment: the invoice must be retried until payment correlation
  // moves the exact intent to paid_pending_subscription.
  assert.equal(squareSubscriptionAttachmentDecision({
    existingProviderSubscriptionId: null,
    invoiceOrderId: "order-new",
    invoiceSubscriptionId: "subscription-new",
    matchingIntent: readyIntent,
    planVariationId: "variation-new",
    subscriptionId: "subscription-new",
  }), "retry_invoice");
  assert.equal(squareSubscriptionAttachmentDecision({
    existingProviderSubscriptionId: null,
    invoiceOrderId: "order-new",
    invoiceSubscriptionId: "subscription-new",
    matchingIntent: { ...paidIntent, providerPaymentId: null },
    planVariationId: "variation-new",
    subscriptionId: "subscription-new",
  }), "retry_invoice");

  // payment -> invoice (or the invoice retry) attaches only the subscription
  // named by the invoice to the exact checkout order.
  assert.equal(squareSubscriptionAttachmentDecision({
    existingProviderSubscriptionId: null,
    invoiceOrderId: "order-new",
    invoiceSubscriptionId: "subscription-new",
    matchingIntent: paidIntent,
    planVariationId: "variation-new",
    subscriptionId: "subscription-new",
  }), "attach_invoice");
  assert.equal(squareSubscriptionAttachmentDecision({
    existingProviderSubscriptionId: null,
    invoiceOrderId: "order-old",
    invoiceSubscriptionId: "subscription-new",
    matchingIntent: paidIntent,
    planVariationId: "variation-new",
    subscriptionId: "subscription-new",
  }), "retry_invoice");
  assert.equal(squareSubscriptionAttachmentDecision({
    existingProviderSubscriptionId: "subscription-old",
    invoiceOrderId: "order-new",
    invoiceSubscriptionId: "subscription-new",
    matchingIntent: paidIntent,
    planVariationId: "variation-new",
    subscriptionId: "subscription-new",
  }), "retry_invoice");

  // After attachment, ordinary subscription lifecycle events may update only
  // that exact provider ID. An invoice retry can close an intent left pending
  // by a crash between exact attachment and intent completion.
  assert.equal(squareSubscriptionAttachmentDecision({
    existingProviderSubscriptionId: "subscription-new",
    invoiceOrderId: "order-new",
    invoiceSubscriptionId: "subscription-new",
    matchingIntent: paidIntent,
    planVariationId: "variation-new",
    subscriptionId: "subscription-new",
  }), "update_exact_invoice");
  assert.equal(squareSubscriptionAttachmentDecision({
    existingProviderSubscriptionId: "subscription-new",
    matchingIntent: null,
    planVariationId: "variation-new",
    subscriptionId: "subscription-new",
  }), "update_exact");
});

test("account deletion checks and cancels every exact Square ID despite stale local terminal state", async () => {
  const calls = [];
  const result = await reconcileExactSquareSubscriptionTruth({
    subscriptions: [{
      id: "local-canceled-row",
      providerSubscriptionId: "remote-still-active",
      provenance: "provider_matched",
      status: SubscriptionStatus.CANCELED,
    }],
    retrieve: async (subscriptionId) => {
      calls.push(["retrieve", subscriptionId]);
      return { id: subscriptionId, status: "ACTIVE" };
    },
    cancel: async (subscriptionId) => {
      calls.push(["cancel", subscriptionId]);
      return { canceled_date: "2026-08-24", id: subscriptionId, status: "CANCELED" };
    },
    persist: async (localId, remote, cancellationRequested) => {
      calls.push(["persist", localId, remote.id, cancellationRequested]);
    },
  });

  assert.deepEqual(result, { cancelled: 1, checked: 1 });
  assert.deepEqual(calls, [
    ["retrieve", "remote-still-active"],
    ["cancel", "remote-still-active"],
    ["persist", "local-canceled-row", "remote-still-active", true],
  ]);
});

test("account deletion requires an exact Square subscription ID even when the customer is known", () => {
  assert.equal(squareSubscriptionNeedsExactCancellationIdForDeletion({
    providerCustomerId: "customer-known",
    providerSubscriptionId: null,
    status: SubscriptionStatus.ACTIVE,
  }), true);
  assert.equal(squareSubscriptionNeedsExactCancellationIdForDeletion({
    cancelAtPeriodEnd: true,
    providerCustomerId: "customer-known",
    providerSubscriptionId: "  ",
    status: SubscriptionStatus.PAST_DUE,
  }), true);
  assert.equal(squareSubscriptionNeedsExactCancellationIdForDeletion({
    providerCustomerId: null,
    providerSubscriptionId: "subscription-exact",
    status: SubscriptionStatus.ACTIVE,
  }), false);
  assert.equal(squareSubscriptionNeedsExactCancellationIdForDeletion({
    providerCustomerId: "customer-known",
    providerSubscriptionId: null,
    status: SubscriptionStatus.CANCELED,
  }), false);
});

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function squareCheckoutIntent(overrides = {}) {
  return {
    expectedAmountMinor: 249,
    expectedCurrency: "GBP",
    id: "44444444-4444-4444-8444-444444444444",
    idempotencyKey: "55555555-5555-4555-8555-555555555555",
    plan: SubscriptionPlan.PLUS_MONTHLY,
    provider: "square",
    providerCustomerId: "customer-1",
    providerOrderId: "order-1",
    providerPaymentId: null,
    providerPlanVariationId: "variation-1",
    status: "ready",
    userId: "66666666-6666-4666-8666-666666666666",
    ...overrides,
  };
}

function squarePayment(overrides = {}) {
  return {
    amount_money: { amount: 249, currency: "GBP" },
    order_id: "order-1",
    ...overrides,
  };
}

function squarePaymentTransaction(
  lockedIntent,
  { externalSubscriptions = [], ownershipError = null, squareCandidates = [] } = {},
) {
  const fixture = {
    claimedCustomer: null,
    detachedSubscriptionIds: [],
    intentUpdate: null,
    operations: [],
    squareCandidateWhere: null,
    subscriptionCreate: null,
  };
  fixture.claimCustomerOwnership = async (claim) => {
    fixture.operations.push("claim-customer");
    fixture.claimedCustomer = claim;
    if (ownershipError) throw ownershipError;
  };
  fixture.transaction = {
    async $executeRaw() {
      fixture.operations.push("advisory-lock");
      return 1;
    },
    async $queryRaw() {
      fixture.operations.push("row-lock");
      return [{ id: lockedIntent.id }];
    },
    billingCheckoutIntent: {
      async findUnique() {
        fixture.operations.push("read-locked-intent");
        return lockedIntent;
      },
      async update({ data }) {
        fixture.operations.push("write-intent");
        fixture.intentUpdate = { data };
        return lockedIntent;
      },
    },
    subscription: {
      async create({ data }) {
        fixture.operations.push("write-subscription-create");
        fixture.subscriptionCreate = { data };
        return { id: "subscription-1", ...data };
      },
      async findMany({ where }) {
        if (where?.provider === "square") {
          fixture.operations.push("read-subscriptions");
          fixture.squareCandidateWhere = where;
          return squareCandidates;
        }
        fixture.operations.push("check-external-agreements");
        return externalSubscriptions;
      },
      async update() {
        fixture.operations.push("write-subscription-update");
        throw new Error("Unexpected subscription update.");
      },
      async updateMany({ where }) {
        fixture.operations.push("write-subscription-update-many");
        fixture.detachedSubscriptionIds.push(...(where.id?.in ?? []));
        return { count: where.id?.in?.length ?? 0 };
      },
    },
  };
  return fixture;
}
