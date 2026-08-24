import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "mintbinder_checkout_v1";

export function createSquareCheckoutCorrelation(
  idempotencyKey: string,
  secret = correlationSecret(),
) {
  const key = normalizedKey(idempotencyKey);
  return `${PREFIX}:${key}:${signature(key, secret)}`;
}

export function parseSquareCheckoutCorrelation(
  note: string | null | undefined,
  secret = correlationSecret(),
) {
  if (!note?.startsWith(`${PREFIX}:`)) return null;

  const parts = note.split(":");
  if (parts.length !== 3) throw new Error("Square payment correlation note is malformed.");
  const key = normalizedKey(parts[1]);
  const expected = Buffer.from(signature(key, secret), "base64url");
  const actual = Buffer.from(parts[2], "base64url");

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Square payment correlation signature is invalid.");
  }

  return key;
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

function correlationSecret() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET is required for Square checkout correlation.");
  return secret;
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
