import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "mintbinder_checkout_v1";

export function createSquareCheckoutCorrelation(
  idempotencyKey: string,
  secret?: string,
) {
  const key = normalizedKey(idempotencyKey);
  const signingSecret = secret === undefined
    ? squareCheckoutCorrelationSecret()
    : validatedSecret(secret, "Square checkout correlation secret");
  return `${PREFIX}:${key}:${signature(key, signingSecret)}`;
}

export function parseSquareCheckoutCorrelation(
  note: string | null | undefined,
  secret?: string,
) {
  if (!note?.startsWith(`${PREFIX}:`)) return null;

  const parts = note.split(":");
  if (parts.length !== 3) throw new Error("Square payment correlation note is malformed.");
  const key = normalizedKey(parts[1]);
  const actual = Buffer.from(parts[2], "base64url");
  const verificationSecrets = secret === undefined
    ? squareCheckoutCorrelationVerificationSecrets()
    : [validatedSecret(secret, "Square checkout correlation secret")];

  const signatureMatches = verificationSecrets.some((verificationSecret) => {
    const expected = Buffer.from(signature(key, verificationSecret), "base64url");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });

  if (!signatureMatches) {
    throw new Error("Square payment correlation signature is invalid.");
  }

  return key;
}

export function squareCheckoutCorrelationSecret(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const dedicatedSecret = environment.SQUARE_CHECKOUT_CORRELATION_SECRET?.trim();
  const authSecret = environment.AUTH_SECRET?.trim();
  const jobSecret = environment.JOB_SECRET?.trim();
  const correlationIsPubliclyVerified =
    environment.SQUARE_PAYMENT_CORRELATION_VERIFIED?.trim().toLowerCase() === "true";

  if (dedicatedSecret) {
    const validated = validatedSecret(dedicatedSecret, "SQUARE_CHECKOUT_CORRELATION_SECRET");
    if (
      correlationIsPubliclyVerified &&
      (validated === authSecret || validated === jobSecret)
    ) {
      throw new Error(
        "SQUARE_CHECKOUT_CORRELATION_SECRET must be independent once Square payment correlation is verified.",
      );
    }
    return validated;
  }

  if (correlationIsPubliclyVerified) {
    throw new Error(
      "SQUARE_CHECKOUT_CORRELATION_SECRET is required once Square payment correlation is verified.",
    );
  }
  if (!authSecret) {
    throw new Error(
      "SQUARE_CHECKOUT_CORRELATION_SECRET or AUTH_SECRET is required for Square checkout correlation.",
    );
  }

  return validatedSecret(authSecret, "AUTH_SECRET fallback for Square checkout correlation");
}

export function squarePaymentOrderMatchesCheckout({
  orderId,
  expectedOrderId,
}: {
  orderId?: string | null;
  expectedOrderId?: string | null;
}) {
  return typeof orderId === "string" &&
    orderId.trim().length > 0 &&
    typeof expectedOrderId === "string" &&
    expectedOrderId.trim().length > 0 &&
    orderId === expectedOrderId;
}

export function squarePaymentMatchesCheckout({
  amountMinor,
  currency,
  expectedAmountMinor,
  expectedCurrency,
}: {
  amountMinor?: number | null;
  currency?: string | null;
  expectedAmountMinor?: number | null;
  expectedCurrency?: string | null;
}) {
  return Number.isSafeInteger(expectedAmountMinor) &&
    Number(expectedAmountMinor) > 0 &&
    amountMinor === expectedAmountMinor &&
    Boolean(expectedCurrency?.trim()) &&
    currency?.trim().toUpperCase() === expectedCurrency?.trim().toUpperCase();
}

