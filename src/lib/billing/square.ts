import { randomUUID } from "node:crypto";
import { BillingConfigError } from "@/lib/billing/errors";
import { fetchWithPolicy } from "@/lib/http/fetch-with-policy";
import { createSquareCheckoutCorrelation } from "@/lib/billing/square-checkout-correlation";

type SquarePlan = "monthly" | "yearly";

export type SquareCheckoutExpectation = {
  amountMinor: number;
  currency: string;
  planVariationId: string;
};

type SquareCustomerResponse = {
  customer?: {
    email_address?: string;
    id?: string;
    reference_id?: string;
  };
  errors?: SquareApiError[];
};

type SquarePaymentLinkResponse = {
  errors?: SquareApiError[];
  payment_link?: {
    id?: string;
    long_url?: string;
    order_id?: string;
    url?: string;
  };
};

type SquareOrderResponse = {
  errors?: SquareApiError[];
  order?: {
    id?: string | null;
    state?: string | null;
  };
};

type SquarePaymentResponse = {
  errors?: SquareApiError[];
  payment?: SquarePaymentRecord;
};

type SquareRequestOptions = {
  body?: unknown;
  method?: "DELETE" | "GET" | "POST" | "PUT";
};

type SquareSubscriptionResponse = {
  errors?: SquareApiError[];
  subscription?: SquareSubscriptionRecord;
};

type SquareSubscriptionSearchResponse = {
  cursor?: string;
  errors?: SquareApiError[];
  subscriptions?: SquareSubscriptionRecord[];
};

type SquareApiError = {
  category?: string;
  code?: string;
  detail?: string;
  field?: string;
};

export type SquareCustomer = {
  emailAddress?: string;
  id: string;
  referenceId?: string;
};

export type SquareSubscriptionRecord = {
  canceled_date?: string | null;
  charged_through_date?: string | null;
  customer_id?: string | null;
  id?: string | null;
  plan_variation_id?: string | null;
  status?: string | null;
};

export type SquarePaymentRecord = {
  amount_money?: { amount?: number | null; currency?: string | null } | null;
  customer_id?: string | null;
  id?: string | null;
  note?: string | null;
  order_id?: string | null;
  status?: string | null;
};

