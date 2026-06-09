import "dotenv/config";
import { randomUUID } from "node:crypto";

const squareVersion = process.env.SQUARE_VERSION?.trim() || "2026-05-20";
const currency = process.env.SQUARE_CURRENCY?.trim() || "GBP";
const plan = process.env.SQUARE_BILLING_SMOKE_PLAN?.trim().toLowerCase() === "yearly" ? "yearly" : "monthly";
const monthlyAmountMinor = positiveInteger(process.env.SQUARE_PLUS_MONTHLY_AMOUNT_MINOR, 249);
const yearlyAmountMinor = positiveInteger(process.env.SQUARE_PLUS_YEARLY_AMOUNT_MINOR, 1999);
const smokeEmail = `square-smoke-${Date.now()}@refreshingmedia.co.uk`;
const config = {
  locationId: requiredEnv("SQUARE_LOCATION_ID"),
  monthlyPlanVariationId: requiredEnv("SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID"),
  yearlyPlanVariationId: requiredEnv("SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID"),
};

const [location, variations] = await Promise.all([
  retrieveLocation(config.locationId),
  retrievePlanVariations([
    config.monthlyPlanVariationId,
    config.yearlyPlanVariationId,
  ]),
]);
const monthlyVariation = assertVariation({
  amountMinor: monthlyAmountMinor,
  cadence: "MONTHLY",
  id: config.monthlyPlanVariationId,
  objects: variations,
});
const yearlyVariation = assertVariation({
  amountMinor: yearlyAmountMinor,
  cadence: "ANNUAL",
  id: config.yearlyPlanVariationId,
  objects: variations,
});
const smokeCustomer = await createSmokeCustomer();
const checkout = await createCheckoutLink({
  amountMinor: plan === "yearly" ? yearlyAmountMinor : monthlyAmountMinor,
  customerEmail: smokeEmail,
  customerId: smokeCustomer.id,
  plan,
  planVariationId: plan === "yearly" ? config.yearlyPlanVariationId : config.monthlyPlanVariationId,
});

console.log(JSON.stringify({
  checkout: {
    id: checkout.id,
    plan,
    url: checkout.url,
  },
  customer: {
    id: smokeCustomer.id,
    referenceId: smokeCustomer.referenceId,
  },
  location: {
    businessName: location.business_name,
    id: location.id,
    name: location.name,
  },
  monthly: {
    amountMinor: monthlyAmountMinor,
    cadence: "MONTHLY",
    id: monthlyVariation.id,
    name: monthlyVariation.subscription_plan_variation_data?.name,
  },
  yearly: {
    amountMinor: yearlyAmountMinor,
    cadence: "ANNUAL",
    id: yearlyVariation.id,
    name: yearlyVariation.subscription_plan_variation_data?.name,
  },
}, null, 2));

async function retrieveLocation(locationId) {
  const response = await squareRequest("/v2/locations", { method: "GET" });
  const location = response.locations?.find((entry) => entry.id === locationId);

  if (!location) {
    throw new Error(`Square location ${locationId} was not found for this token.`);
  }

  return location;
}

async function retrievePlanVariations(objectIds) {
  const response = await squareRequest("/v2/catalog/batch-retrieve", {
    body: {
      object_ids: objectIds,
    },
    method: "POST",
  });

  return response.objects ?? [];
}

async function createSmokeCustomer() {
  const referenceId = `mintbinder-square-smoke-${Date.now()}`;
  const response = await squareRequest("/v2/customers", {
    body: {
      email_address: smokeEmail,
      family_name: "Smoke",
      given_name: "Mint Binder",
      idempotency_key: randomUUID(),
      note: "Mint Binder Square billing smoke test customer",
      reference_id: referenceId,
    },
    method: "POST",
  });
  const customer = response.customer;

  if (!customer?.id) {
    throw new Error("Square did not return a smoke customer ID.");
  }

  return {
    email: customer.email_address,
    id: customer.id,
    referenceId: customer.reference_id,
  };
}

async function createCheckoutLink({ amountMinor, customerEmail, customerId, plan, planVariationId }) {
  const response = await squareRequest("/v2/online-checkout/payment-links", {
    body: {
      checkout_options: {
        redirect_url: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000"}/?billing=success&provider=square&plan=${plan}`,
        subscription_plan_id: planVariationId,
      },
      idempotency_key: randomUUID(),
      payment_note: `mintbinder_smoke=true;square_customer=${customerId};plan=${plan}`,
      pre_populated_data: {
        buyer_email: customerEmail,
      },
      quick_pay: {
        location_id: config.locationId,
        name: `Mint Binder Plus ${plan === "yearly" ? "Yearly" : "Monthly"} Smoke`,
        price_money: {
          amount: amountMinor,
          currency,
        },
      },
    },
    method: "POST",
  });
  const paymentLink = response.payment_link;
  const url = paymentLink?.url ?? paymentLink?.long_url;

  if (!url) {
    throw new Error("Square did not return a smoke checkout URL.");
  }

  return {
    id: paymentLink.id,
    url,
  };
}

async function squareRequest(path, { body, method }) {
  const accessToken = requiredEnv("SQUARE_ACCESS_TOKEN");
  const response = await fetch(`${squareApiBaseUrl()}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "square-version": squareVersion,
    },
    method,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(squareErrorMessage(data.errors) ?? `Square request failed with ${response.status}.`);
  }

  return data;
}

function assertVariation({ amountMinor, cadence, id, objects }) {
  const variation = objects.find((object) => object.id === id);
  const phase = variation?.subscription_plan_variation_data?.phases?.[0];
  const price = phase?.pricing?.price_money;

  if (!variation) {
    throw new Error(`Square plan variation ${id} was not found.`);
  }

  if (variation.type !== "SUBSCRIPTION_PLAN_VARIATION" || phase?.cadence !== cadence) {
    throw new Error(`Square plan variation ${id} is not a ${cadence.toLowerCase()} subscription variation.`);
  }

  if (price?.amount !== amountMinor || price?.currency !== currency) {
    throw new Error(`Square plan variation ${id} does not match expected ${currency} ${amountMinor}.`);
  }

  return variation;
}

function requiredEnv(key) {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`${key} must be set before running the Square billing smoke check.`);
  }

  return value;
}

function squareApiBaseUrl() {
  return process.env.SQUARE_ENVIRONMENT?.trim().toLowerCase() === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

function squareErrorMessage(errors) {
  return errors
    ?.map((error) => error.detail || error.code)
    .filter(Boolean)
    .join(" ");
}

function positiveInteger(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
