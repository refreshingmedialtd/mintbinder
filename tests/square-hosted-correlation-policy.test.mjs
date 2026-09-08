import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertEntitlementIsolation,
  assertHostedPaymentMatches,
  assertRunPaymentLink,
  assertSquareQaCustomerCreationOutcomesKnown,
  assertSquareWebhookSubscription,
  canRecoverPaidFailureBuyerDeletion,
  createSquareQaIdentity,
  ensureCheckpointedExternalResource,
  findPostCancellationWebhookEvent,
  isSquareQaFixtureIdentity,
  parseSquareHostedCorrelationArgs,
  paidFailureCleanupResumeStage,
  REQUIRED_SQUARE_WEBHOOK_EVENTS,
  squareQaExactOrderPaymentSearchBeginTime,
  squareHostedCorrelationSettings,
  squareHostedRunIsProviderPrepared,
  squareMutationWasDefinitivelyRejected,
  squareSubscriptionHasScheduledCancellation,
  squareSubscriptionIsInactive,
} from "../scripts/square-hosted-correlation-policy.mjs";

const RUN_ID = "20260907120000-deadbeef";

test("unpaid exact-order payment searches include the five-minute pre-run race window", () => {
  const createdAt = "2026-09-07T12:00:00.000Z";
  assert.equal(
    squareQaExactOrderPaymentSearchBeginTime(createdAt).toISOString(),
    "2026-09-07T11:55:00.000Z",
  );
  assert.throws(
    () => squareQaExactOrderPaymentSearchBeginTime("not-a-date"),
    /creation time is invalid/,
  );
});

test("parses only explicit bounded hosted-correlation actions", () => {
  assert.deepEqual(parseSquareHostedCorrelationArgs(["--plan=monthly"]), {
    abortRunId: "",
    plan: "monthly",
    resumeRunId: "",
    timeoutMinutes: 30,
  });
  assert.equal(
    parseSquareHostedCorrelationArgs([`--resume=${RUN_ID}`, "--timeout-minutes=45"]).resumeRunId,
    RUN_ID,
  );
  assert.equal(parseSquareHostedCorrelationArgs([`--abort=${RUN_ID}`]).abortRunId, RUN_ID);
  assert.throws(() => parseSquareHostedCorrelationArgs([]), /--plan/);
  assert.throws(() => parseSquareHostedCorrelationArgs(["--plan=weekly"]), /monthly or yearly/);
  assert.throws(() => parseSquareHostedCorrelationArgs(["--plan=monthly", `--resume=${RUN_ID}`]), /Do not combine/);
  assert.throws(() => parseSquareHostedCorrelationArgs(["--plan=monthly", "--confirm"]), /Unknown/);
  assert.throws(() => parseSquareHostedCorrelationArgs(["--plan=monthly", "--timeout-minutes=0"]), /between 1 and 45/);
  assert.throws(() => parseSquareHostedCorrelationArgs(["--resume=../unsafe"]), /run ID is invalid/);
});

test("paid-failure cleanup resumes at every durable crash boundary", () => {
  const base = {
    accountDeletedAt: null,
    buyerDeletedAt: null,
    failureCleanup: {
      providerInactiveAt: null,
      reason: "correlation timed out",
      subscriptionIds: [],
    },
    paymentId: "payment-run",
    paymentLinkDeletedAt: null,
    refund: { completedAt: null },
  };

  assert.equal(paidFailureCleanupResumeStage({ failureCleanup: { reason: null } }), null);
  assert.throws(
    () => paidFailureCleanupResumeStage({ ...base, paymentId: null }),
    /payment ID/,
  );
  assert.equal(paidFailureCleanupResumeStage(base), "payment-link");
  assert.equal(
    paidFailureCleanupResumeStage({ ...base, paymentLinkDeletedAt: "2026-09-07T12:00:00Z" }),
    "refund",
  );
  assert.equal(paidFailureCleanupResumeStage({
    ...base,
    paymentLinkDeletedAt: "2026-09-07T12:00:00Z",
    refund: { completedAt: "2026-09-07T12:01:00Z" },
  }), "subscriptions");
  assert.equal(paidFailureCleanupResumeStage({
    ...base,
    paymentLinkDeletedAt: "2026-09-07T12:00:00Z",
    refund: { completedAt: "2026-09-07T12:01:00Z" },
    failureCleanup: {
      ...base.failureCleanup,
      providerInactiveAt: "2026-09-07T12:02:00Z",
      subscriptionIds: ["subscription-run"],
    },
  }), "account");
  assert.equal(paidFailureCleanupResumeStage({
    ...base,
    accountDeletedAt: "2026-09-07T12:03:00Z",
    paymentLinkDeletedAt: "2026-09-07T12:00:00Z",
    refund: { completedAt: "2026-09-07T12:01:00Z" },
    failureCleanup: {
      ...base.failureCleanup,
      providerInactiveAt: "2026-09-07T12:02:00Z",
      subscriptionIds: ["subscription-run"],
    },
  }), "buyer-customer");
  assert.equal(paidFailureCleanupResumeStage({
    ...base,
    accountDeletedAt: "2026-09-07T12:03:00Z",
    buyerDeletedAt: "2026-09-07T12:04:00Z",
    paymentLinkDeletedAt: "2026-09-07T12:00:00Z",
    refund: { completedAt: "2026-09-07T12:01:00Z" },
    failureCleanup: {
      ...base.failureCleanup,
      providerInactiveAt: "2026-09-07T12:02:00Z",
      subscriptionIds: ["subscription-run"],
    },
  }), "final-verification");
});

