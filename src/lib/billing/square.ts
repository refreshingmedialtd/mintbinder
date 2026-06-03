import { randomUUID } from "node:crypto";
import { BillingConfigError } from "@/lib/billing/errors";

type SquarePlan = "monthly" | "yearly";

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
    url?: string;
  };
};

type SquareRequestOptions = {
  body?: unknown;
  method?: "GET" | "POST" | "PUT";
};

type SquareSubscriptionResponse = {
  errors?: SquareApiError[];
  subscription?: SquareSubscriptionRecord;
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

export async function createSquareCustomer({
  email,
  name,
  userId,
}: {
  email?: string | null;
  name?: string | null;
  userId: string;
}) {
  const body: Record<string, unknown> = {
    idempotency_key: randomUUID(),
    note: "PokeStop subscription customer",
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

export async function retrieveSquareSubscription(subscriptionId: string) {
  const response = await squareRequest<SquareSubscriptionResponse>(`/v2/subscriptions/${subscriptionId}`);

  return response.subscription ?? null;
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

export async function createSquareSubscriptionCheckout({
  customerId,
  email,
  origin,
  plan,
  userId,
}: {
  customerId: string;
  email?: string | null;
  origin: string;
  plan: SquarePlan;
  userId: string;
}) {
  const config = squarePlanConfig(plan);
  const body = {
    checkout_options: {
      redirect_url: `${origin}/?billing=success&provider=square&plan=${plan}`,
      subscription_plan_id: config.planVariationId,
    },
    idempotency_key: randomUUID(),
    payment_note: `pokestop_user=${userId};square_customer=${customerId};plan=${plan}`,
    pre_populated_data: {
      buyer_email: email ?? undefined,
    },
    quick_pay: {
      location_id: squareLocationId(),
      name: `PokeStop Plus ${plan === "yearly" ? "Yearly" : "Monthly"}`,
      price_money: {
        amount: config.amountMinor,
        currency: process.env.SQUARE_CURRENCY?.trim() || "GBP",
      },
    },
  };
  const response = await squareRequest<SquarePaymentLinkResponse>("/v2/online-checkout/payment-links", body);
  const paymentLink = response.payment_link;
  const url = paymentLink?.url ?? paymentLink?.long_url;

  if (!url) {
    throw new Error("Square did not return a checkout URL.");
  }

  return {
    id: paymentLink?.id,
    url,
  };
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

  const response = await fetch(`${squareApiBaseUrl()}${path}`, {
    method: options.method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "square-version": process.env.SQUARE_VERSION?.trim() || "2026-05-20",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
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
