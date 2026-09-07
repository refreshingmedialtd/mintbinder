import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BillingWebhookStatus } from "@prisma/client";
import { processBillingWebhookEvent } from "../src/lib/billing/webhook-events.ts";
import {
  BILLING_WEBHOOK_RESOURCE_ID_MAX_LENGTH,
  billingWebhookResourceIdFromSquareEvent,
  billingWebhookResourceIdFromStripeEvent,
  boundedBillingWebhookResourceId,
} from "../src/lib/billing/webhook-resource.ts";

const projectRoot = new URL("../", import.meta.url);

test("extracts exact Square payment and subscription resource IDs", () => {
  assert.equal(billingWebhookResourceIdFromSquareEvent({
    type: "payment.created",
    data: { id: "data-payment", object: { payment: { id: "payment-123" } } },
  }), "payment-123");
  assert.equal(billingWebhookResourceIdFromSquareEvent({
    type: "payment.updated",
    data: { id: "data-payment", object: { id: "direct-payment" } },
  }), "direct-payment");
  assert.equal(billingWebhookResourceIdFromSquareEvent({
    type: "subscription.created",
    data: { id: "data-subscription", object: { subscription: { id: "subscription-123" } } },
  }), "subscription-123");
  assert.equal(billingWebhookResourceIdFromSquareEvent({
    type: "subscription.updated",
    data: { id: "data-subscription", object: {} },
  }), "data-subscription");
});

test("binds a Square paid invoice to its exact subscription, with invoice and data fallbacks", () => {
  assert.equal(billingWebhookResourceIdFromSquareEvent({
    type: "invoice.payment_made",
    data: {
      id: "data-invoice",
      object: { invoice: { id: "invoice-123", subscription_id: "subscription-123" } },
    },
  }), "subscription-123");
  assert.equal(billingWebhookResourceIdFromSquareEvent({
    type: "invoice.payment_made",
    data: { id: "data-invoice", object: { invoice: { id: "invoice-123" } } },
  }), "invoice-123");
  assert.equal(billingWebhookResourceIdFromSquareEvent({
    type: "invoice.payment_made",
    data: { id: "data-invoice", object: {} },
  }), "data-invoice");
});

test("extracts a useful Stripe subscription or provider object ID", () => {
  assert.equal(billingWebhookResourceIdFromStripeEvent({
    id: "event-1",
    type: "checkout.session.completed",
    data: { object: { id: "checkout-1", subscription: { id: "subscription-1" } } },
  }), "subscription-1");
  assert.equal(billingWebhookResourceIdFromStripeEvent({
    id: "event-2",
    type: "invoice.paid",
    data: {
      object: {
        id: "invoice-1",
        parent: { subscription_details: { subscription: "subscription-2" } },
      },
    },
  }), "subscription-2");
  assert.equal(billingWebhookResourceIdFromStripeEvent({
    id: "event-3",
    type: "customer.subscription.updated",
    data: { object: { id: "subscription-3" } },
  }), "subscription-3");
});

test("normalizes and bounds optional provider resource IDs", () => {
  assert.equal(boundedBillingWebhookResourceId(undefined), null);
  assert.equal(boundedBillingWebhookResourceId("   "), null);
  assert.equal(boundedBillingWebhookResourceId(" payment-1 "), "payment-1");
  assert.equal(
    boundedBillingWebhookResourceId("x".repeat(BILLING_WEBHOOK_RESOURCE_ID_MAX_LENGTH + 20)),
    "x".repeat(BILLING_WEBHOOK_RESOURCE_ID_MAX_LENGTH),
  );
});

test("persists the resource binding on initial claim and successful completion", async () => {
  const calls = [];
  const client = webhookClient({ calls });

  const result = await processBillingWebhookEvent({
    eventId: " event-1 ",
    eventType: "payment.updated",
    provider: "square",
    resourceId: " payment-1 ",
    fulfill: async () => ({ handled: true }),
  }, client);

  assert.deepEqual(result, { duplicate: false, result: { handled: true } });
  assert.equal(calls[0].method, "findUnique");
  assert.deepEqual(calls[1], {
    method: "create",
    args: {
      data: {
        provider: "square",
        providerEventId: "event-1",
        resourceId: "payment-1",
        eventType: "payment.updated",
        occurredAt: undefined,
      },
    },
  });
  assert.equal(calls[2].method, "update");
  assert.equal(calls[2].args.data.status, BillingWebhookStatus.SUCCEEDED);
});

