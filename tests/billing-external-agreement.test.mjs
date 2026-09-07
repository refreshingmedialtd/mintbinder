import assert from "node:assert/strict";
import test from "node:test";
import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import {
  BillingExternalAgreementConflictError,
  externalPaidAgreementBlocksCheckoutWhere,
  lockBillingCheckout,
} from "../src/lib/billing/checkout-lock.ts";
import {
  reconcileProviderSubscriptionTransaction,
} from "../src/lib/billing/provider-subscription-transaction.ts";

const NOW = new Date("2026-09-07T12:00:00.000Z");

test("Stripe and Square completion orders allow exactly one external paid agreement", async (t) => {
  for (const providers of [["stripe", "square"], ["square", "stripe"]]) {
    await t.test(`${providers[0]} wins before ${providers[1]}`, async () => {
      const fixture = subscriptionTransaction();
      const first = await fixture.reconcile(providers[0], { suffix: "winner" });

      assert.equal(first, true);
      assert.equal(fixture.rows.length, 1);
      assert.equal(fixture.rows[0].provider, providers[0]);

      await assert.rejects(
        fixture.reconcile(providers[1], { suffix: "later-paid" }),
        (error) => {
          assert.ok(error instanceof BillingExternalAgreementConflictError);
          assert.match(
            error.message,
            new RegExp(
              `second ${providers[1]} paid agreement.*existing ${providers[0]}.*` +
              "did not change Plus access.*refund.*manually",
              "i",
            ),
          );
          return true;
        },
      );

      assert.equal(fixture.rows.length, 1);
      assert.equal(fixture.rows[0].provider, providers[0]);
      assert.deepEqual(fixture.operations.slice(0, 6), [
        "lock:mintbinder-billing:user-1",
        `find-existing:${providers[0]}:sub-${providers[0]}-winner`,
        `claim:${providers[0]}:customer-${providers[0]}-winner:user-1`,
        "lock:mintbinder-billing:user-1",
        "check-external-agreements:user-1",
        `find-customer-holder:customer-${providers[0]}-winner`,
      ]);
      assert.equal(
        fixture.operations.filter((operation) => operation === "lock:mintbinder-billing:user-1").length,
        4,
      );
      assert.equal(
        fixture.operations.some((operation) => operation.includes(`mintbinder-billing:${providers[0]}`)),
        false,
      );
      assert.equal(
        fixture.operations.some((operation) => operation.includes(`mintbinder-billing:${providers[1]}`)),
        false,
      );
    });
  }
});

test("local, free, and terminal rows do not block a new external paid agreement", async () => {
  const fixture = subscriptionTransaction([
    subscription({ id: "local", provider: "local", providerSubscriptionId: null }),
    subscription({
      id: "free",
      plan: SubscriptionPlan.FREE,
      provider: "stripe",
      providerCustomerId: "customer-free",
      providerSubscriptionId: "sub-free",
    }),
    subscription({
      id: "terminal",
      provider: "square",
      providerCustomerId: "customer-terminal",
      providerSubscriptionId: "sub-terminal",
      status: SubscriptionStatus.CANCELED,
    }),
  ]);

  assert.equal(await fixture.reconcile("stripe", { suffix: "new" }), true);
  assert.equal(fixture.rows.at(-1).providerSubscriptionId, "sub-stripe-new");
});

test("nonterminal external IDs block replacement after local access expiry or scheduled cancellation", async (t) => {
  const cases = [
    {
      label: "past due and scheduled to cancel",
      row: subscription({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
        status: SubscriptionStatus.PAST_DUE,
      }),
    },
    {
      label: "active with an expired paid-through period",
      row: subscription({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
        status: SubscriptionStatus.ACTIVE,
      }),
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.label, async () => {
      const fixture = subscriptionTransaction([scenario.row]);
      await assert.rejects(
        fixture.reconcile("square", { suffix: "replacement" }),
        BillingExternalAgreementConflictError,
      );
      assert.equal(fixture.rows.length, 1);
      assert.equal(fixture.rows[0].provider, "stripe");
    });
  }

  const where = externalPaidAgreementBlocksCheckoutWhere(NOW);
  assert.deepEqual(where.plan, { not: SubscriptionPlan.FREE });
  assert.deepEqual(where.OR[0], {
    status: {
      notIn: [SubscriptionStatus.CANCELED, SubscriptionStatus.INCOMPLETE_EXPIRED],
    },
    providerSubscriptionId: { not: null },
  });
});

