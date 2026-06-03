import "dotenv/config";
import { randomUUID } from "node:crypto";

const squareVersion = process.env.SQUARE_VERSION?.trim() || "2026-05-20";
const planName = process.env.SQUARE_PLUS_PLAN_NAME?.trim() || "PokeStop Plus";
const monthlyVariationName = process.env.SQUARE_PLUS_MONTHLY_VARIATION_NAME?.trim() || "PokeStop Plus Monthly";
const yearlyVariationName = process.env.SQUARE_PLUS_YEARLY_VARIATION_NAME?.trim() || "PokeStop Plus Yearly";
const currency = process.env.SQUARE_CURRENCY?.trim() || "GBP";
const monthlyAmountMinor = positiveInteger(process.env.SQUARE_PLUS_MONTHLY_AMOUNT_MINOR, 249);
const yearlyAmountMinor = positiveInteger(process.env.SQUARE_PLUS_YEARLY_AMOUNT_MINOR, 1999);

const existingObjects = await listSubscriptionCatalogObjects();
const plan = findPlan(existingObjects) ?? await createSubscriptionPlan();
const refreshedObjects = plan.version ? existingObjects : await listSubscriptionCatalogObjects();
const monthlyVariation =
  findVariation(refreshedObjects, monthlyVariationName, monthlyAmountMinor, "MONTHLY") ??
  await createSubscriptionPlanVariation({
    amountMinor: monthlyAmountMinor,
    cadence: "MONTHLY",
    name: monthlyVariationName,
    planId: plan.id,
  });
const yearlyVariation =
  findVariation(refreshedObjects, yearlyVariationName, yearlyAmountMinor, "ANNUAL") ??
  await createSubscriptionPlanVariation({
    amountMinor: yearlyAmountMinor,
    cadence: "ANNUAL",
    name: yearlyVariationName,
    planId: plan.id,
  });

console.log(JSON.stringify({
  currency,
  monthly: {
    amountMinor: monthlyAmountMinor,
    id: monthlyVariation.id,
    name: monthlyVariationName,
  },
  plan: {
    id: plan.id,
    name: planName,
  },
  yearly: {
    amountMinor: yearlyAmountMinor,
    id: yearlyVariation.id,
    name: yearlyVariationName,
  },
}, null, 2));

console.log("\nAdd these to .env:");
console.log(`SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID="${monthlyVariation.id}"`);
console.log(`SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID="${yearlyVariation.id}"`);

async function createSubscriptionPlan() {
  const body = {
    idempotency_key: randomUUID(),
    object: {
      id: "#pokestop-plus-plan",
      present_at_all_locations: true,
      subscription_plan_data: {
        all_items: true,
        name: planName,
      },
      type: "SUBSCRIPTION_PLAN",
    },
  };
  const response = await squareRequest("/v2/catalog/object", { body, method: "POST" });

  return response.catalog_object;
}

async function createSubscriptionPlanVariation({ amountMinor, cadence, name, planId }) {
  const body = {
    idempotency_key: randomUUID(),
    object: {
      id: `#${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      present_at_all_locations: true,
      subscription_plan_variation_data: {
        name,
        phases: [
          {
            cadence,
            pricing: {
              price_money: {
                amount: amountMinor,
                currency,
              },
              type: "STATIC",
            },
          },
        ],
        subscription_plan_id: planId,
      },
      type: "SUBSCRIPTION_PLAN_VARIATION",
    },
  };
  const response = await squareRequest("/v2/catalog/object", { body, method: "POST" });

  return response.catalog_object;
}

async function listSubscriptionCatalogObjects() {
  const response = await squareRequest(
    "/v2/catalog/list?types=SUBSCRIPTION_PLAN,SUBSCRIPTION_PLAN_VARIATION",
    { method: "GET" },
  );

  return response.objects ?? [];
}

async function squareRequest(path, { body, method }) {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim();

  if (!accessToken) {
    throw new Error("SQUARE_ACCESS_TOKEN must be set before creating Square subscription plans.");
  }

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

function findPlan(objects) {
  return objects.find((object) =>
    object.type === "SUBSCRIPTION_PLAN" &&
    object.subscription_plan_data?.name === planName
  );
}

function findVariation(objects, name, amountMinor, cadence) {
  return objects.find((object) => {
    const phase = object.subscription_plan_variation_data?.phases?.[0];
    const pricing = phase?.pricing;

    return (
      object.type === "SUBSCRIPTION_PLAN_VARIATION" &&
      object.subscription_plan_variation_data?.name === name &&
      phase?.cadence === cadence &&
      pricing?.type === "STATIC" &&
      pricing?.price_money?.amount === amountMinor &&
      pricing?.price_money?.currency === currency
    );
  });
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
