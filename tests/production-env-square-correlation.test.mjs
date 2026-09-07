import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const validatorPath = fileURLToPath(
  new URL("../scripts/validate-production-env.mjs", import.meta.url),
);

const readyEnvironment = {
  DATABASE_URL: "postgresql://mintbinder:password@db.example.net/mintbinder",
  AUTH_SECRET: "auth-entropy-value-12345678901234567890",
  AUTH_URL: "https://mintbinder.example",
  AUTH_TRUST_HOST: "true",
  NEXT_PUBLIC_APP_URL: "https://mintbinder.example",
  SCHEDULED_JOB_APP_URL: "https://mintbinder.example",
  JOB_SECRET: "job-entropy-value-123456789012345678901",
  BILLING_PROVIDER: "square",
  SQUARE_WEBHOOK_ENABLED: "true",
  STRIPE_WEBHOOK_ENABLED: "false",
  SQUARE_ACCESS_TOKEN: "square-access-token",
  SQUARE_ENVIRONMENT: "production",
  SQUARE_LOCATION_ID: "square-location",
  SQUARE_WEBHOOK_NOTIFICATION_URL: "https://mintbinder.example/api/billing/webhook/square",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "square-signature-key",
  SQUARE_WEBHOOK_SUBSCRIPTION_ID: "square-webhook-subscription",
  SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID: "square-monthly",
  SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID: "square-yearly",
  SQUARE_PLUS_MONTHLY_AMOUNT_MINOR: "249",
  SQUARE_PLUS_YEARLY_AMOUNT_MINOR: "1999",
  SQUARE_CURRENCY: "GBP",
  EMAIL_PROVIDER: "smtp",
  EMAIL_FROM: "Mint Binder <alerts@mintbinder.example>",
  SMTP_HOST: "smtp.example.net",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USER: "alerts@mintbinder.example",
  SMTP_PASSWORD: "smtp-password",
  JOB_MONITOR_DRY_RUN: "false",
  JOB_MONITOR_ALERT_TO: "operations@mintbinder.example",
  LEGAL_BUSINESS_NAME: "Mint Binder Limited",
  LEGAL_COMPANY_NUMBER: "12345678",
  LEGAL_REGISTERED_ADDRESS: "1 Example Road, London",
  LEGAL_SUPPORT_EMAIL: "support@mintbinder.example",
  LEGAL_PRIVACY_EMAIL: "privacy@mintbinder.example",
  LEGAL_LAST_REVIEWED_AT: "2026-09-07",
  LEGAL_TERMS_REVIEWED: "true",
  LEGAL_PRIVACY_REVIEWED: "true",
  LEGAL_NON_AFFILIATION_REVIEWED: "true",
};

test("deployment validation warns while Square correlation still uses the AUTH_SECRET fallback", () => {
  const report = runValidator("--deployment", {
    SQUARE_CHECKOUT_CORRELATION_SECRET: "",
    SQUARE_PAYMENT_CORRELATION_VERIFIED: "false",
  });

  assert.equal(report.warnings.some(({ key }) => key === "SQUARE_CHECKOUT_CORRELATION_SECRET"), true);
  assert.equal(report.blockers.some(({ key }) => key === "SQUARE_CHECKOUT_CORRELATION_SECRET"), false);
});

test("public-launch validation requires both the dedicated secret and explicit correlation evidence", () => {
  const missing = runValidator("--public-launch", {
    SQUARE_CHECKOUT_CORRELATION_SECRET: "",
    SQUARE_PAYMENT_CORRELATION_VERIFIED: "",
  });

  assert.equal(missing.blockers.some(({ key }) => key === "SQUARE_CHECKOUT_CORRELATION_SECRET"), true);
  assert.equal(missing.blockers.some(({ key }) => key === "SQUARE_PAYMENT_CORRELATION_VERIFIED"), true);

  const configured = runValidator("--public-launch", {
    SQUARE_CHECKOUT_CORRELATION_SECRET: "square-correlation-entropy-123456789012345",
    SQUARE_PAYMENT_CORRELATION_VERIFIED: "true",
  });

  assert.equal(configured.blockers.some(({ key }) => key === "SQUARE_CHECKOUT_CORRELATION_SECRET"), false);
  assert.equal(configured.blockers.some(({ key }) => key === "SQUARE_PAYMENT_CORRELATION_VERIFIED"), false);

  const reused = runValidator("--public-launch", {
    SQUARE_CHECKOUT_CORRELATION_SECRET: readyEnvironment.AUTH_SECRET,
    SQUARE_PAYMENT_CORRELATION_VERIFIED: "true",
  });
  assert.equal(reused.blockers.some(({ key }) => key === "SQUARE_CHECKOUT_CORRELATION_SECRET"), true);
});