test("an absent paid-failure buyer is recoverable only after every destructive prerequisite", () => {
  const terminalSubscriptions = [{
    customer_id: "buyer-customer",
    id: "subscription-run",
    status: "CANCELED",
  }];
  const fullyFenced = {
    accountDeletedAt: "2026-09-07T12:03:00Z",
    buyer: { customerId: "buyer-customer" },
    buyerDeletionStartedAt: "2026-09-07T12:03:30Z",
    buyerDeletedAt: null,
    failureCleanup: {
      providerInactiveAt: "2026-09-07T12:02:00Z",
      subscriptionIds: ["subscription-run"],
    },
    paymentLinkDeletedAt: "2026-09-07T12:00:00Z",
    refund: { completedAt: "2026-09-07T12:01:00Z" },
  };

  assert.equal(canRecoverPaidFailureBuyerDeletion(fullyFenced, null, terminalSubscriptions), true);
  assert.equal(canRecoverPaidFailureBuyerDeletion(fullyFenced, { id: "customer-run" }, terminalSubscriptions), false);
  assert.equal(canRecoverPaidFailureBuyerDeletion({ ...fullyFenced, accountDeletedAt: null }, null, terminalSubscriptions), false);
  assert.equal(canRecoverPaidFailureBuyerDeletion({ ...fullyFenced, buyerDeletionStartedAt: null }, null, terminalSubscriptions), false);
  assert.equal(canRecoverPaidFailureBuyerDeletion({ ...fullyFenced, paymentLinkDeletedAt: null }, null, terminalSubscriptions), false);
  assert.equal(canRecoverPaidFailureBuyerDeletion({
    ...fullyFenced,
    refund: { completedAt: null },
  }, null, terminalSubscriptions), false);
  assert.equal(canRecoverPaidFailureBuyerDeletion({
    ...fullyFenced,
    failureCleanup: { ...fullyFenced.failureCleanup, subscriptionIds: [] },
  }, null, terminalSubscriptions), false);
  assert.equal(canRecoverPaidFailureBuyerDeletion({
    ...fullyFenced,
  }, null, [{ ...terminalSubscriptions[0], status: "ACTIVE", canceled_date: "2026-10-07" }]), false);
  assert.equal(canRecoverPaidFailureBuyerDeletion({
    ...fullyFenced,
  }, null, [{ ...terminalSubscriptions[0], customer_id: "other-customer" }]), false);
});

test("a provider-prepared run resumes without recreating a deleted payment link", () => {
  const prepared = {
    appCustomerId: "app-customer",
    buyer: { customerId: "buyer-customer" },
    checkout: {
      intentId: "intent-run",
      orderId: "order-run",
      paymentLinkId: "link-run",
      url: "https://square.link/u/run",
    },
    databaseProbeAt: "2026-09-07T12:00:00Z",
    entitlementBaseline: {
      capturedAt: "2026-09-07T12:00:01Z",
      otherPlus: { count: 0, fingerprint: "a".repeat(64) },
    },
    user: { id: "user-run" },
  };

  assert.equal(squareHostedRunIsProviderPrepared(prepared), true);
  assert.equal(squareHostedRunIsProviderPrepared({
    ...prepared,
    buyer: { customerId: null },
  }), false);
  assert.equal(squareHostedRunIsProviderPrepared({
    ...prepared,
    checkout: { ...prepared.checkout, orderId: null },
  }), false);
  assert.equal(squareHostedRunIsProviderPrepared({
    ...prepared,
    entitlementBaseline: { capturedAt: null, otherPlus: null },
  }), false);
});

