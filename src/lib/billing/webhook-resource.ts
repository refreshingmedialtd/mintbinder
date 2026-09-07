import type {
  SquareWebhookEvent,
  StripeWebhookEvent,
} from "./webhook-signature.ts";

type SquareResourceObject = {
  id?: unknown;
  invoice?: {
    id?: unknown;
    subscription_id?: unknown;
  } | null;
  payment?: { id?: unknown } | null;
  subscription?: { id?: unknown } | null;
  subscription_id?: unknown;
};

type StripeResourceObject = {
  id?: unknown;
  parent?: {
    subscription_details?: {
      subscription?: unknown;
    } | null;
  } | null;
  subscription?: unknown;
};

export const BILLING_WEBHOOK_RESOURCE_ID_MAX_LENGTH = 255;

export function billingWebhookResourceIdFromSquareEvent(event: SquareWebhookEvent) {
  const object = asSquareResourceObject(event.data?.object);

  if (event.type === "payment.created" || event.type === "payment.updated") {
    return firstResourceId(object?.payment?.id, object?.id, event.data?.id);
  }

  if (event.type === "subscription.created" || event.type === "subscription.updated") {
    return firstResourceId(object?.subscription?.id, object?.id, event.data?.id);
  }

  if (event.type === "invoice.payment_made") {
    const invoice = object?.invoice ?? object;
    return firstResourceId(invoice?.subscription_id, invoice?.id, event.data?.id);
  }

  return firstResourceId(object?.id, event.data?.id);
}

export function billingWebhookResourceIdFromStripeEvent(event: StripeWebhookEvent) {
  const object = asStripeResourceObject(event.data?.object);

  if (event.type === "checkout.session.completed") {
    return firstResourceId(stripeId(object?.subscription), object?.id);
  }

  if (event.type.startsWith("invoice.")) {
    return firstResourceId(
      stripeId(object?.parent?.subscription_details?.subscription),
      stripeId(object?.subscription),
      object?.id,
    );
  }

  return firstResourceId(object?.id);
}

export function boundedBillingWebhookResourceId(value?: string | null) {
  const normalized = value?.trim();
  return normalized
    ? normalized.slice(0, BILLING_WEBHOOK_RESOURCE_ID_MAX_LENGTH)
    : null;
}

function firstResourceId(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = boundedBillingWebhookResourceId(value);
    if (normalized) return normalized;
  }

  return undefined;
}

function stripeId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    return (value as { id?: unknown }).id;
  }
  return undefined;
}

function asSquareResourceObject(value: unknown) {
  return value && typeof value === "object"
    ? value as SquareResourceObject
    : undefined;
}

function asStripeResourceObject(value: unknown) {
  return value && typeof value === "object"
    ? value as StripeResourceObject
    : undefined;
}