export async function createSquareCustomer({
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
  const body: Record<string, unknown> = {
    idempotency_key: idempotencyKey ?? randomUUID(),
    note: "Mint Binder subscription customer",
    reference_id: userId,
  };

  if (email) {
    body.email_address = email;
  }

  if (name) {
    body.given_name = name;
  }

  const response = await squareRequest<SquareCustomerResponse>("/v2/customers", body);
  const customer = response.customer;

  if (!customer?.id) {
    throw new Error("Square did not return a customer ID.");
  }

  return {
    emailAddress: customer.email_address,
    id: customer.id,
    referenceId: customer.reference_id,
  } satisfies SquareCustomer;
}

export async function retrieveSquareCustomer(customerId: string) {
  let response: SquareCustomerResponse;

  try {
    response = await squareRequest<SquareCustomerResponse>(`/v2/customers/${customerId}`);
  } catch (error) {
    if (isSquareNotFoundError(error)) {
      return null;
    }

    throw error;
  }

  const customer = response.customer;

  if (!customer?.id) {
    return null;
  }

  return {
    emailAddress: customer.email_address,
    id: customer.id,
    referenceId: customer.reference_id,
  } satisfies SquareCustomer;
}

export async function deleteSquareCustomer(customerId: string) {
  try {
    await squareRequest(`/v2/customers/${encodeURIComponent(customerId)}`, { method: "DELETE" });
  } catch (error) {
    if (!isSquareNotFoundError(error)) {
      throw error;
    }
  }
}

export async function retrieveSquareSubscription(subscriptionId: string) {
  let response: SquareSubscriptionResponse;
  try {
    response = await squareRequest<SquareSubscriptionResponse>(`/v2/subscriptions/${subscriptionId}`);
  } catch (error) {
    if (isSquareNotFoundError(error)) return null;
    throw error;
  }

  return response.subscription ?? null;
}

export async function retrieveSquarePayment(paymentId: string) {
  const response = await squareRequest<SquarePaymentResponse>(`/v2/payments/${encodeURIComponent(paymentId)}`);
  return response.payment ?? null;
}

export async function cancelSquareSubscription(subscriptionId: string) {
  const response = await squareRequest<SquareSubscriptionResponse>(`/v2/subscriptions/${subscriptionId}/cancel`, {
    method: "POST",
  });

  if (!response.subscription?.id) {
    throw new Error("Square did not return the cancelled subscription.");
  }

  return response.subscription;
}

export async function searchSquareSubscriptions(customerId: string) {
  const subscriptions: SquareSubscriptionRecord[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 20; page += 1) {
    const response = await squareRequest<SquareSubscriptionSearchResponse>("/v2/subscriptions/search", {
      method: "POST",
      body: {
        cursor,
        limit: 100,
        query: {
          filter: {
            customer_ids: [customerId],
          },
        },
      },
    });

    subscriptions.push(...(response.subscriptions ?? []));
    cursor = response.cursor?.trim() || undefined;

    if (!cursor) {
      return subscriptions;
    }
  }

  throw new Error("Square subscription search exceeded its safe pagination limit.");
}

export async function createSquareSubscriptionCheckout({
  email,
  expectation,
  idempotencyKey,
  origin,
  plan,
}: {
  email?: string | null;
  expectation: SquareCheckoutExpectation;
  idempotencyKey?: string;
  origin: string;
  plan: SquarePlan;
}) {
  const requestKey = idempotencyKey ?? randomUUID();
  const body = {
    checkout_options: {
      allow_tipping: false,
      enable_coupon: false,
      enable_loyalty: false,
      redirect_url: `${origin}/?billing=success&provider=square&plan=${plan}`,
      subscription_plan_id: expectation.planVariationId,
    },
    idempotency_key: requestKey,
    payment_note: createSquareCheckoutCorrelation(requestKey),
    pre_populated_data: {
      buyer_email: email ?? undefined,
    },
    quick_pay: {
      location_id: squareLocationId(),
      name: `Mint Binder Plus ${plan === "yearly" ? "Yearly" : "Monthly"}`,
      price_money: {
        amount: expectation.amountMinor,
        currency: expectation.currency,
      },
    },
  };
  const response = await squareRequest<SquarePaymentLinkResponse>("/v2/online-checkout/payment-links", body);
  const paymentLink = response.payment_link;
  const url = paymentLink?.url ?? paymentLink?.long_url;

  if (!paymentLink?.id || !paymentLink.order_id || !url) {
    throw new Error("Square did not return a checkout ID, order ID, and URL.");
  }

  return {
    id: paymentLink.id,
    orderId: paymentLink.order_id,
    url,
  };
}

export function squareCheckoutExpectation(plan: SquarePlan): SquareCheckoutExpectation {
  const config = squarePlanConfig(plan);
  return {
    amountMinor: config.amountMinor,
    currency: process.env.SQUARE_CURRENCY?.trim().toUpperCase() || "GBP",
    planVariationId: config.planVariationId,
  };
}

export async function deleteSquarePaymentLink(paymentLinkId: string) {
  try {
    await squareRequest(`/v2/online-checkout/payment-links/${encodeURIComponent(paymentLinkId)}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (!isSquareNotFoundError(error)) throw error;
  }
}

export async function retrieveSquarePaymentLink(paymentLinkId: string) {
  try {
    const response = await squareRequest<SquarePaymentLinkResponse>(
      `/v2/online-checkout/payment-links/${encodeURIComponent(paymentLinkId)}`,
    );
    return response.payment_link ?? null;
  } catch (error) {
    if (isSquareNotFoundError(error)) return null;
    throw error;
  }
}

export async function retrieveSquareOrder(orderId: string) {
  const response = await squareRequest<SquareOrderResponse>(`/v2/orders/${encodeURIComponent(orderId)}`);
  return response.order ?? null;
}

function squarePlanConfig(plan: SquarePlan) {
  const planVariationId =
    plan === "yearly"
      ? process.env.SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID?.trim()
      : process.env.SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID?.trim();
  const amountMinor =
    plan === "yearly"
      ? positiveInteger(process.env.SQUARE_PLUS_YEARLY_AMOUNT_MINOR, 1999)
      : positiveInteger(process.env.SQUARE_PLUS_MONTHLY_AMOUNT_MINOR, 249);

  if (!planVariationId) {
    throw new BillingConfigError(`Missing Square ${plan} Plus plan variation ID.`);
  }

  return {
    amountMinor,
    planVariationId,
  };
}

function squareLocationId() {
  const locationId = process.env.SQUARE_LOCATION_ID?.trim();

  if (!locationId) {
    throw new BillingConfigError("Square location ID is not configured.");
  }

  return locationId;
}

async function squareRequest<T>(path: string, bodyOrOptions?: unknown | SquareRequestOptions) {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim();
  const options = squareRequestOptions(bodyOrOptions);

  if (!accessToken) {
    throw new BillingConfigError("Square is not configured.");
  }

  const response = await fetchWithPolicy(`${squareApiBaseUrl()}${path}`, {
    method: options.method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "square-version": process.env.SQUARE_VERSION?.trim() || "2026-05-20",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  }, {
    provider: "Square",
    retryAttempts: positiveInteger(process.env.SQUARE_RETRY_ATTEMPTS, 2),
    retryWaitMs: positiveInteger(process.env.SQUARE_RETRY_WAIT_MS, 400),
    timeoutMs: positiveInteger(process.env.SQUARE_REQUEST_TIMEOUT_MS, 10_000),
  });
  const data = (await response.json().catch(() => ({}))) as T & { errors?: SquareApiError[] };

  if (!response.ok) {
    throw new SquareApiRequestError(
      squareErrorMessage(data.errors) ?? `Square request failed with ${response.status}.`,
      response.status,
      data.errors,
    );
  }

  return data;
}

function squareRequestOptions(bodyOrOptions?: unknown | SquareRequestOptions) {
  if (isSquareRequestOptions(bodyOrOptions)) {
    return {
      body: bodyOrOptions.body,
      method: bodyOrOptions.method ?? (bodyOrOptions.body ? "POST" : "GET"),
    };
  }

  return {
    body: bodyOrOptions,
    method: bodyOrOptions ? "POST" : "GET",
  };
}

function isSquareRequestOptions(value: unknown): value is SquareRequestOptions {
  return Boolean(
    value &&
    typeof value === "object" &&
    ("method" in value || "body" in value),
  );
}

class SquareApiRequestError extends Error {
  errors?: SquareApiError[];
  status: number;

  constructor(message: string, status: number, errors?: SquareApiError[]) {
    super(message);
    this.errors = errors;
    this.name = "SquareApiRequestError";
    this.status = status;
  }
}

function squareApiBaseUrl() {
  return process.env.SQUARE_ENVIRONMENT?.trim().toLowerCase() === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

function squareErrorMessage(errors?: SquareApiError[]) {
  return errors
    ?.map((error) => error.detail || error.code)
    .filter(Boolean)
    .join(" ");
}

function isSquareNotFoundError(error: unknown) {
  return (
    error instanceof SquareApiRequestError &&
    (error.status === 404 || error.errors?.some((entry) => entry.code === "NOT_FOUND"))
  );
}

function positiveInteger(value: string | undefined, fallback: number) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