test("requires an attested Square sandbox while the public correlation gate stays false", () => {
  const env = validEnv();
  const settings = squareHostedCorrelationSettings(env, { plan: "monthly", timeoutMinutes: 12 });
  assert.equal(settings.amountMinor, 249);
  assert.equal(settings.baseUrl, "https://mintbinder.co.uk");
  assert.equal(settings.timeoutMs, 720_000);
  assert.equal(settings.webhookUrl, "https://mintbinder.co.uk/api/billing/webhook/square");

  const overrideSettings = squareHostedCorrelationSettings({
    ...env,
    SQUARE_HOSTED_QA_WEBHOOK_URL: "https://mintbinder.co.uk/api/billing/webhook/square/",
    SQUARE_WEBHOOK_NOTIFICATION_URL: "https://local-tunnel.example/api/billing/webhook/square",
  }, { plan: "monthly", timeoutMinutes: 12 });
  assert.equal(overrideSettings.webhookUrl, "https://mintbinder.co.uk/api/billing/webhook/square");

  assert.throws(
    () => squareHostedCorrelationSettings({ ...env, SQUARE_ENVIRONMENT: "production" }, { plan: "monthly", timeoutMinutes: 12 }),
    /sandbox-only/,
  );
  assert.throws(
    () => squareHostedCorrelationSettings({ ...env, SQUARE_PAYMENT_CORRELATION_VERIFIED: "true" }, { plan: "monthly", timeoutMinutes: 12 }),
    /Keep SQUARE_PAYMENT_CORRELATION_VERIFIED=false/,
  );
  assert.throws(
    () => squareHostedCorrelationSettings({ ...env, SQUARE_CHECKOUT_CORRELATION_SECRET: env.AUTH_SECRET }, { plan: "monthly", timeoutMinutes: 12 }),
    /must be independent/,
  );
  assert.throws(
    () => squareHostedCorrelationSettings({ ...env, SQUARE_WEBHOOK_NOTIFICATION_URL: "https://other.example/api/billing/webhook/square" }, { plan: "monthly", timeoutMinutes: 12 }),
    /exactly match/,
  );
  assert.throws(
    () => squareHostedCorrelationSettings({ ...env, SQUARE_HOSTED_QA_WEBHOOK_URL: "https://other.example/api/billing/webhook/square" }, { plan: "monthly", timeoutMinutes: 12 }),
    /exactly match/,
  );
  assert.throws(
    () => squareHostedCorrelationSettings({ ...env, SQUARE_PLUS_MONTHLY_AMOUNT_MINOR: "1" }, { plan: "monthly", timeoutMinutes: 12 }),
    /expects GBP 2.49/,
  );
});

test("creates a strict run-scoped app user and deliberately different buyer", () => {
  const identity = createSquareQaIdentity(RUN_ID);
  assert.equal(identity.user.email, `square-qa-${RUN_ID}@mintbinder.invalid`);
  assert.match(identity.buyer.email, /^square-buyer-[0-9a-f]{16}@mintbinder\.co\.uk$/);
  assert.doesNotMatch(identity.buyer.email, /\.invalid$/);
  assert.equal(createSquareQaIdentity(RUN_ID).buyer.email, identity.buyer.email);
  assert.match(identity.buyer.phone, /^\+142555501\d{2}$/);
  assert.equal(createSquareQaIdentity(RUN_ID).buyer.phone, identity.buyer.phone);
  assert.notEqual(identity.user.email, identity.buyer.email);
  assert.equal(isSquareQaFixtureIdentity({ ...identity.user, runId: RUN_ID }), true);
  assert.equal(isSquareQaFixtureIdentity({ ...identity.user, email: "real@example.com", runId: RUN_ID }), false);
});

test("recognizes only an observed Square 400 invalid-request response as a definitive non-mutation", () => {
  assert.equal(squareMutationWasDefinitivelyRejected({
    name: "SquareApiRequestError",
    status: 400,
    errors: [{ category: "INVALID_REQUEST_ERROR", code: "INVALID_PHONE_NUMBER" }],
  }), true);
  assert.equal(squareMutationWasDefinitivelyRejected({
    name: "SquareApiRequestError",
    status: 503,
    errors: [{ category: "API_ERROR", code: "INTERNAL_SERVER_ERROR" }],
  }), false);
  assert.equal(squareMutationWasDefinitivelyRejected({
    name: "SquareApiRequestError",
    status: 400,
    errors: [],
  }), false);
});

