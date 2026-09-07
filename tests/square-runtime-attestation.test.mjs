import assert from "node:assert/strict";
import test from "node:test";
import {
  SQUARE_HOSTED_QA_ATTESTATION_SCHEMA,
  squareHostedQaRuntimeAttestation,
} from "../src/lib/billing/square-runtime-attestation.ts";

const BASE_ENVIRONMENT = {
  SQUARE_ACCESS_TOKEN: "access-token-one",
  SQUARE_CHECKOUT_CORRELATION_SECRET: "correlation-secret-one",
  SQUARE_CURRENCY: "GBP",
  SQUARE_ENVIRONMENT: "sandbox",
  SQUARE_LOCATION_ID: "location-one",
  SQUARE_PAYMENT_CORRELATION_VERIFIED: "false",
  SQUARE_PLUS_MONTHLY_AMOUNT_MINOR: "249",
  SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID: "monthly-one",
  SQUARE_PLUS_YEARLY_AMOUNT_MINOR: "1999",
  SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID: "yearly-one",
  SQUARE_VERSION: "2026-05-20",
  SQUARE_WEBHOOK_NOTIFICATION_URL: "https://mintbinder.co.uk/api/billing/webhook/square",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "signature-key-one",
  SQUARE_WEBHOOK_SUBSCRIPTION_ID: "subscription-one",
};

test("Square hosted-QA attestation is a single versioned SHA-256 fingerprint", () => {
  const attestation = squareHostedQaRuntimeAttestation(BASE_ENVIRONMENT);

  assert.deepEqual(Object.keys(attestation).sort(), ["algorithm", "fingerprint", "schema"]);
  assert.equal(attestation.algorithm, "sha256");
  assert.equal(attestation.schema, SQUARE_HOSTED_QA_ATTESTATION_SCHEMA);
  assert.match(attestation.fingerprint, /^[0-9a-f]{64}$/);

  const serialized = JSON.stringify(attestation);
  for (const value of Object.values(BASE_ENVIRONMENT).filter((entry) => entry.length >= 10)) {
    assert.equal(serialized.includes(value), false);
  }
});

test("every security and billing input changes the aggregate fingerprint", () => {
  const baseline = squareHostedQaRuntimeAttestation(BASE_ENVIRONMENT).fingerprint;
  const replacements = {
    SQUARE_ACCESS_TOKEN: "access-token-two",
    SQUARE_CHECKOUT_CORRELATION_SECRET: "correlation-secret-two",
    SQUARE_CURRENCY: "USD",
    SQUARE_ENVIRONMENT: "production",
    SQUARE_LOCATION_ID: "location-two",
    SQUARE_PAYMENT_CORRELATION_VERIFIED: "true",
    SQUARE_PLUS_MONTHLY_AMOUNT_MINOR: "250",
    SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID: "monthly-two",
    SQUARE_PLUS_YEARLY_AMOUNT_MINOR: "2000",
    SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID: "yearly-two",
    SQUARE_VERSION: "2026-08-19",
    SQUARE_WEBHOOK_NOTIFICATION_URL: "https://example.com/api/billing/webhook/square",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "signature-key-two",
    SQUARE_WEBHOOK_SUBSCRIPTION_ID: "subscription-two",
  };

  for (const [key, value] of Object.entries(replacements)) {
    const changed = squareHostedQaRuntimeAttestation({
      ...BASE_ENVIRONMENT,
      [key]: value,
    }).fingerprint;
    assert.notEqual(changed, baseline, `${key} must contribute to the fingerprint.`);
  }
});

test("fingerprinting follows the Square runtime's effective normalization", () => {
  const normalized = squareHostedQaRuntimeAttestation(BASE_ENVIRONMENT).fingerprint;
  const equivalent = squareHostedQaRuntimeAttestation({
    ...BASE_ENVIRONMENT,
    SQUARE_ACCESS_TOKEN: `  ${BASE_ENVIRONMENT.SQUARE_ACCESS_TOKEN}  `,
    SQUARE_CURRENCY: " gbp ",
    SQUARE_ENVIRONMENT: " SANDBOX ",
    SQUARE_PAYMENT_CORRELATION_VERIFIED: " FALSE ",
    SQUARE_PLUS_MONTHLY_AMOUNT_MINOR: "249.9",
    SQUARE_PLUS_YEARLY_AMOUNT_MINOR: "1999.8",
  }).fingerprint;

  assert.equal(equivalent, normalized);
});

test("length-prefixed key/value frames distinguish ambiguous concatenations", () => {
  const first = squareHostedQaRuntimeAttestation({
    ...BASE_ENVIRONMENT,
    SQUARE_ACCESS_TOKEN: "a",
    SQUARE_CHECKOUT_CORRELATION_SECRET: "bc",
  }).fingerprint;
  const second = squareHostedQaRuntimeAttestation({
    ...BASE_ENVIRONMENT,
    SQUARE_ACCESS_TOKEN: "ab",
    SQUARE_CHECKOUT_CORRELATION_SECRET: "c",
  }).fingerprint;

  assert.notEqual(first, second);
});

test("an explicit local webhook override can attest the deployed webhook URL", () => {
  const deployed = squareHostedQaRuntimeAttestation(BASE_ENVIRONMENT);
  const local = squareHostedQaRuntimeAttestation(
    {
      ...BASE_ENVIRONMENT,
      SQUARE_WEBHOOK_NOTIFICATION_URL: "https://local-tunnel.example/api/billing/webhook/square",
    },
    { webhookUrl: BASE_ENVIRONMENT.SQUARE_WEBHOOK_NOTIFICATION_URL },
  );

  assert.deepEqual(local, deployed);
});
