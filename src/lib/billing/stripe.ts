import { BillingConfigError, billingErrorStatus } from "@/lib/billing/errors";
import { fetchWithPolicy } from "@/lib/http/fetch-with-policy";
import { stripeCheckoutSessionMatchesIntent } from "@/lib/billing/stripe-checkout-recovery";

export type StripeSessionResponse = {
  customer?: string | { id?: string | null } | null;
  id: string;
  metadata?: Record<string, string | undefined> | null;
  status?: "complete" | "expired" | "open";
  subscription?: string | { id?: string | null } | null;
  url?: string;
};

type StripeSessionListResponse = {
  data?: StripeSessionResponse[];
  has_more?: boolean;
};

type StripeCustomerResponse = {
  id: string;
};

type StripeErrorResponse = {
  error?: {
    message?: string;
  };
};
export { BillingConfigError, billingErrorStatus };

export async function createStripeCustomer({
  email,
  idempotencyKey,
  name,
  userId,
}: {
  email?: string | null;
  idempotencyKey?: string;
  name?: string | null;
  userId: string;
}) {
  const body = new URLSearchParams();

  if (email) {
    body.set("email", email);
  }

  if (name) {
    body.set("name", name);
  }

  body.set("metadata[user_id]", userId);

  return stripeRequest<StripeCustomerResponse>("/v1/customers", body, idempotencyKey);
}

export async function deleteStripeCustomer(customerId: string) {
  return stripeRequest<StripeCustomerResponse>(
    `/v1/customers/${encodeURIComponent(customerId)}`,
    new URLSearchParams(),
  );
}

export async function createStripeCheckoutSession({
  checkoutIntentId,
  customerId,
  idempotencyKey,
  origin,
  plan,
  priceId,
  userId,
}: {
  checkoutIntentId: string;
  customerId: string;
  idempotencyKey: string;
  origin: string;
  plan: "monthly" | "yearly";
  priceId: string;
  userId: string;
}) {
  if (!priceId.trim()) throw new BillingConfigError("Stripe checkout price ID is missing.");

  const body = new URLSearchParams();
  body.set("customer", customerId);
  body.set("mode", "subscription");
  body.set("line_items[0][price]", priceId);
  body.set("line_items[0][quantity]", "1");
  body.set("client_reference_id", userId);
  body.set("metadata[user_id]", userId);
  body.set("metadata[plan]", plan);
  body.set("metadata[checkout_intent_id]", checkoutIntentId);
  body.set("subscription_data[metadata][user_id]", userId);
  body.set("subscription_data[metadata][checkout_intent_id]", checkoutIntentId);
  body.set("success_url", `${origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`);
  body.set("cancel_url", `${origin}/?billing=cancelled`);

  return stripeRequest<StripeSessionResponse>("/v1/checkout/sessions", body, idempotencyKey);
}

export function stripeCheckoutPriceId(plan: "monthly" | "yearly") {
  const priceId = plan === "yearly"
    ? process.env.STRIPE_PLUS_YEARLY_PRICE_ID?.trim()
    : process.env.STRIPE_PLUS_MONTHLY_PRICE_ID?.trim();
  if (!priceId) throw new BillingConfigError(`Missing Stripe ${plan} Plus price id.`);
  return priceId;
}

export async function findStripeCheckoutSessionByIntent({
  checkoutIntentId,
  customerId,
}: {
  checkoutIntentId: string;
  customerId: string;
}) {
  let startingAfter: string | undefined;

  for (let page = 0; page < 5; page += 1) {
    const query = new URLSearchParams({ customer: customerId, limit: "100" });
    if (startingAfter) query.set("starting_after", startingAfter);
    const response = await stripeRequest<StripeSessionListResponse>(`/v1/checkout/sessions?${query}`);
    const sessions = response.data ?? [];
    const exact = sessions.find((session) =>
      stripeCheckoutSessionMatchesIntent(session, checkoutIntentId, customerId));
    if (exact) return exact;
    if (!response.has_more || sessions.length === 0) return null;
    startingAfter = sessions.at(-1)?.id;
    if (!startingAfter) return null;
  }

  throw new Error("Stripe checkout recovery exceeded its safe pagination limit.");
}

export async function createStripePortalSession({
  customerId,
  origin,
}: {
  customerId: string;
  origin: string;
}) {
  const body = new URLSearchParams();
  body.set("customer", customerId);
  body.set("return_url", `${origin}/?billing=portal`);

  return stripeRequest<StripeSessionResponse>("/v1/billing_portal/sessions", body);
}

export async function retrieveStripeSubscription(subscriptionId: string) {
  return stripeRequest<Record<string, unknown>>(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
  );
}

export async function retrieveStripeCheckoutSession(sessionId: string) {
  return stripeRequest<StripeSessionResponse>(
    `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export async function expireStripeCheckoutSession(sessionId: string) {
  return stripeRequest<StripeSessionResponse>(
    `/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
    new URLSearchParams(),
  );
}

async function stripeRequest<T>(path: string, body?: URLSearchParams, idempotencyKey?: string) {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new BillingConfigError("Stripe is not configured.");
  }

  const response = await fetchWithPolicy(`https://api.stripe.com${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body,
  }, {
    provider: "Stripe",
    retryAttempts: 2,
    retryWaitMs: 400,
    timeoutMs: 10_000,
  });
  const data = (await response.json()) as T & StripeErrorResponse;

  if (!response.ok) {
    throw new Error(data.error?.message ?? `Stripe request failed with ${response.status}.`);
  }

  return data;
}
