import { BillingConfigError, billingErrorStatus } from "@/lib/billing/errors";

type StripeSessionResponse = {
  id: string;
  url?: string;
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
  name,
  userId,
}: {
  email?: string | null;
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

  return stripeRequest<StripeCustomerResponse>("/v1/customers", body);
}

export async function createStripeCheckoutSession({
  customerId,
  origin,
  plan,
  userId,
}: {
  customerId: string;
  origin: string;
  plan: "monthly" | "yearly";
  userId: string;
}) {
  const priceId = plan === "yearly" ? process.env.STRIPE_PLUS_YEARLY_PRICE_ID : process.env.STRIPE_PLUS_MONTHLY_PRICE_ID;

  if (!priceId) {
    throw new BillingConfigError(`Missing Stripe ${plan} Plus price id.`);
  }

  const body = new URLSearchParams();
  body.set("customer", customerId);
  body.set("mode", "subscription");
  body.set("line_items[0][price]", priceId);
  body.set("line_items[0][quantity]", "1");
  body.set("client_reference_id", userId);
  body.set("metadata[user_id]", userId);
  body.set("metadata[plan]", plan);
  body.set("subscription_data[metadata][user_id]", userId);
  body.set("success_url", `${origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`);
  body.set("cancel_url", `${origin}/?billing=cancelled`);

  return stripeRequest<StripeSessionResponse>("/v1/checkout/sessions", body);
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

async function stripeRequest<T>(path: string, body: URLSearchParams) {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new BillingConfigError("Stripe is not configured.");
  }

  const response = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = (await response.json()) as T & StripeErrorResponse;

  if (!response.ok) {
    throw new Error(data.error?.message ?? `Stripe request failed with ${response.status}.`);
  }

  return data;
}