test("a losing provider cannot attach a retryable nonterminal agreement or close its checkout", async (t) => {
  for (const status of [SubscriptionStatus.PAST_DUE, SubscriptionStatus.INCOMPLETE]) {
    await t.test(status, async () => {
      const fixture = subscriptionTransaction([
        subscription({
          id: "stripe-winner",
          provider: "stripe",
          providerCustomerId: "customer-stripe-winner",
          providerSubscriptionId: "sub-stripe-winner",
        }),
      ]);
      let checkoutClosed = false;

      await assert.rejects(
        async () => {
          const written = await fixture.reconcile("square", {
            status,
            suffix: `loser-${status}`,
          });
          if (written) checkoutClosed = true;
        },
        BillingExternalAgreementConflictError,
      );

      assert.equal(checkoutClosed, false);
      assert.equal(fixture.rows.length, 1);
      assert.equal(fixture.rows[0].provider, "stripe");
      assert.equal(
        fixture.operations.some((operation) =>
          operation.startsWith("create:") || operation.startsWith("update:")),
        false,
      );
    });
  }
});

test("a stale ACTIVE event is ignored before the cross-provider conflict assertion", async () => {
  const newerTerminalAt = new Date("2026-09-07T12:10:00.000Z");
  const fixture = subscriptionTransaction([
    subscription({
      id: "stripe-terminal",
      provider: "stripe",
      providerCustomerId: "customer-stripe-existing",
      providerSubscriptionId: "sub-stripe-existing",
      providerUpdatedAt: newerTerminalAt,
      status: SubscriptionStatus.CANCELED,
    }),
    subscription({
      id: "square-winner",
      provider: "square",
      providerCustomerId: "customer-square-winner",
      providerSubscriptionId: "sub-square-winner",
    }),
  ]);

  const result = await fixture.reconcile("stripe", {
    customerId: "customer-stripe-existing",
    providerUpdatedAt: new Date("2026-09-07T12:05:00.000Z"),
    subscriptionId: "sub-stripe-existing",
  });

  assert.equal(result, false);
  assert.equal(fixture.rows[0].status, SubscriptionStatus.CANCELED);
  assert.deepEqual(fixture.operations, [
    "lock:mintbinder-billing:user-1",
    "find-existing:stripe:sub-stripe-existing",
  ]);
});

test("a newer terminal event remains writable after another provider wins", async () => {
  const fixture = subscriptionTransaction([
    subscription({
      id: "stripe-old",
      provider: "stripe",
      providerCustomerId: "customer-stripe-existing",
      providerSubscriptionId: "sub-stripe-existing",
      providerUpdatedAt: new Date("2026-09-07T11:00:00.000Z"),
    }),
    subscription({
      id: "square-winner",
      provider: "square",
      providerCustomerId: "customer-square-winner",
      providerSubscriptionId: "sub-square-winner",
    }),
  ]);

  const result = await fixture.reconcile("stripe", {
    customerId: "customer-stripe-existing",
    providerUpdatedAt: new Date("2026-09-07T12:05:00.000Z"),
    status: SubscriptionStatus.CANCELED,
    subscriptionId: "sub-stripe-existing",
  });

  assert.equal(result, true);
  assert.equal(fixture.rows[0].status, SubscriptionStatus.CANCELED);
  assert.equal(
    fixture.operations.includes("check-external-agreements:user-1"),
    false,
  );
});

test("an already-active exact agreement can sync scheduled cancellation after another provider wins", async () => {
  const fixture = subscriptionTransaction([
    subscription({
      id: "stripe-existing",
      provider: "stripe",
      providerCustomerId: "customer-stripe-existing",
      providerSubscriptionId: "sub-stripe-existing",
      providerUpdatedAt: new Date("2026-09-07T11:00:00.000Z"),
    }),
    subscription({
      id: "square-winner",
      provider: "square",
      providerCustomerId: "customer-square-winner",
      providerSubscriptionId: "sub-square-winner",
    }),
  ]);

  const result = await fixture.reconcile("stripe", {
    cancelAtPeriodEnd: true,
    customerId: "customer-stripe-existing",
    providerUpdatedAt: new Date("2026-09-07T12:05:00.000Z"),
    subscriptionId: "sub-stripe-existing",
  });

  assert.equal(result, true);
  assert.equal(fixture.rows[0].cancelAtPeriodEnd, true);
  assert.equal(fixture.operations.includes("check-external-agreements:user-1"), false);
});