test("unpaid abort fences both customer provider-success/checkpoint crash windows", () => {
  const base = {
    appCustomerId: null,
    appCustomerCreationAttemptStartedAt: null,
    appCustomerCreationRejectedAt: null,
    buyer: {
      customerId: null,
      customerCreationAttemptStartedAt: null,
      customerCreationRejectedAt: null,
    },
  };
  assert.doesNotThrow(() => assertSquareQaCustomerCreationOutcomesKnown(base));
  assert.throws(
    () => assertSquareQaCustomerCreationOutcomesKnown({
      ...base,
      appCustomerCreationAttemptStartedAt: "2026-09-08T12:00:00.000Z",
    }),
    /app-prepared Square customer creation has an unconfirmed outcome.*Resume/,
  );
  assert.doesNotThrow(() => assertSquareQaCustomerCreationOutcomesKnown({
    ...base,
    appCustomerCreationAttemptStartedAt: "2026-09-08T12:00:00.000Z",
    appCustomerCreationRejectedAt: "2026-09-08T12:00:01.000Z",
  }));
  assert.doesNotThrow(() => assertSquareQaCustomerCreationOutcomesKnown({
    ...base,
    appCustomerId: "app-customer",
    appCustomerCreationAttemptStartedAt: "2026-09-08T12:00:00.000Z",
  }));
  assert.throws(
    () => assertSquareQaCustomerCreationOutcomesKnown({
      ...base,
      buyer: {
        ...base.buyer,
        customerCreationAttemptStartedAt: "2026-09-08T12:00:00.000Z",
      },
    }),
    /run-scoped Square buyer customer creation has an unconfirmed outcome.*Resume/,
  );
  assert.doesNotThrow(() => assertSquareQaCustomerCreationOutcomesKnown({
    ...base,
    buyer: {
      ...base.buyer,
      customerCreationAttemptStartedAt: "2026-09-08T12:00:00.000Z",
      customerCreationRejectedAt: "2026-09-08T12:00:01.000Z",
    },
  }));
  assert.throws(
    () => assertSquareQaCustomerCreationOutcomesKnown({
      ...base,
      appCustomerCreationRejectedAt: "2026-09-08T12:00:01.000Z",
    }),
    /rejection checkpoint without a creation attempt/,
  );
});

test("requires one enabled exact webhook subscription with every billing event", () => {
  const subscription = {
    enabled: true,
    event_types: REQUIRED_SQUARE_WEBHOOK_EVENTS,
    id: "webhook-1",
    notification_url: "https://mintbinder.co.uk/api/billing/webhook/square",
  };
  assert.doesNotThrow(() => assertSquareWebhookSubscription(subscription, {
    subscriptionId: "webhook-1",
    webhookUrl: subscription.notification_url,
  }));
  assert.throws(
    () => assertSquareWebhookSubscription({ ...subscription, enabled: false }, {
      subscriptionId: "webhook-1",
      webhookUrl: subscription.notification_url,
    }),
    /not enabled/,
  );
  assert.throws(
    () => assertSquareWebhookSubscription({ ...subscription, event_types: ["payment.updated"] }, {
      subscriptionId: "webhook-1",
      webhookUrl: subscription.notification_url,
    }),
    /missing/,
  );
});

test("accepts only a completed, signed, exact-order buyer-mismatch payment", () => {
  const intent = {
    expectedAmountMinor: 249,
    expectedCurrency: "GBP",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    plan: "PLUS_MONTHLY",
    providerCustomerId: "customer-a",
    providerOrderId: "order-1",
  };
  const payment = {
    amount_money: { amount: 249, currency: "GBP" },
    customer_id: "customer-b",
    id: "payment-1",
    order_id: "order-1",
    status: "COMPLETED",
  };
  assert.doesNotThrow(() => assertHostedPaymentMatches({
    buyerCustomerId: "customer-b",
    intent,
    parsedCorrelation: intent.idempotencyKey,
    payment,
    plan: "monthly",
  }));
  assert.throws(
    () => assertHostedPaymentMatches({ buyerCustomerId: "customer-b", intent, parsedCorrelation: intent.idempotencyKey, payment: { ...payment, order_id: "wrong" }, plan: "monthly" }),
    /exact Square order/,
  );
  assert.throws(
    () => assertHostedPaymentMatches({ buyerCustomerId: "customer-b", intent, parsedCorrelation: intent.idempotencyKey, payment: { ...payment, customer_id: "customer-a" }, plan: "monthly" }),
    /run-scoped buyer customer/,
  );
  assert.throws(
    () => assertHostedPaymentMatches({ buyerCustomerId: "customer-b", intent, parsedCorrelation: "wrong", payment, plan: "monthly" }),
    /authenticate the exact checkout intent/,
  );
});

