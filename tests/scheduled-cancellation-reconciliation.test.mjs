import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderSubscriptionStillActiveError,
  providerSubscriptionBlocksCheckout,
  reconcileExpiredScheduledCancellations,
  scheduledCancellationNeedsProviderTruth,
} from "../src/lib/billing/scheduled-cancellation-reconciliation.ts";

const END = new Date("2026-08-24T12:00:00.000Z");

test("scheduled cancellation crosses into provider reconciliation exactly at period end", () => {
  const input = { cancelAtPeriodEnd: true, currentPeriodEnd: END };
  assert.equal(scheduledCancellationNeedsProviderTruth({ ...input, now: new Date(END.getTime() - 1) }), false);
  assert.equal(scheduledCancellationNeedsProviderTruth({ ...input, now: END }), true);
  assert.equal(scheduledCancellationNeedsProviderTruth({ ...input, now: new Date(END.getTime() + 1) }), true);
  assert.equal(scheduledCancellationNeedsProviderTruth({ ...input, cancelAtPeriodEnd: false, now: END }), false);
});

test("provider status decisions fail closed and distinguish terminal truth", () => {
  assert.equal(providerSubscriptionBlocksCheckout("square", "ACTIVE"), true);
  assert.equal(providerSubscriptionBlocksCheckout("square", "CANCELED"), false);
  assert.equal(providerSubscriptionBlocksCheckout("square", "COMPLETED"), false);
  assert.equal(providerSubscriptionBlocksCheckout("stripe", "active"), true);
  assert.equal(providerSubscriptionBlocksCheckout("stripe", "canceled"), false);
  assert.equal(providerSubscriptionBlocksCheckout("stripe", undefined), true);
});

test("active provider truth is synced and blocks a replacement checkout", async () => {
  const calls = [];
  const providers = providerDouble({ squareStatus: "ACTIVE", calls });
  await assert.rejects(
    reconcileExpiredScheduledCancellations({
      now: END,
      prisma: subscriptionStore([{ id: "local-1", provider: "square", providerSubscriptionId: "sq-1" }]),
      providers,
      userId: "user-1",
    }),
    ProviderSubscriptionStillActiveError,
  );
  assert.deepEqual(calls, ["retrieve-square:sq-1", "sync-square:ACTIVE"]);
});

test("terminal provider truth is synced and permits a replacement checkout", async () => {
  for (const [provider, terminalStatus] of [["square", "CANCELED"], ["stripe", "canceled"]]) {
    const calls = [];
    const result = await reconcileExpiredScheduledCancellations({
      now: END,
      prisma: subscriptionStore([{ id: `local-${provider}`, provider, providerSubscriptionId: `${provider}-1` }]),
      providers: providerDouble({ calls, squareStatus: terminalStatus, stripeStatus: terminalStatus }),
      userId: "user-1",
    });
    assert.equal(result.reconciled, 1);
    assert.equal(calls.at(-1), `sync-${provider}:${terminalStatus}`);
  }
});

function subscriptionStore(rows) {
  return {
    subscription: {
      async findMany(args) {
        assert.equal(args.where.currentPeriodEnd.lte, END);
        assert.equal(args.where.userId, "user-1");
        return rows;
      },
    },
  };
}

function providerDouble({ calls, squareStatus = "CANCELED", stripeStatus = "canceled" }) {
  return {
    async retrieveSquare(id) {
      calls.push(`retrieve-square:${id}`);
      return { customer_id: "customer-1", id, status: squareStatus };
    },
    async retrieveStripe(id) {
      calls.push(`retrieve-stripe:${id}`);
      return { customer: "customer-1", id, status: stripeStatus };
    },
    async syncSquare(subscription) {
      calls.push(`sync-square:${subscription.status}`);
    },
    async syncStripe(subscription) {
      calls.push(`sync-stripe:${subscription.status}`);
    },
  };
}
