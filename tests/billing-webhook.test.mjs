import assert from "node:assert/strict";
import test from "node:test";
import {
  createStripeWebhookSignatureHeader,
  verifyStripeWebhookPayload,
} from "../src/lib/billing/webhook-signature.ts";

const secret = "whsec_test_secret";
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