test("distinguishes terminal Square subscriptions from scheduled cancellation", () => {
  assert.equal(squareSubscriptionIsInactive({ status: "ACTIVE" }), false);
  assert.equal(squareSubscriptionIsInactive({ status: "CANCELED" }), true);
  assert.equal(squareSubscriptionIsInactive({ status: "COMPLETED" }), true);
  assert.equal(squareSubscriptionIsInactive({ status: "DEACTIVATED" }), true);
  assert.equal(squareSubscriptionIsInactive({ status: "ACTIVE", canceled_date: "2026-09-07" }), false);
  assert.equal(squareSubscriptionHasScheduledCancellation({
    status: "ACTIVE",
    canceled_date: "2026-09-07",
  }), true);
  assert.equal(squareSubscriptionHasScheduledCancellation({
    status: "CANCELED",
    canceled_date: "2026-09-07",
  }), false);
});

test("proves global entitlement isolation and the fixture's one exact active Plus row", () => {
  const beforeOtherPlus = { count: 2, fingerprint: "a".repeat(64) };
  const expected = {
    plan: "PLUS_MONTHLY",
    providerCustomerId: "customer-b",
    providerSubscriptionId: "subscription-run",
    status: "ACTIVE",
  };
  const fixtureSubscriptions = [
    { plan: "FREE", providerCustomerId: "customer-a", providerSubscriptionId: null, status: "ACTIVE" },
    expected,
    { plan: "PLUS_YEARLY", providerCustomerId: "old", providerSubscriptionId: "old-sub", status: "CANCELED" },
  ];

  assert.equal(assertEntitlementIsolation({
    afterOtherPlus: { ...beforeOtherPlus },
    beforeOtherPlus,
    expectedCustomerId: "customer-b",
    expectedPlan: "PLUS_MONTHLY",
    expectedSubscriptionId: "subscription-run",
    fixtureSubscriptions,
  }), expected);

  assert.throws(() => assertEntitlementIsolation({
    afterOtherPlus: { count: 2, fingerprint: "b".repeat(64) },
    beforeOtherPlus,
    expectedCustomerId: "customer-b",
    expectedPlan: "PLUS_MONTHLY",
    expectedSubscriptionId: "subscription-run",
    fixtureSubscriptions,
  }), /different Mint Binder account/);
  assert.throws(() => assertEntitlementIsolation({
    afterOtherPlus: beforeOtherPlus,
    beforeOtherPlus: null,
    expectedCustomerId: "customer-b",
    expectedPlan: "PLUS_MONTHLY",
    expectedSubscriptionId: "subscription-run",
    fixtureSubscriptions,
  }), /before global Plus entitlement snapshot is invalid/);
  assert.throws(() => assertEntitlementIsolation({
    afterOtherPlus: beforeOtherPlus,
    beforeOtherPlus,
    expectedCustomerId: "customer-b",
    expectedPlan: "PLUS_MONTHLY",
    expectedSubscriptionId: "subscription-run",
    fixtureSubscriptions: [...fixtureSubscriptions, { ...expected, providerSubscriptionId: "second-active" }],
  }), /exactly one active Plus subscription/);
  assert.throws(() => assertEntitlementIsolation({
    afterOtherPlus: beforeOtherPlus,
    beforeOtherPlus,
    expectedCustomerId: "wrong-customer",
    expectedPlan: "PLUS_MONTHLY",
    expectedSubscriptionId: "subscription-run",
    fixtureSubscriptions,
  }), /does not match the exact hosted checkout/);
});