test("preserves and enforces an event's original provider resource binding", async () => {
  const existing = {
    id: "database-event-1",
    provider: "square",
    providerEventId: "event-1",
    resourceId: "payment-original",
    eventType: "payment.updated",
    status: BillingWebhookStatus.SUCCEEDED,
    occurredAt: null,
    processedAt: new Date(),
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  let fulfilled = false;

  await assert.rejects(
    processBillingWebhookEvent({
      eventId: "event-1",
      eventType: "payment.updated",
      provider: "square",
      resourceId: "payment-different",
      fulfill: async () => {
        fulfilled = true;
      },
    }, webhookClient({ existing })),
    /resource ID does not match its original claim/,
  );
  assert.equal(fulfilled, false);
});

test("safely enriches a legacy successful event whose resource binding is null", async () => {
  const calls = [];
  const existing = {
    id: "database-event-legacy",
    provider: "square",
    providerEventId: "event-legacy",
    resourceId: null,
    eventType: "payment.updated",
    status: BillingWebhookStatus.SUCCEEDED,
    occurredAt: null,
    processedAt: new Date(),
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await processBillingWebhookEvent({
    eventId: "event-legacy",
    eventType: "payment.updated",
    provider: "square",
    resourceId: "payment-legacy",
    fulfill: async () => assert.fail("A completed duplicate must not be fulfilled again."),
  }, webhookClient({ calls, existing }));

  assert.deepEqual(result, { duplicate: true, inProgress: false });
  const enrichment = calls.find((call) => call.method === "updateMany");
  assert.deepEqual(enrichment?.args, {
    where: { id: "database-event-legacy", resourceId: null },
    data: { resourceId: "payment-legacy" },
  });
});

test("persists the binding while atomically reclaiming a failed event", async () => {
  const calls = [];
  const existing = {
    id: "database-event-failed",
    provider: "square",
    providerEventId: "event-failed",
    resourceId: null,
    eventType: "payment.created",
    status: BillingWebhookStatus.FAILED,
    occurredAt: null,
    processedAt: new Date(),
    errorMessage: "Temporary reconciliation failure.",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await processBillingWebhookEvent({
    eventId: "event-failed",
    eventType: "payment.updated",
    provider: "square",
    resourceId: "payment-retried",
    fulfill: async () => ({ handled: true }),
  }, webhookClient({ calls, existing }));

  assert.deepEqual(result, { duplicate: false, result: { handled: true } });
  const reclaim = calls.find((call) => call.method === "updateMany");
  assert.equal(reclaim?.args.data.resourceId, "payment-retried");
  assert.equal(reclaim?.args.data.status, BillingWebhookStatus.PROCESSING);
  assert.equal(reclaim?.args.data.eventType, "payment.updated");
});

test("schema and migration add a nullable indexed provider resource binding", async () => {
  const [schema, migration, route] = await Promise.all([
    readFile(new URL("prisma/schema.prisma", projectRoot), "utf8"),
    readFile(new URL(
      "prisma/migrations/20260907120000_add_billing_webhook_resource_id/migration.sql",
      projectRoot,
    ), "utf8"),
    readFile(new URL("src/lib/billing/webhook-route.ts", projectRoot), "utf8"),
  ]);

  assert.match(schema, /resourceId\s+String\?\s+@map\("provider_resource_id"\)/);
  assert.match(schema, /@@index\(\[provider, resourceId, eventType\], map: "billing_webhook_provider_resource_type_idx"\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "provider_resource_id" TEXT;/);
  assert.doesNotMatch(migration, /provider_resource_id"\s+TEXT\s+NOT NULL/i);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "billing_webhook_provider_resource_type_idx"/);
  assert.equal((route.match(/resourceId: billingWebhookResourceIdFromSquareEvent\(event\)/g) ?? []).length, 1);
  assert.equal((route.match(/resourceId: billingWebhookResourceIdFromStripeEvent\(event\)/g) ?? []).length, 1);
});

function webhookClient({ calls = [], existing = null } = {}) {
  return {
    billingWebhookEvent: {
      async findUnique(args) {
        calls.push({ method: "findUnique", args });
        return existing;
      },
      async create(args) {
        calls.push({ method: "create", args });
        return { id: "created-event", ...args.data };
      },
      async update(args) {
        calls.push({ method: "update", args });
        return { id: "updated-event", ...args.data };
      },
      async updateMany(args) {
        calls.push({ method: "updateMany", args });
        return { count: 1 };
      },
    },
  };
}