test("a configured Square correlation secret must be at least 32 characters", () => {
  const report = runValidator("--deployment", {
    SQUARE_CHECKOUT_CORRELATION_SECRET: "too-short",
    SQUARE_PAYMENT_CORRELATION_VERIFIED: "false",
  });

  assert.equal(report.blockers.some(({ key }) => key === "SQUARE_CHECKOUT_CORRELATION_SECRET"), true);
});

test("deployment validation fails closed when verified checkout lacks an independent dedicated secret", () => {
  const missing = runValidator("--deployment", {
    SQUARE_CHECKOUT_CORRELATION_SECRET: "",
    SQUARE_PAYMENT_CORRELATION_VERIFIED: "true",
  });
  assert.equal(missing.blockers.some(({ key }) => key === "SQUARE_CHECKOUT_CORRELATION_SECRET"), true);

  const reused = runValidator("--deployment", {
    SQUARE_CHECKOUT_CORRELATION_SECRET: readyEnvironment.AUTH_SECRET,
    SQUARE_PAYMENT_CORRELATION_VERIFIED: "true",
  });
  assert.equal(reused.blockers.some(({ key }) => key === "SQUARE_CHECKOUT_CORRELATION_SECRET"), true);
});

test("deployment validation blocks verified Square checkout from using sandbox credentials", () => {
  const unsafe = runValidator("--deployment", {
    SQUARE_CHECKOUT_CORRELATION_SECRET: "square-correlation-entropy-123456789012345",
    SQUARE_ENVIRONMENT: "sandbox",
    SQUARE_PAYMENT_CORRELATION_VERIFIED: "true",
  });

  assert.equal(unsafe.blockers.some(({ key }) => key === "SQUARE_ENVIRONMENT"), true);
  assert.equal(unsafe.warnings.some(({ key }) => key === "SQUARE_ENVIRONMENT"), false);
});

test("deployment validation keeps sandbox staging as a warning while correlation is unverified", () => {
  const staging = runValidator("--deployment", {
    SQUARE_CHECKOUT_CORRELATION_SECRET: "square-correlation-entropy-123456789012345",
    SQUARE_ENVIRONMENT: "sandbox",
    SQUARE_PAYMENT_CORRELATION_VERIFIED: "false",
  });

  assert.equal(staging.blockers.some(({ key }) => key === "SQUARE_ENVIRONMENT"), false);
  assert.equal(staging.warnings.some(({ key }) => key === "SQUARE_ENVIRONMENT"), true);
});

test("deployment validation treats a trimmed mixed-case correlation flag as verified", () => {
  const report = runValidator("--deployment", {
    SQUARE_CHECKOUT_CORRELATION_SECRET: "square-correlation-entropy-123456789012345",
    SQUARE_ENVIRONMENT: "production",
    SQUARE_PAYMENT_CORRELATION_VERIFIED: "  TrUe  ",
  });

  assert.equal(
    report.warnings.some(({ key }) => key === "SQUARE_PAYMENT_CORRELATION_VERIFIED"),
    false,
  );
  assert.equal(report.blockers.some(({ key }) => key === "SQUARE_ENVIRONMENT"), false);
});

test("continued Square webhooks retain correlation-key validation after checkout moves to Stripe", () => {
  const report = runValidator("--public-launch", {
    BILLING_PROVIDER: "stripe",
    SQUARE_WEBHOOK_ENABLED: "true",
    SQUARE_CHECKOUT_CORRELATION_SECRET: "",
    STRIPE_SECRET_KEY: "stripe-private-key",
    STRIPE_WEBHOOK_SECRET: "stripe-webhook-key",
    STRIPE_WEBHOOK_NOTIFICATION_URL: "https://mintbinder.example/api/billing/webhook/stripe",
  });

  assert.equal(report.blockers.some(({ key }) => key === "SQUARE_CHECKOUT_CORRELATION_SECRET"), true);
});

function runValidator(mode, overrides) {
  const result = spawnSync(process.execPath, [validatorPath, mode, "--json"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
    env: {
      ...process.env,
      ...readyEnvironment,
      ...overrides,
    },
  });

  assert.equal(result.error, undefined);
  assert.notEqual(result.stdout.trim(), "", result.stderr);
  return JSON.parse(result.stdout);
}
