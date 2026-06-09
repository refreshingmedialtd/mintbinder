import assert from "node:assert/strict";
import test from "node:test";
import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import {
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

const secret = "whsec_test_secret";
const squareSignatureKey = "square_signature_key";
const squareNotificationUrl = "https://mintbinder.example/api/billing/webhook";
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
    assert.equal(
      planFromSquarePlanVariationId("unknown", SubscriptionPlan.PLUS_YEARLY),
      SubscriptionPlan.PLUS_YEARLY,
    );
    assert.equal(statusFromSquare("ACTIVE"), SubscriptionStatus.ACTIVE);
    assert.equal(statusFromSquare("PAUSED"), SubscriptionStatus.PAST_DUE);
    assert.equal(statusFromSquare("CANCELED"), SubscriptionStatus.CANCELED);
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

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
