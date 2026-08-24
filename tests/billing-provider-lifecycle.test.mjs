import assert from "node:assert/strict";
import test from "node:test";
import {
  authAndJobSecretsAreIndependent,
  billingProviderLifecycleSettings,
} from "../scripts/billing-provider-lifecycle.mjs";

test("historical Stripe webhooks remain enabled while Square serves new checkouts", () => {
  assert.deepEqual(billingProviderLifecycleSettings({
    BILLING_PROVIDER: "square",
    STRIPE_WEBHOOK_ENABLED: "true",
  }), {
    checkoutProvider: "square",
    squareWebhookEnabled: true,
    stripeWebhookEnabled: true,
  });
});

test("authentication and scheduler secrets must be independent", () => {
  assert.equal(authAndJobSecretsAreIndependent({ AUTH_SECRET: "same", JOB_SECRET: "same" }), false);
  assert.equal(authAndJobSecretsAreIndependent({ AUTH_SECRET: "auth-value", JOB_SECRET: "job-value" }), true);
});

test("historical Square webhooks remain enabled while Stripe serves new checkouts", () => {
  assert.deepEqual(billingProviderLifecycleSettings({
    BILLING_PROVIDER: "stripe",
    SQUARE_WEBHOOK_ENABLED: "true",
  }), {
    checkoutProvider: "stripe",
    squareWebhookEnabled: true,
    stripeWebhookEnabled: true,
  });
});