test("selects only a new, successful, exact-resource post-cancellation webhook", () => {
  const subscriptionId = "subscription-run";
  const startedAt = "2026-09-07T12:00:00.000Z";
  const event = (providerEventId, overrides = {}) => ({
    eventType: "subscription.updated",
    occurredAt: "2026-09-07T12:00:01.000Z",
    providerEventId,
    resourceId: subscriptionId,
    status: "SUCCEEDED",
    ...overrides,
  });
  const selected = findPostCancellationWebhookEvent([
    event("baseline-event"),
    event("too-early", { occurredAt: "2026-09-07T11:59:29.999Z" }),
    event("wrong-resource", { resourceId: "someone-else" }),
    event("wrong-type", { eventType: "payment.updated" }),
    event("failed", { status: "FAILED" }),
    event("exact-new-event"),
  ], {
    baselineProviderEventIds: ["baseline-event"],
    resourceId: subscriptionId,
    startedAt,
  });
  assert.equal(selected?.providerEventId, "exact-new-event");
  assert.equal(findPostCancellationWebhookEvent([event("baseline-event")], {
    baselineProviderEventIds: ["baseline-event"],
    resourceId: subscriptionId,
    startedAt,
  }), null);
  assert.throws(() => findPostCancellationWebhookEvent([], {
    baselineProviderEventIds: [],
    resourceId: "",
    startedAt,
  }), /exact Square subscription ID/);
  assert.throws(() => findPostCancellationWebhookEvent([], {
    baselineProviderEventIds: [],
    resourceId: subscriptionId,
    startedAt: "invalid",
  }), /valid start time/);
});

test("accepts only the exact run-owned Square payment link before deletion", () => {
  const link = { id: "link-run", order_id: "order-run", url: "https://square.link/u/run" };
  assert.doesNotThrow(() => assertRunPaymentLink(link, {
    orderId: "order-run",
    paymentLinkId: "link-run",
  }));
  assert.throws(() => assertRunPaymentLink({ ...link, id: "link-other" }, {
    orderId: "order-run",
    paymentLinkId: "link-run",
  }), /exact run-owned payment link/);
  assert.throws(() => assertRunPaymentLink({ ...link, order_id: "order-other" }, {
    orderId: "order-run",
    paymentLinkId: "link-run",
  }), /exact Square order/);
});

test("recovers one idempotent external resource after a lost provider response", async () => {
  const provider = fakeIdempotentProvider();
  const state = { resourceId: null };
  let loseFirstResponse = true;
  const invoke = () => ensureCheckpointedExternalResource({
    expectedId: state.resourceId,
    operationName: "test customer",
    retrieve: (id) => provider.retrieve(id),
    create: async () => {
      const resource = await provider.create("stable-operation-key", "owner-run");
      if (loseFirstResponse) {
        loseFirstResponse = false;
        throw new Error("simulated socket reset after provider success");
      }
      return resource;
    },
    validate: (resource) => assert.equal(resource.owner, "owner-run"),
    checkpoint: async (resource) => {
      state.resourceId = resource.id;
    },
  });

  await assert.rejects(invoke(), /socket reset/);
  assert.equal(state.resourceId, null);
  assert.equal(provider.resourceCount(), 1);
  const recovered = await invoke();
  assert.equal(recovered.id, "resource-1");
  assert.equal(state.resourceId, "resource-1");
  assert.equal(provider.resourceCount(), 1, "The stable key must not create a second provider object.");
  assert.equal(provider.createAttempts(), 2);
});

test("replays safely after checkpoint failure and validates before persistence", async () => {
  const provider = fakeIdempotentProvider();
  const state = { resourceId: null };
  const sequence = [];
  let failCheckpoint = true;
  const invoke = () => ensureCheckpointedExternalResource({
    expectedId: state.resourceId,
    operationName: "test payment link",
    retrieve: (id) => provider.retrieve(id),
    create: () => provider.create("stable-checkpoint-key", "order-run"),
    validate: (resource) => {
      sequence.push(`validate:${resource.id}`);
      assert.equal(resource.owner, "order-run");
    },
    checkpoint: async (resource) => {
      sequence.push(`checkpoint:${resource.id}`);
      if (failCheckpoint) {
        failCheckpoint = false;
        throw new Error("simulated local checkpoint failure");
      }
      state.resourceId = resource.id;
    },
  });

  await assert.rejects(invoke(), /checkpoint failure/);
  assert.equal(state.resourceId, null);
  assert.deepEqual(sequence, ["validate:resource-1", "checkpoint:resource-1"]);
  const recovered = await invoke();
  assert.equal(recovered.id, "resource-1");
  assert.equal(provider.resourceCount(), 1);
  assert.deepEqual(sequence.slice(-2), ["validate:resource-1", "checkpoint:resource-1"]);

  let createCalled = false;
  let checkpointCalled = false;
  const retrieved = await ensureCheckpointedExternalResource({
    expectedId: state.resourceId,
    operationName: "test payment link",
    retrieve: (id) => provider.retrieve(id),
    create: async () => {
      createCalled = true;
      return null;
    },
    validate: (resource) => assert.equal(resource.owner, "order-run"),
    checkpoint: async () => {
      checkpointCalled = true;
    },
  });
  assert.equal(retrieved.id, "resource-1");
  assert.equal(createCalled, false, "A saved provider ID must be retrieved, never recreated.");
  assert.equal(checkpointCalled, false, "A saved provider ID does not need a second checkpoint.");

  await assert.rejects(() => ensureCheckpointedExternalResource({
    expectedId: "missing-resource",
    operationName: "test payment link",
    retrieve: (id) => provider.retrieve(id),
    create: () => provider.create("new-key", "order-run"),
    validate: () => undefined,
    checkpoint: () => undefined,
  }), /no longer exists; refusing to replace/);

  await assert.rejects(() => ensureCheckpointedExternalResource({
    expectedId: "resource-1",
    operationName: "test payment link",
    retrieve: async () => ({ id: "resource-other", owner: "order-run" }),
    create: () => provider.create("new-key", "order-run"),
    validate: () => undefined,
    checkpoint: () => undefined,
  }), /different provider ID/);
});

