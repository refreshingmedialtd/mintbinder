import assert from "node:assert/strict";
import test from "node:test";
import { BillingCustomerProvenance, SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { BillingAccountDeletionError } from "../src/lib/billing/checkout-lock.ts";
import { checkoutPreparationCanBeReclaimed } from "../src/lib/billing/checkout-intent-state.ts";
import {
  BillingCustomerOwnershipError,
  claimBillingCustomerOwnership,
} from "../src/lib/billing/customer-ownership.ts";
import {
  billingCustomerCreationIdempotencyKey,
  establishDurableProviderCustomer,
} from "../src/lib/billing/customer-creation.ts";
import {
  selectSquareCancellationTarget,
  selectSquarePaymentActivationTarget,
  selectSquareTerminalCustomerRowsToDetach,
} from "../src/lib/billing/subscription-selection.ts";
import { decideCheckoutCompletion } from "../src/lib/billing/checkout-completion.ts";
import {
  recoverStripeCheckoutAfterResponseLoss,
  stripeCheckoutReplayIsSafe,
  stripeCheckoutSessionMatchesIntent,
} from "../src/lib/billing/stripe-checkout-recovery.ts";

test("an existing provider customer can only be claimed by its Mint Binder owner", async () => {
  const client = customerClient({
    provider: "square",
    providerCustomerId: "customer-1",
    provenance: BillingCustomerProvenance.PROVIDER_MATCHED,
    userId: "user-1",
  });

  const owned = await claimBillingCustomerOwnership({
    client,
    customerId: "customer-1",
    provider: "square",
    userId: "user-1",
  });
  assert.equal(owned.userId, "user-1");
  await assert.rejects(
    claimBillingCustomerOwnership({
      client,
      customerId: "customer-1",
      provider: "square",
      userId: "user-2",
    }),
    BillingCustomerOwnershipError,
  );
  assert.equal(client.creates, 0);
});

test("a newly created provider customer records app-created provenance", async () => {
  const client = customerClient(null);
  const owned = await claimBillingCustomerOwnership({
    client,
    customerId: "customer-new",
    provenance: BillingCustomerProvenance.APP_CREATED,
    provider: "square",
    userId: "user-1",
  });

  assert.equal(owned.provenance, BillingCustomerProvenance.APP_CREATED);
  assert.equal(client.creates, 1);
});

test("the deletion fence wins before a delayed ownership claim can commit", async () => {
  let releaseLock;
  const lockReached = Promise.withResolvers();
  const lockRelease = new Promise((resolve) => { releaseLock = resolve; });
  const client = customerClient(null, {
    onLock: async () => {
      lockReached.resolve();
      await lockRelease;
    },
  });

  const claim = claimBillingCustomerOwnership({
    client,
    customerId: "customer-racing-deletion",
    provenance: BillingCustomerProvenance.APP_CREATED,
    provider: "square",
    userId: "user-1",
  });
  await lockReached.promise;
  client.deletionRequestedAt = new Date();
  releaseLock();

  await assert.rejects(claim, BillingAccountDeletionError);
  assert.equal(client.creates, 0);
});

test("provider reconciliation crosses a deletion fence only for an unresolved pre-fence checkout", async () => {
  const blocked = customerClient(null, { deletionRequestedAt: new Date() });
  await assert.rejects(
    claimBillingCustomerOwnership({
      allowDuringDeletion: true,
      client: blocked,
      customerId: "customer-no-live-intent",
      provider: "square",
      userId: "user-1",
    }),
    BillingAccountDeletionError,
  );

  const reconciling = customerClient(null, {
    deletionRequestedAt: new Date(),
    unresolvedCheckout: true,
  });
  const owned = await claimBillingCustomerOwnership({
    allowDuringDeletion: true,
    client: reconciling,
    customerId: "customer-live-intent",
    provider: "square",
    userId: "user-1",
  });
  assert.equal(owned.userId, "user-1");
});

test("customer creation retries one remote object after a response-loss/database failure", async () => {
  const checkoutKey = "11111111-1111-4111-8111-111111111111";
  const key = billingCustomerCreationIdempotencyKey("square", checkoutKey);
  const remoteByKey = new Map();
  let remoteCreates = 0;
  let finalizations = 0;
  let compensations = 0;
  const create = async () => {
    if (!remoteByKey.has(key)) {
      remoteCreates += 1;
      remoteByKey.set(key, { id: "customer-durable" });
    }
    return remoteByKey.get(key);
  };
  const finalize = async (customer) => {
    finalizations += 1;
    if (finalizations === 1) throw new Error("database response lost");
    return { customerId: customer.id, discardCreated: false };
  };
  const run = () => establishDurableProviderCustomer({
    compensate: async () => { compensations += 1; },
    create,
    finalize,
    shouldCompensate: (error) => error instanceof BillingAccountDeletionError,
  });

  await assert.rejects(run(), /database response lost/);
  assert.equal(await run(), "customer-durable");
  assert.equal(remoteCreates, 1);
  assert.equal(compensations, 0);
  assert.equal(key.length <= 45, true);
  assert.notEqual(key, billingCustomerCreationIdempotencyKey("stripe", checkoutKey));
});

test("a fenced customer creation is compensated immediately", async () => {
  let compensations = 0;
  await assert.rejects(
    establishDurableProviderCustomer({
      compensate: async (customerId) => {
        assert.equal(customerId, "customer-fenced");
        compensations += 1;
      },
      create: async () => ({ id: "customer-fenced" }),
      finalize: async () => { throw new BillingAccountDeletionError(); },
      shouldCompensate: (error) => error instanceof BillingAccountDeletionError,
    }),
    BillingAccountDeletionError,
  );
  assert.equal(compensations, 1);
});

test("a paid checkout awaiting its subscription is never lease-reclaimed", () => {
  const now = new Date("2026-08-24T13:00:00.000Z");
  const updatedAt = new Date("2026-08-24T12:00:00.000Z");
  assert.equal(checkoutPreparationCanBeReclaimed({
    leaseMs: 15_000,
    now,
    status: "paid_pending_subscription",
    updatedAt,
  }), false);
  assert.equal(checkoutPreparationCanBeReclaimed({
    leaseMs: 15_000,
    now,
    status: "creating",
    updatedAt,
  }), true);
});

test("delayed concurrent checkout completions share one provider object without retiring it", async () => {
  const remoteByKey = new Map();
  let remoteCreates = 0;
  let retirements = 0;
  const providerCreate = async (key) => {
    if (!remoteByKey.has(key)) {
      remoteCreates += 1;
      remoteByKey.set(key, { id: "checkout-shared", url: "https://provider.test/shared" });
    }
    return remoteByKey.get(key);
  };
  const inputFor = (leaseToken, checkout) => ({
    leaseToken,
    providerCheckoutId: checkout.id,
    url: checkout.url,
  });
  const firstProviderResult = await providerCreate("intent-key");
  const secondProviderResult = await providerCreate("intent-key");
  const reclaimedRow = {
    checkoutUrl: null,
    leaseToken: "generation-b",
    providerCheckoutId: null,
    providerOrderId: null,
    status: "creating",
  };
  const winner = decideCheckoutCompletion(reclaimedRow, inputFor("generation-b", secondProviderResult));
  assert.deepEqual(winner, { kind: "publish", url: secondProviderResult.url });
  const readyRow = {
    ...reclaimedRow,
    checkoutUrl: winner.url,
    providerCheckoutId: secondProviderResult.id,
    status: "ready",
  };
  const delayedLoser = decideCheckoutCompletion(readyRow, inputFor("generation-a", firstProviderResult));
  if (delayedLoser.kind === "retire") retirements += 1;

  assert.deepEqual(delayedLoser, { kind: "reuse", url: firstProviderResult.url });
  assert.equal(remoteCreates, 1);
  assert.equal(retirements, 0);
});

test("checkout completion retires only a fenced or terminally owned provider result", () => {
  const input = {
    leaseToken: "generation-a",
    providerCheckoutId: "checkout-1",
    url: "https://provider.test/checkout-1",
  };
  const base = {
    checkoutUrl: null,
    leaseToken: "generation-a",
    providerCheckoutId: null,
    providerOrderId: null,
  };

  assert.deepEqual(decideCheckoutCompletion({
    ...base,
    deletionRequestedAt: new Date(),
    status: "creating",
  }, input), { kind: "retire" });
  assert.deepEqual(decideCheckoutCompletion({
    ...base,
    deletionRequestedAt: new Date(),
    status: "paid_pending_subscription",
  }, input), { kind: "reconciled" });
  assert.deepEqual(decideCheckoutCompletion({
    ...base,
    status: "completed",
  }, input), { kind: "reconciled" });
});

test("Stripe response-loss recovery matches exact intent metadata and stays inside idempotency safety", () => {
  const session = {
    customer: "cus_1",
    id: "cs_1",
    metadata: { checkout_intent_id: "intent-1" },
  };
  assert.equal(stripeCheckoutSessionMatchesIntent(session, "intent-1", "cus_1"), true);
  assert.equal(stripeCheckoutSessionMatchesIntent(session, "intent-other", "cus_1"), false);
  assert.equal(stripeCheckoutSessionMatchesIntent(session, "intent-1", "cus_other"), false);

  const now = new Date("2026-08-24T12:00:00.000Z");
  assert.equal(stripeCheckoutReplayIsSafe({
    createdAt: new Date("2026-08-23T13:00:01.000Z"),
    maxAgeMs: 23 * 60 * 60 * 1000,
    now,
  }), true);
  assert.equal(stripeCheckoutReplayIsSafe({
    createdAt: new Date("2026-08-23T12:59:59.000Z"),
    maxAgeMs: 23 * 60 * 60 * 1000,
    now,
  }), false);
});

test("an account-deletion retry recovers and expires one Stripe session after response loss", async () => {
  const sessionsByKey = new Map();
  let remoteCreates = 0;
  let expirations = 0;
  const replay = async () => {
    if (!sessionsByKey.has("durable-intent-key")) {
      remoteCreates += 1;
      sessionsByKey.set("durable-intent-key", {
        customer: "cus_delete",
        id: "cs_delete",
        metadata: { checkout_intent_id: "intent-delete" },
        status: "open",
      });
    }
    return sessionsByKey.get("durable-intent-key");
  };
  const first = await recoverStripeCheckoutAfterResponseLoss({
    checkoutIntentId: "intent-delete",
    createdAt: new Date("2026-08-24T11:00:00.000Z"),
    customerId: "cus_delete",
    findExact: async () => null,
    maxAgeMs: 23 * 60 * 60 * 1000,
    now: new Date("2026-08-24T12:00:00.000Z"),
    replay,
  });
  // Simulate loss of the first application response before its provider ID was
  // stored. DELETE retries by searching exact durable metadata first.
  const retry = await recoverStripeCheckoutAfterResponseLoss({
    checkoutIntentId: "intent-delete",
    createdAt: new Date("2026-08-24T11:00:00.000Z"),
    customerId: "cus_delete",
    findExact: async () => sessionsByKey.get("durable-intent-key"),
    maxAgeMs: 23 * 60 * 60 * 1000,
    now: new Date("2026-08-24T12:01:00.000Z"),
    replay,
  });
  if (retry.session.status === "open") {
    retry.session.status = "expired";
    expirations += 1;
  }

  assert.equal(first.session.id, retry.session.id);
  assert.equal(retry.replayed, false);
  assert.equal(remoteCreates, 1);
  assert.equal(expirations, 1);
});

test("subscription-before-payment reuses the exact effective row and cancellation prefers its provider ID", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  const rowFromSubscriptionEvent = subscriptionCandidate({
    id: "subscription-row",
    providerSubscriptionId: "square-subscription-1",
  });
  const stalePaymentPlaceholder = subscriptionCandidate({
    id: "payment-placeholder",
    providerSubscriptionId: null,
    updatedAt: new Date("2026-08-24T12:01:00.000Z"),
  });

  const activation = selectSquarePaymentActivationTarget(
    [rowFromSubscriptionEvent],
    SubscriptionPlan.PLUS_MONTHLY,
    now,
  );
  assert.equal(activation?.id, "subscription-row");
  assert.equal(activation?.providerSubscriptionId, "square-subscription-1");

  const cancellation = selectSquareCancellationTarget(
    [stalePaymentPlaceholder, rowFromSubscriptionEvent],
    now,
  );
  assert.equal(cancellation?.id, "subscription-row");
  assert.equal(cancellation?.providerSubscriptionId, "square-subscription-1");
});