test("exact attachment to a provisional row is not lost to its payment timestamp", async () => {
  const fixture = subscriptionTransaction([
    subscription({
      id: "square-provisional",
      provider: "square",
      providerCustomerId: "customer-square-existing",
      providerSubscriptionId: null,
      providerUpdatedAt: new Date("2026-09-07T12:01:00.000Z"),
    }),
  ]);

  const result = await fixture.reconcile("square", {
    customerId: "customer-square-existing",
    providerUpdatedAt: NOW,
    subscriptionId: "sub-square-exact",
  });

  assert.equal(result, true);
  assert.equal(fixture.rows[0].providerSubscriptionId, "sub-square-exact");
});

test("the billing advisory lock key is user-wide", async () => {
  const calls = [];
  await lockBillingCheckout({
    async $executeRaw(strings, ...values) {
      calls.push({ strings: [...strings], values });
      return 1;
    },
  }, "user-lock-test");

  assert.deepEqual(calls[0].values, ["mintbinder-billing:user-lock-test"]);
});

function subscription(overrides = {}) {
  return {
    cancelAtPeriodEnd: false,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-10-07T12:00:00.000Z"),
    id: overrides.id ?? `row-${Math.random()}`,
    plan: SubscriptionPlan.PLUS_MONTHLY,
    provider: "stripe",
    providerCustomerId: null,
    providerSubscriptionId: "sub-default",
    providerUpdatedAt: new Date("2026-09-07T11:00:00.000Z"),
    status: SubscriptionStatus.ACTIVE,
    updatedAt: new Date("2026-09-07T11:00:00.000Z"),
    userId: "user-1",
    ...overrides,
  };
}

function subscriptionTransaction(seed = []) {
  const rows = seed.map((row) => ({ ...row }));
  const operations = [];
  const transaction = {
    async $executeRaw(strings, ...values) {
      operations.push(`lock:${values[0]}`);
      return 1;
    },
    subscription: {
      async create({ data }) {
        operations.push(`create:${data.provider}:${data.providerSubscriptionId}`);
        const row = subscription({ id: `created-${rows.length + 1}`, ...data });
        rows.push(row);
        return row;
      },
      async findMany({ where }) {
        operations.push(`check-external-agreements:${where.userId}`);
        return rows.filter((row) =>
          row.userId === where.userId && !where.id?.notIn?.includes(row.id));
      },
      async findUnique({ where }) {
        operations.push(`find-customer-holder:${where.providerCustomerId}`);
        return rows.find((row) => row.providerCustomerId === where.providerCustomerId) ?? null;
      },
      async updateMany({ data, where }) {
        operations.push(`update:${where.id}`);
        const row = rows.find((candidate) => candidate.id === where.id);
        if (!row) return { count: 0 };
        if (where.providerSubscriptionId === null && row.providerSubscriptionId !== null) {
          return { count: 0 };
        }
        if (
          where.providerSubscriptionId !== null &&
          row.providerUpdatedAt &&
          row.providerUpdatedAt.getTime() >= data.providerUpdatedAt.getTime()
        ) {
          return { count: 0 };
        }
        Object.assign(row, data, { updatedAt: NOW });
        return { count: 1 };
      },
    },
  };

  return {
    operations,
    async reconcile(provider, overrides = {}) {
      const suffix = overrides.suffix ?? "existing";
      const customerId = overrides.customerId ?? `customer-${provider}-${suffix}`;
      const subscriptionId = overrides.subscriptionId ?? `sub-${provider}-${suffix}`;
      return reconcileProviderSubscriptionTransaction({
        cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
        claimCustomerOwnership: async ({ customerId: claimedCustomerId, userId }) => {
          operations.push(`claim:${provider}:${claimedCustomerId}:${userId}`);
        },
        currentPeriodEnd: overrides.currentPeriodEnd ?? new Date("2026-10-07T12:00:00.000Z"),
        customerId,
        findExistingSubscription: async () => {
          operations.push(`find-existing:${provider}:${subscriptionId}`);
          return rows.find((row) =>
            row.provider === provider && row.providerSubscriptionId === subscriptionId) ??
            rows.find((row) =>
              row.provider === provider &&
              row.providerCustomerId === customerId &&
              row.providerSubscriptionId === null) ??
            null;
        },
        now: NOW,
        plan: overrides.plan ?? SubscriptionPlan.PLUS_MONTHLY,
        provider,
        providerUpdatedAt: overrides.providerUpdatedAt ?? NOW,
        status: overrides.status ?? SubscriptionStatus.ACTIVE,
        subscriptionId,
        transaction,
        userId: overrides.userId ?? "user-1",
      });
    },
    rows,
  };
}