export function validateSquareCompletedPaymentCorrelation({
  expectedPaymentId,
  intent,
  payment,
  secret,
}: {
  expectedPaymentId: string;
  intent: {
    expectedAmountMinor: number | null;
    expectedCurrency: string | null;
    idempotencyKey: string;
    plan: string;
    provider: string;
    providerCustomerId: string | null;
    providerOrderId: string | null;
    providerPlanVariationId: string | null;
  };
  payment: {
    amount_money?: { amount?: number | null; currency?: string | null } | null;
    customer_id?: string | null;
    id?: string | null;
    note?: string | null;
    order_id?: string | null;
    status?: string | null;
  } | null;
  secret?: string;
}):
  | { ok: true; customerId: string; paymentId: string }
  | { ok: false; reason: string } {
  const paymentId = payment?.id?.trim() ?? "";
  if (!payment || !paymentId || payment.id !== paymentId || paymentId !== expectedPaymentId) {
    return { ok: false, reason: "Square did not return the exact requested payment." };
  }
  if (payment.status?.trim().toUpperCase() !== "COMPLETED") {
    return { ok: false, reason: "Square did not confirm the exact payment as completed." };
  }

  let correlatedKey: string | null;
  try {
    correlatedKey = parseSquareCheckoutCorrelation(payment.note, secret);
  } catch {
    return { ok: false, reason: "Square payment correlation signature validation failed." };
  }
  if (!correlatedKey || correlatedKey !== intent.idempotencyKey) {
    return { ok: false, reason: "Square payment correlation did not match the checkout intent." };
  }

  const preparedCustomerId = intent.providerCustomerId?.trim() ?? "";
  if (
    !preparedCustomerId ||
    intent.providerCustomerId !== preparedCustomerId
  ) {
    return {
      ok: false,
      reason: "Square checkout intent did not retain an exact prepared customer snapshot.",
    };
  }

  const customerId = payment.customer_id?.trim() ?? "";
  if (
    !customerId ||
    payment.customer_id !== customerId
  ) {
    return { ok: false, reason: "Square payment did not contain an exact customer ID." };
  }
  if (
    intent.provider !== "square" ||
    !squarePaymentOrderMatchesCheckout({
      orderId: payment.order_id,
      expectedOrderId: intent.providerOrderId,
    })
  ) {
    return { ok: false, reason: "Square payment order did not match the checkout intent." };
  }
  if (!squarePaymentMatchesCheckout({
    amountMinor: payment.amount_money?.amount,
    currency: payment.amount_money?.currency,
    expectedAmountMinor: intent.expectedAmountMinor,
    expectedCurrency: intent.expectedCurrency,
  })) {
    return { ok: false, reason: "Square payment amount or currency did not match the checkout intent." };
  }
  if (
    (intent.plan !== "PLUS_MONTHLY" && intent.plan !== "PLUS_YEARLY") ||
    !intent.providerPlanVariationId?.trim()
  ) {
    return { ok: false, reason: "Square checkout intent did not retain an immutable Plus plan snapshot." };
  }

  return { ok: true, customerId, paymentId };
}

function squareCheckoutCorrelationVerificationSecrets(environment: NodeJS.ProcessEnv = process.env) {
  const primarySecret = squareCheckoutCorrelationSecret(environment);
  const dedicatedSecret = environment.SQUARE_CHECKOUT_CORRELATION_SECRET?.trim();
  const legacyAuthSecret = environment.AUTH_SECRET?.trim();
  const correlationIsPubliclyVerified =
    environment.SQUARE_PAYMENT_CORRELATION_VERIFIED?.trim().toLowerCase() === "true";

  if (
    dedicatedSecret &&
    !correlationIsPubliclyVerified &&
    legacyAuthSecret &&
    legacyAuthSecret !== primarySecret &&
    legacyAuthSecret.length >= 32
  ) {
    return [primarySecret, legacyAuthSecret];
  }

  return [primarySecret];
}

function validatedSecret(secret: string, label: string) {
  const normalized = secret.trim();
  if (normalized.length < 32) {
    throw new Error(`${label} must be at least 32 characters.`);
  }
  return normalized;
}

function normalizedKey(value: string) {
  const key = value.trim();
  if (!/^[0-9a-f-]{36}$/i.test(key)) throw new Error("Square checkout correlation key is invalid.");
  return key;
}

function signature(key: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`${PREFIX}:${key}`, "utf8")
    .digest("base64url");
}
