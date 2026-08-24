import assert from "node:assert/strict";
import test from "node:test";
import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import {
  squareCustomerHasUnrelatedActiveAgreements,
  squareSubscriptionBlocksCheckout,
  squareSubscriptionNeedsCancellation,
} from "../src/lib/billing/subscription-safety.ts";
import {
  createSquareCheckoutCorrelation,
  parseSquareCheckoutCorrelation,
  squarePaymentMatchesCheckout,
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
  exactSquareInvoiceSubscriptionId,
  providerEventMayAttachNewSubscription,
  squarePlanForProviderEvent,
  stripePlanForProviderEvent,
} from "../src/lib/billing/provider-event-safety.ts";
import { reconcileExactSquareSubscriptionTruth } from "../src/lib/billing/square-account-reconciliation.ts";

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
  assert.equal(exactSquareInvoiceSubscriptionId(undefined), null);
  assert.equal(exactSquareInvoiceSubscriptionId("  "), null);
  assert.equal(exactSquareInvoiceSubscriptionId(" square-sub-1 "), "square-sub-1");
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

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
