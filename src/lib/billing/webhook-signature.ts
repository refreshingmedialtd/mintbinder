import { createHmac, timingSafeEqual } from "node:crypto";

export type StripeWebhookEvent<T = unknown> = {
  id: string;
  type: string;
  created?: number;
  data: {
    object: T;
  };
};

export type SquareWebhookEvent<T = unknown> = {
  created_at?: string;
  data?: {
    id?: string;
    object?: T;
    type?: string;
  };
  event_id?: string;
  merchant_id?: string;
  type: string;
};

export function stripeWebhookOccurredAt(event: StripeWebhookEvent) {
  return Number.isFinite(event.created) ? new Date(Number(event.created) * 1000) : undefined;
}

export function squareWebhookOccurredAt(event: SquareWebhookEvent) {
  if (!event.created_at) {
    return undefined;
  }

  const occurredAt = new Date(event.created_at);
  return Number.isNaN(occurredAt.getTime()) ? undefined : occurredAt;
}

export class StripeWebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeWebhookSignatureError";
  }
}

export class SquareWebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SquareWebhookSignatureError";
  }
}

export function verifyStripeWebhookPayload({
  now = new Date(),
  payload,
  secret,
  signatureHeader,
  toleranceSeconds = 300,
}: {
  now?: Date;
  payload: string;
  secret: string;
  signatureHeader: string | null;
  toleranceSeconds?: number;
}): StripeWebhookEvent {
  if (!signatureHeader) {
    throw new StripeWebhookSignatureError("Missing Stripe signature header.");
  }

  const { signatures, timestamp } = parseStripeSignatureHeader(signatureHeader);
  const ageSeconds = Math.abs(Math.floor(now.getTime() / 1000) - timestamp);

  if (ageSeconds > toleranceSeconds) {
    throw new StripeWebhookSignatureError("Stripe signature timestamp is outside tolerance.");
  }

  const expectedSignature = signStripePayload(payload, secret, timestamp);
  const matches = signatures.some((signature) => constantTimeEqual(signature, expectedSignature));

  if (!matches) {
    throw new StripeWebhookSignatureError("No matching Stripe webhook signature.");
  }

  return JSON.parse(payload) as StripeWebhookEvent;
}

export function verifySquareWebhookPayload({
  notificationUrl,
  payload,
  signatureHeader,
  signatureKey,
}: {
  notificationUrl: string;
  payload: string;
  signatureHeader: string | null;
  signatureKey: string;
}): SquareWebhookEvent {
  if (!signatureHeader) {
    throw new SquareWebhookSignatureError("Missing Square signature header.");
  }

  const expectedSignature = signSquarePayload({ notificationUrl, payload, signatureKey });

  if (!constantTimeEqualBase64(signatureHeader, expectedSignature)) {
    throw new SquareWebhookSignatureError("No matching Square webhook signature.");
  }

  return JSON.parse(payload) as SquareWebhookEvent;
}

export function createStripeWebhookSignatureHeader({
  payload,
  secret,
  timestamp = Math.floor(Date.now() / 1000),
}: {
  payload: string;
  secret: string;
  timestamp?: number;
}) {
  return `t=${timestamp},v1=${signStripePayload(payload, secret, timestamp)}`;
}

export function createSquareWebhookSignatureHeader({
  notificationUrl,
  payload,
  signatureKey,
}: {
  notificationUrl: string;
  payload: string;
  signatureKey: string;
}) {
  return signSquarePayload({ notificationUrl, payload, signatureKey });
}

function parseStripeSignatureHeader(header: string) {
  const parts = header.split(",");
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const timestamp = Number(timestampPart?.slice(2));
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))
    .filter(Boolean);

  if (!Number.isFinite(timestamp) || !signatures.length) {
    throw new StripeWebhookSignatureError("Malformed Stripe signature header.");
  }

  return { signatures, timestamp };
}

function signStripePayload(payload: string, secret: string, timestamp: number) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");
}

function signSquarePayload({
  notificationUrl,
  payload,
  signatureKey,
}: {
  notificationUrl: string;
  payload: string;
  signatureKey: string;
}) {
  return createHmac("sha256", signatureKey)
    .update(`${notificationUrl}${payload}`, "utf8")
    .digest("base64");
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function constantTimeEqualBase64(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "base64");
  const rightBuffer = Buffer.from(right, "base64");

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
