import { createHmac, timingSafeEqual } from "node:crypto";

export type StripeWebhookEvent<T = unknown> = {
  id: string;
  type: string;
  created?: number;
  data: {
    object: T;
  };
};

export class StripeWebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeWebhookSignatureError";
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

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
