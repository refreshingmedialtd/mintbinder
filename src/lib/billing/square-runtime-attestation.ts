import { createHash, type Hash } from "node:crypto";

type HealthEnvironment = NodeJS.ProcessEnv;

type SquareHostedQaAttestationOverrides = {
  webhookUrl?: string;
};

export const SQUARE_HOSTED_QA_ATTESTATION_SCHEMA = "mintbinder-square-hosted-qa-runtime-v1";

const SQUARE_HOSTED_QA_CONFIGURATION_KEYS = [
  "SQUARE_CHECKOUT_CORRELATION_SECRET",
  "SQUARE_WEBHOOK_SIGNATURE_KEY",
  "SQUARE_ACCESS_TOKEN",
  "SQUARE_LOCATION_ID",
  "SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID",
  "SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID",
  "SQUARE_ENVIRONMENT",
  "SQUARE_VERSION",
  "SQUARE_WEBHOOK_NOTIFICATION_URL",
  "SQUARE_WEBHOOK_SUBSCRIPTION_ID",
  "SQUARE_CURRENCY",
  "SQUARE_PLUS_MONTHLY_AMOUNT_MINOR",
  "SQUARE_PLUS_YEARLY_AMOUNT_MINOR",
  "SQUARE_PAYMENT_CORRELATION_VERIFIED",
] as const;

/**
 * Produces one aggregate digest for the Square settings that must agree between
 * the deployed runtime and the out-of-band hosted-checkout acceptance runner.
 * No component value or per-setting digest is returned.
 */
export function squareHostedQaRuntimeAttestation(
  environment: HealthEnvironment = process.env,
  overrides: SquareHostedQaAttestationOverrides = {},
) {
  const values = effectiveSquareHostedQaValues(environment, overrides);
  const hash = createHash("sha256");

  updateFrame(hash, "schema", SQUARE_HOSTED_QA_ATTESTATION_SCHEMA);
  for (const key of SQUARE_HOSTED_QA_CONFIGURATION_KEYS) {
    updateFrame(hash, key, values[key]);
  }

  return {
    algorithm: "sha256" as const,
    fingerprint: hash.digest("hex"),
    schema: SQUARE_HOSTED_QA_ATTESTATION_SCHEMA,
  };
}

function effectiveSquareHostedQaValues(
  environment: HealthEnvironment,
  overrides: SquareHostedQaAttestationOverrides,
) {
  return {
    SQUARE_CHECKOUT_CORRELATION_SECRET: trimmed(environment.SQUARE_CHECKOUT_CORRELATION_SECRET),
    SQUARE_WEBHOOK_SIGNATURE_KEY: trimmed(environment.SQUARE_WEBHOOK_SIGNATURE_KEY),
    SQUARE_ACCESS_TOKEN: trimmed(environment.SQUARE_ACCESS_TOKEN),
    SQUARE_LOCATION_ID: trimmed(environment.SQUARE_LOCATION_ID),
    SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID: trimmed(
      environment.SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID,
    ),
    SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID: trimmed(
      environment.SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID,
    ),
    SQUARE_ENVIRONMENT:
      trimmed(environment.SQUARE_ENVIRONMENT).toLowerCase() === "production"
        ? "production"
        : "sandbox",
    SQUARE_VERSION: trimmed(environment.SQUARE_VERSION) || "2026-05-20",
    SQUARE_WEBHOOK_NOTIFICATION_URL: trimmed(
      overrides.webhookUrl ?? environment.SQUARE_WEBHOOK_NOTIFICATION_URL,
    ),
    SQUARE_WEBHOOK_SUBSCRIPTION_ID: trimmed(environment.SQUARE_WEBHOOK_SUBSCRIPTION_ID),
    SQUARE_CURRENCY: trimmed(environment.SQUARE_CURRENCY).toUpperCase() || "GBP",
    SQUARE_PLUS_MONTHLY_AMOUNT_MINOR: effectivePositiveInteger(
      environment.SQUARE_PLUS_MONTHLY_AMOUNT_MINOR,
      249,
    ),
    SQUARE_PLUS_YEARLY_AMOUNT_MINOR: effectivePositiveInteger(
      environment.SQUARE_PLUS_YEARLY_AMOUNT_MINOR,
      1999,
    ),
    SQUARE_PAYMENT_CORRELATION_VERIFIED:
      trimmed(environment.SQUARE_PAYMENT_CORRELATION_VERIFIED).toLowerCase() === "true"
        ? "true"
        : "false",
  } satisfies Record<(typeof SQUARE_HOSTED_QA_CONFIGURATION_KEYS)[number], string>;
}

function effectivePositiveInteger(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? String(Math.floor(number)) : String(fallback);
}

function trimmed(value: string | undefined) {
  return value?.trim() ?? "";
}

function updateFrame(hash: Hash, key: string, value: string) {
  updateLengthPrefixed(hash, Buffer.from(key, "utf8"));
  updateLengthPrefixed(hash, Buffer.from(value, "utf8"));
}

function updateLengthPrefixed(hash: Hash, value: Buffer) {
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(value.byteLength);
  hash.update(length);
  hash.update(value);
}