test("a new Square payment never reactivates a canceled provider subscription ID", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  const oldCanceled = subscriptionCandidate({
    currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
    id: "old-canceled",
    providerSubscriptionId: "square-old-subscription",
    status: SubscriptionStatus.CANCELED,
  });

  assert.equal(
    selectSquarePaymentActivationTarget([oldCanceled], SubscriptionPlan.PLUS_MONTHLY, now),
    null,
  );
  assert.deepEqual(
    selectSquareTerminalCustomerRowsToDetach([oldCanceled]).map((candidate) => candidate.id),
    ["old-canceled"],
  );

  const newSubscription = subscriptionCandidate({
    id: "new-subscription",
    providerSubscriptionId: "square-new-subscription",
  });
  const cancellation = selectSquareCancellationTarget([newSubscription, oldCanceled], now);
  assert.equal(cancellation?.id, "new-subscription");
  assert.equal(cancellation?.providerSubscriptionId, "square-new-subscription");
});

function subscriptionCandidate(overrides = {}) {
  return {
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date("2026-09-24T12:00:00.000Z"),
    id: "row",
    plan: SubscriptionPlan.PLUS_MONTHLY,
    providerSubscriptionId: null,
    status: SubscriptionStatus.ACTIVE,
    updatedAt: new Date("2026-08-24T12:00:00.000Z"),
    ...overrides,
  };
}

function customerClient(initial, options = {}) {
  let row = initial;
  const client = {
    creates: 0,
    deletionRequestedAt: options.deletionRequestedAt ?? null,
    async $executeRaw() {
      await options.onLock?.();
      return 1;
    },
    billingCheckoutIntent: {
      async findFirst() {
        return options.unresolvedCheckout ? { id: "intent-live" } : null;
      },
    },
    billingCustomer: {
      async findUnique() {
        return row;
      },
      async create({ data }) {
        client.creates += 1;
        row = { id: "ownership-1", ...data };
        return row;
      },
    },
    user: {
      async findUnique() {
        return { deletionRequestedAt: client.deletionRequestedAt };
      },
    },
  };
  return client;
}