test("the harness keeps public checkout closed and makes correlation cleanup exact and resumable", async () => {
  const [harness, checkoutRoute] = await Promise.all([
    readFile(new URL("../scripts/qa-square-hosted-correlation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/billing/checkout/route.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(harness, /SQUARE_PAYMENT_CORRELATION_VERIFIED\s*=\s*["']?true/i);
  assert.doesNotMatch(harness, /api\/billing\/checkout/);
  assert.match(harness, /DELETE MY ACCOUNT/);
  assert.match(harness, /invoice\.payment_made/);
  assert.match(harness, /subscription\.created/);
  assert.match(harness, /post-cancellation subscription\.updated webhook/);
  assert.match(harness, /excludedProviderEventId: runState\.idempotence\.eventId/);
  assert.ok(
    harness.indexOf("const paidFailureResumeStage = paidFailureCleanupResumeStage(state)") <
      harness.indexOf("if (!state.evidence && !squareHostedRunIsProviderPrepared(state))"),
    "Paid-failure recovery must branch before normal fixture preparation.",
  );
  assert.match(harness, /continuePaidCorrelationFailureCleanup/);
  assert.match(harness, /squareHostedRunIsProviderPrepared/);
  assert.match(harness, /runState\.phase = "buyer-deletion-verified-terminal"/);
  assert.match(harness, /requireCanceledOrder: true/);
  assert.match(harness, /deletion\.cancelledOrderId/);
  assert.match(harness, /"canceled-order-response-loss"/);
  assert.match(harness, /order\?\.state\?\.trim\(\)\.toUpperCase\(\),\s*"CANCELED"/);
  assert.match(harness, /restoreProviderEvidence/);
  assert.match(harness, /attestLocalCheckoutSources\(config\.expectedCommit\)/);
  assert.match(harness, /"status", "--porcelain=v1", "--untracked-files=no"/);
  assert.match(harness, /resourceId: paymentId/);
  assert.match(harness, /resourceId: subscriptionId/);
  assert.match(harness, /writeSanitizedReport/);
  assert.match(harness, /searchSquarePaymentsByOrder/);
  assert.equal(
    harness.match(/beginTime: squareQaExactOrderPaymentSearchBeginTime\(runState\.createdAt\)/g)?.length,
    3,
    "Every exact-order payment search must include the pre-run race window.",
  );
  assert.doesNotMatch(harness, /beginTime: new Date\(runState\.createdAt\)/);
  assert.match(harness, /retrieveSquarePaymentLink/);
  assert.doesNotMatch(harness, /order\?\.state\?\.trim\(\)\.toUpperCase\(\) === "COMPLETED"/);

  const abortStart = harness.indexOf("async function abortUnpaidRun");
  const abortEnd = harness.indexOf("async function assertNoExactOrderPaymentEvidence");
  const abortBody = harness.slice(abortStart, abortEnd);
  assert.ok(abortStart >= 0 && abortEnd > abortStart);
  const abortEntry = harness.slice(
    harness.indexOf("if (options.abortRunId)"),
    harness.indexOf("} else {", harness.indexOf("if (options.abortRunId)")),
  );
  assert.doesNotMatch(abortEntry, /ensurePreparedRun/);
  assert.match(abortEntry, /preflight\(settings, \{ cleanupOnly: true \}\)/);
  assert.match(abortBody, /hydrateAbortStateFromDurableIntent/);
  assert.ok(
    abortBody.indexOf("assertSquareQaCustomerCreationOutcomesKnown(runState)") <
      abortBody.indexOf("deleteExactRunPaymentLink"),
    "Ambiguous customer creation must stop abort before the checkout link is destroyed.",
  );
  assert.match(abortBody, /creationAttemptStartedAt && !runState\.checkout\.creationRejectedAt/);
  assert.match(harness, /prepared\.checkout\.creationAttemptStartedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(harness, /prepared\.appCustomerCreationAttemptStartedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(harness, /prepared\.buyer\.customerCreationAttemptStartedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(harness, /prepared\.appCustomerCreationRejectedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(harness, /prepared\.buyer\.customerCreationRejectedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(harness, /squareMutationWasDefinitivelyRejected\(error\)/);
  assert.ok(
    abortBody.indexOf("deleteExactRunPaymentLink") < abortBody.indexOf("assertNoExactOrderPaymentEvidence"),
    "The abort path must retire its link before checking and deleting fixtures.",
  );
  const paymentCheckStart = harness.indexOf("async function assertNoExactOrderPaymentEvidence");
  const paymentCheckEnd = harness.indexOf("async function deleteRunOwnedCustomer");
  const paymentCheckBody = harness.slice(paymentCheckStart, paymentCheckEnd);
  assert.ok(paymentCheckStart >= 0 && paymentCheckEnd > paymentCheckStart);
  assert.match(
    paymentCheckBody,
    /beginTime: squareQaExactOrderPaymentSearchBeginTime\(runState\.createdAt\)/,
  );
  assert.doesNotMatch(paymentCheckBody, /beginTime: new Date\(runState\.createdAt\)/);
  const buyerCleanupStart = harness.indexOf("async function deleteRunOwnedBuyerAfterPaidCleanup");
  const buyerCleanupEnd = harness.indexOf("function assertExactBuyerSubscriptions");
  const buyerCleanupBody = harness.slice(buyerCleanupStart, buyerCleanupEnd);
  assert.ok(buyerCleanupStart >= 0 && buyerCleanupEnd > buyerCleanupStart);
  assert.ok(
    buyerCleanupBody.indexOf("every(squareSubscriptionIsInactive)") <
      buyerCleanupBody.indexOf("runState.buyerDeletedAt ="),
    "Buyer deletion cannot be checkpointed until exact subscription re-retrieval is terminal.",
  );
  assert.match(buyerCleanupBody, /canRecoverPaidFailureBuyerDeletion\(runState, null, terminalSubscriptions\)/);
  assert.match(checkoutRoute, /Square checkout is disabled until payment\.updated correlation/);
});

function validEnv() {
  return {
    AUTH_SECRET: "auth-secret-that-is-long-and-independent-123",
    AUTHENTICATED_QA_EXPECTED_COMMIT: "a".repeat(40),
    BILLING_PROVIDER: "square",
    DATABASE_URL: "postgresql://host/db",
    JOB_SECRET: "job-secret-that-is-long-and-independent-456",
    NEXT_PUBLIC_APP_URL: "https://mintbinder.co.uk",
    SQUARE_ACCESS_TOKEN: "sandbox-token",
    SQUARE_CHECKOUT_CORRELATION_SECRET: "square-secret-that-is-long-and-independent-789",
    SQUARE_CURRENCY: "GBP",
    SQUARE_ENVIRONMENT: "sandbox",
    SQUARE_LOCATION_ID: "location",
    SQUARE_PAYMENT_CORRELATION_VERIFIED: "false",
    SQUARE_PLUS_MONTHLY_AMOUNT_MINOR: "249",
    SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID: "monthly",
    SQUARE_PLUS_YEARLY_AMOUNT_MINOR: "1999",
    SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID: "yearly",
    SQUARE_WEBHOOK_ENABLED: "true",
    SQUARE_WEBHOOK_NOTIFICATION_URL: "https://mintbinder.co.uk/api/billing/webhook/square",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "signature",
    SQUARE_WEBHOOK_SUBSCRIPTION_ID: "webhook",
  };
}

function fakeIdempotentProvider() {
  const resourcesByKey = new Map();
  const resourcesById = new Map();
  let attempts = 0;
  return {
    async create(key, owner) {
      attempts += 1;
      if (!resourcesByKey.has(key)) {
        const resource = { id: `resource-${resourcesByKey.size + 1}`, owner };
        resourcesByKey.set(key, resource);
        resourcesById.set(resource.id, resource);
      }
      return resourcesByKey.get(key);
    },
    createAttempts: () => attempts,
    resourceCount: () => resourcesById.size,
    retrieve: async (id) => resourcesById.get(id) ?? null,
  };
}
