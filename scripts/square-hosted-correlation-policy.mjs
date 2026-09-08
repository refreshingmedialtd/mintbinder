import { createHash } from "node:crypto";

const QA_EMAIL_DOMAIN = "mintbinder.invalid";
const QA_USER_PREFIX = "square-qa-";
const QA_BUYER_PREFIX = "square-buyer-";
const RUN_ID_PATTERN = /^\d{14}-[0-9a-f]{8}$/;
const SQUARE_PAYMENT_SEARCH_LOOKBACK_MS = 5 * 60 * 1_000;

export const REQUIRED_SQUARE_WEBHOOK_EVENTS = [
  "invoice.payment_made",
  "payment.created",
  "payment.updated",
  "subscription.created",
  "subscription.updated",
];

export function squareQaExactOrderPaymentSearchBeginTime(createdAt) {
  const createdAtMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) {
    throw new Error("Saved Square QA run creation time is invalid.");
  }
  return new Date(createdAtMs - SQUARE_PAYMENT_SEARCH_LOOKBACK_MS);
}

export function parseSquareHostedCorrelationArgs(args) {
  const parsed = {
    abortRunId: "",
    plan: "",
    resumeRunId: "",
    timeoutMinutes: 30,
  };

  for (const argument of args) {
    if (argument.startsWith("--plan=")) {
      parsed.plan = requiredArgumentValue(argument, "--plan");
      continue;
    }
    if (argument.startsWith("--resume=")) {
      parsed.resumeRunId = requiredArgumentValue(argument, "--resume");
      continue;
    }
    if (argument.startsWith("--abort=")) {
      parsed.abortRunId = requiredArgumentValue(argument, "--abort");
      continue;
    }
    if (argument.startsWith("--timeout-minutes=")) {
      const value = Number(requiredArgumentValue(argument, "--timeout-minutes"));
      if (!Number.isInteger(value) || value < 1 || value > 45) {
        throw new Error("--timeout-minutes must be an integer between 1 and 45.");
      }
      parsed.timeoutMinutes = value;
      continue;
    }
    throw new Error(`Unknown Square hosted-correlation option: ${argument}`);
  }

  const actionCount = Number(Boolean(parsed.resumeRunId)) + Number(Boolean(parsed.abortRunId));
  if (actionCount > 1) throw new Error("Use only one of --resume or --abort.");
  if (parsed.plan && parsed.plan !== "monthly" && parsed.plan !== "yearly") {
    throw new Error("--plan must be monthly or yearly.");
  }
  if (!parsed.resumeRunId && !parsed.abortRunId && !parsed.plan) {
    throw new Error("Start a new run with --plan=monthly or --plan=yearly.");
  }
  if ((parsed.resumeRunId || parsed.abortRunId) && parsed.plan) {
    throw new Error("Do not combine --plan with --resume or --abort; the saved run records its plan.");
  }
  if (parsed.resumeRunId) assertSquareQaRunId(parsed.resumeRunId);
  if (parsed.abortRunId) assertSquareQaRunId(parsed.abortRunId);

  return parsed;
}

export function squareHostedCorrelationSettings(env, options) {
  const baseUrl = normalizedRootUrl(
    env.SQUARE_HOSTED_QA_BASE_URL || env.NEXT_PUBLIC_APP_URL,
    "SQUARE_HOSTED_QA_BASE_URL or NEXT_PUBLIC_APP_URL",
  );
  const expectedCommit = String(
    env.SQUARE_HOSTED_QA_EXPECTED_COMMIT || env.AUTHENTICATED_QA_EXPECTED_COMMIT || "",
  ).trim().toLowerCase();
  const webhookUrl = normalizedUrl(
    env.SQUARE_HOSTED_QA_WEBHOOK_URL || env.SQUARE_WEBHOOK_NOTIFICATION_URL,
    "SQUARE_HOSTED_QA_WEBHOOK_URL or SQUARE_WEBHOOK_NOTIFICATION_URL",
  );
  const correlationSecret = String(env.SQUARE_CHECKOUT_CORRELATION_SECRET || "").trim();
  const authSecret = String(env.AUTH_SECRET || "").trim();
  const jobSecret = String(env.JOB_SECRET || "").trim();

  if (String(env.BILLING_PROVIDER || "square").trim().toLowerCase() !== "square") {
    throw new Error("Square hosted-correlation QA requires BILLING_PROVIDER=square.");
  }
  if (String(env.SQUARE_ENVIRONMENT || "").trim().toLowerCase() !== "sandbox") {
    throw new Error("Square hosted-correlation QA is sandbox-only and refuses production credentials.");
  }
  if (String(env.SQUARE_PAYMENT_CORRELATION_VERIFIED || "").trim().toLowerCase() !== "false") {
    throw new Error(
      "Keep SQUARE_PAYMENT_CORRELATION_VERIFIED=false while running hosted-correlation QA.",
    );
  }
  if (correlationSecret.length < 32) {
    throw new Error("SQUARE_CHECKOUT_CORRELATION_SECRET must contain at least 32 characters.");
  }
  if (correlationSecret === authSecret || correlationSecret === jobSecret) {
    throw new Error("SQUARE_CHECKOUT_CORRELATION_SECRET must be independent from AUTH_SECRET and JOB_SECRET.");
  }
  if (jobSecret.length < 32) throw new Error("JOB_SECRET must contain at least 32 characters.");
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
    throw new Error("SQUARE_HOSTED_QA_EXPECTED_COMMIT must be the exact deployed 40-character Git SHA.");
  }
  if (webhookUrl !== `${baseUrl}/api/billing/webhook/square`) {
    throw new Error("The Square webhook URL must exactly match the target app's Square webhook route.");
  }
  if (String(env.SQUARE_WEBHOOK_ENABLED || "").trim().toLowerCase() !== "true") {
    throw new Error("SQUARE_WEBHOOK_ENABLED must be true for hosted-correlation QA.");
  }

  for (const key of [
    "DATABASE_URL",
    "SQUARE_ACCESS_TOKEN",
    "SQUARE_LOCATION_ID",
    "SQUARE_WEBHOOK_SIGNATURE_KEY",
    "SQUARE_WEBHOOK_SUBSCRIPTION_ID",
    "SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID",
    "SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID",
  ]) {
    if (!String(env[key] || "").trim()) throw new Error(`${key} is required for Square hosted-correlation QA.`);
  }

  const amountMinor = options.plan === "yearly"
    ? positiveInteger(env.SQUARE_PLUS_YEARLY_AMOUNT_MINOR, "SQUARE_PLUS_YEARLY_AMOUNT_MINOR")
    : positiveInteger(env.SQUARE_PLUS_MONTHLY_AMOUNT_MINOR, "SQUARE_PLUS_MONTHLY_AMOUNT_MINOR");
  const expectedAmountMinor = options.plan === "yearly" ? 1999 : 249;
  if (amountMinor !== expectedAmountMinor) {
    throw new Error(
      `The ${options.plan} smoke expects GBP ${formatMinor(expectedAmountMinor)}; found ${formatMinor(amountMinor)}.`,
    );
  }
  if (String(env.SQUARE_CURRENCY || "").trim().toUpperCase() !== "GBP") {
    throw new Error("SQUARE_CURRENCY must be GBP for the current hosted-correlation smoke.");
  }

  return {
    amountMinor,
    baseUrl,
    expectedCommit,
    jobSecret,
    plan: options.plan,
    planVariationId: String(
      options.plan === "yearly"
        ? env.SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID
        : env.SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID,
    ).trim(),
    timeoutMs: options.timeoutMinutes * 60 * 1_000,
    webhookUrl,
  };
}

export function createSquareQaIdentity(runId) {
  assertSquareQaRunId(runId);
  const phoneTail = String(100 + (
    parseInt(createHash("sha256").update(runId).digest("hex").slice(0, 8), 16) % 100
  ))
    .padStart(4, "0");

  return {
    buyer: {
      displayName: `Square QA Buyer ${runId}`,
      email: `${QA_BUYER_PREFIX}${runId}@${QA_EMAIL_DOMAIN}`,
      // Square documents +1<valid-area-code>555<any-four-digits> for Sandbox.
      // Restrict the suffix to NANPA's fictional-use 0100-0199 block.
      phone: `+1425555${phoneTail}`,
      referenceId: `mintbinder-${QA_BUYER_PREFIX}${runId}`,
    },
    user: {
      displayName: `Square QA ${runId}`,
      email: `${QA_USER_PREFIX}${runId}@${QA_EMAIL_DOMAIN}`,
    },
  };
}

export function squareMutationWasDefinitivelyRejected(error) {
  return Boolean(
    error?.name === "SquareApiRequestError" &&
    error?.status === 400 &&
    Array.isArray(error.errors) &&
    error.errors.length > 0 &&
    error.errors.every((item) => item?.category === "INVALID_REQUEST_ERROR"),
  );
}

export function assertSquareQaCustomerCreationOutcomesKnown(runState) {
  const resources = [
    {
      id: runState?.appCustomerId,
      label: "app-prepared Square customer",
      rejectedAt: runState?.appCustomerCreationRejectedAt,
      startedAt: runState?.appCustomerCreationAttemptStartedAt,
    },
    {
      id: runState?.buyer?.customerId,
      label: "run-scoped Square buyer customer",
      rejectedAt: runState?.buyer?.customerCreationRejectedAt,
      startedAt: runState?.buyer?.customerCreationAttemptStartedAt,
    },
  ];

  for (const resource of resources) {
    if (resource.rejectedAt && !resource.startedAt) {
      throw new Error(`The ${resource.label} has a rejection checkpoint without a creation attempt.`);
    }
    if (!resource.id && resource.startedAt && !resource.rejectedAt) {
      throw new Error(
        `The ${resource.label} creation has an unconfirmed outcome. ` +
        "Resume to recover its exact idempotent resource before aborting.",
      );
    }
  }
}

export function isSquareQaFixtureIdentity({ displayName, email, runId }) {
  const expected = createSquareQaIdentity(runId).user;
  return displayName === expected.displayName && email?.toLowerCase() === expected.email;
}

export function assertSquareWebhookSubscription(subscription, { subscriptionId, webhookUrl }) {
  if (!subscription || subscription.id !== subscriptionId) {
    throw new Error("Square did not return the configured webhook subscription.");
  }
  if (subscription.enabled !== true) throw new Error("The configured Square webhook subscription is not enabled.");
  if (subscription.notification_url !== webhookUrl) {
    throw new Error("The configured Square webhook subscription points at a different notification URL.");
  }
  const configured = new Set(subscription.event_types || []);
  const missing = REQUIRED_SQUARE_WEBHOOK_EVENTS.filter((eventType) => !configured.has(eventType));
  if (missing.length) throw new Error(`Square webhook subscription is missing: ${missing.join(", ")}.`);
}

export function assertHostedPaymentMatches({
  buyerCustomerId,
  intent,
  payment,
  parsedCorrelation,
  plan,
}) {
  if (!payment?.id || payment.status?.trim().toUpperCase() !== "COMPLETED") {
    throw new Error("Square has not returned a completed payment for this run.");
  }
  if (!buyerCustomerId || payment.customer_id !== buyerCustomerId) {
    throw new Error("The hosted payment did not use the run-scoped buyer customer.");
  }
  if (payment.customer_id === intent.providerCustomerId) {
    throw new Error("Square reused the app-prepared customer, so the customer-mismatch path was not exercised.");
  }
  if (!intent.providerOrderId || payment.order_id !== intent.providerOrderId) {
    throw new Error("The completed payment did not match the checkout intent's exact Square order.");
  }
  if (payment.amount_money?.amount !== intent.expectedAmountMinor) {
    throw new Error("The completed payment amount did not match the immutable checkout snapshot.");
  }
  if (payment.amount_money?.currency?.trim().toUpperCase() !== intent.expectedCurrency?.trim().toUpperCase()) {
    throw new Error("The completed payment currency did not match the immutable checkout snapshot.");
  }
  if (parsedCorrelation !== intent.idempotencyKey) {
    throw new Error("The completed payment note did not authenticate the exact checkout intent.");
  }
  const expectedPlan = plan === "yearly" ? "PLUS_YEARLY" : "PLUS_MONTHLY";
  if (intent.plan !== expectedPlan) throw new Error("The checkout intent plan changed during the smoke.");
}

export function assertEntitlementIsolation({
  afterOtherPlus,
  beforeOtherPlus,
  expectedCustomerId,
  expectedPlan,
  expectedSubscriptionId,
  fixtureSubscriptions,
}) {
  for (const [label, snapshot] of [["before", beforeOtherPlus], ["after", afterOtherPlus]]) {
    if (
      !Number.isSafeInteger(snapshot?.count) ||
      snapshot.count < 0 ||
      !/^[0-9a-f]{64}$/i.test(snapshot?.fingerprint ?? "")
    ) {
      throw new Error(`The ${label} global Plus entitlement snapshot is invalid.`);
    }
  }
  if (
    afterOtherPlus?.count !== beforeOtherPlus?.count ||
    afterOtherPlus?.fingerprint !== beforeOtherPlus?.fingerprint
  ) {
    throw new Error("A different Mint Binder account's Plus entitlement changed during the smoke.");
  }

  const activePlus = (fixtureSubscriptions ?? []).filter((subscription) =>
    ["PLUS_MONTHLY", "PLUS_YEARLY"].includes(subscription.plan) && subscription.status === "ACTIVE");
  if (activePlus.length !== 1) {
    throw new Error(`The fixture must have exactly one active Plus subscription; found ${activePlus.length}.`);
  }
  const [subscription] = activePlus;
  if (
    subscription.plan !== expectedPlan ||
    subscription.providerCustomerId !== expectedCustomerId ||
    subscription.providerSubscriptionId !== expectedSubscriptionId
  ) {
    throw new Error("The fixture's active Plus subscription does not match the exact hosted checkout.");
  }
  return subscription;
}

export function findPostCancellationWebhookEvent(
  events,
  { baselineProviderEventIds, resourceId, startedAt, toleranceMs = 30_000 },
) {
  const baseline = new Set(baselineProviderEventIds ?? []);
  if (!startedAt || typeof startedAt !== "string") {
    throw new Error("Cancellation evidence requires a valid start time and bounded tolerance.");
  }
  const threshold = new Date(startedAt).getTime() - toleranceMs;
  if (!Number.isFinite(threshold) || !Number.isFinite(toleranceMs) || toleranceMs < 0) {
    throw new Error("Cancellation evidence requires a valid start time and bounded tolerance.");
  }
  if (!resourceId || typeof resourceId !== "string") {
    throw new Error("Cancellation evidence requires the exact Square subscription ID.");
  }
  return (events ?? []).find((event) => {
    const occurredAt = new Date(event.occurredAt).getTime();
    return Boolean(event.providerEventId) &&
      event.eventType === "subscription.updated" &&
      event.resourceId === resourceId &&
      event.status === "SUCCEEDED" &&
      !baseline.has(event.providerEventId) &&
      Number.isFinite(occurredAt) &&
      occurredAt >= threshold;
  }) ?? null;
}

export function assertRunPaymentLink(paymentLink, { orderId, paymentLinkId }) {
  if (!paymentLink || paymentLink.id !== paymentLinkId) {
    throw new Error("Square did not return the exact run-owned payment link.");
  }
  if (!orderId || paymentLink.order_id !== orderId) {
    throw new Error("The payment link does not belong to the run's exact Square order.");
  }
}

/**
 * Recover an external object around the dangerous provider-success/local-
 * checkpoint boundary. Callers must supply a create callback that reuses the
 * run's already-persisted idempotency key. If the provider response or the
 * checkpoint is lost, the next invocation safely replays that same operation,
 * validates the returned object, and checkpoints its stable provider ID.
 */
export async function ensureCheckpointedExternalResource({
  checkpoint,
  create,
  expectedId = null,
  operationName,
  retrieve,
  validate,
}) {
  if (!operationName || typeof operationName !== "string") {
    throw new Error("A checkpointed external operation requires a name.");
  }
  if (
    typeof checkpoint !== "function" ||
    typeof create !== "function" ||
    typeof retrieve !== "function" ||
    typeof validate !== "function"
  ) {
    throw new Error(`${operationName} requires create, retrieve, validate, and checkpoint callbacks.`);
  }

  let resource;
  if (expectedId) {
    resource = await retrieve(expectedId);
    if (!resource) {
      throw new Error(`The saved ${operationName} no longer exists; refusing to replace it.`);
    }
  } else {
    resource = await create();
  }

  if (!resource?.id) throw new Error(`${operationName} did not return a provider ID.`);
  if (expectedId && resource.id !== expectedId) {
    throw new Error(`The recovered ${operationName} has a different provider ID.`);
  }

  // Ownership and immutable-field checks must happen before an untrusted
  // provider result is made durable in local run state.
  await validate(resource);
  if (!expectedId) await checkpoint(resource);
  return resource;
}

export function squareSubscriptionIsInactive(subscription) {
  const status = subscription?.status?.trim().toUpperCase();
  return ["CANCELED", "COMPLETED", "DEACTIVATED"].includes(status);
}

export function squareSubscriptionHasScheduledCancellation(subscription) {
  return Boolean(subscription?.canceled_date) && !squareSubscriptionIsInactive(subscription);
}

export function paidFailureCleanupResumeStage(runState) {
  if (!runState?.failureCleanup?.reason) return null;
  if (!runState.paymentId) {
    throw new Error("Paid-failure cleanup is missing its exact Square payment ID.");
  }
  if (!runState.paymentLinkDeletedAt) return "payment-link";
  if (!runState.refund?.completedAt) return "refund";
  if (!runState.failureCleanup.providerInactiveAt) return "subscriptions";
  if (!runState.accountDeletedAt) return "account";
  if (!runState.buyerDeletedAt) return "buyer-customer";
  return "final-verification";
}

export function canRecoverPaidFailureBuyerDeletion(runState, buyerCustomer, subscriptions) {
  const expectedSubscriptionIds = runState?.failureCleanup?.subscriptionIds;
  return buyerCustomer === null &&
    !runState?.buyerDeletedAt &&
    Boolean(runState?.buyerDeletionStartedAt) &&
    Boolean(runState?.accountDeletedAt) &&
    Boolean(runState?.paymentLinkDeletedAt) &&
    Boolean(runState?.refund?.completedAt) &&
    Array.isArray(expectedSubscriptionIds) &&
    expectedSubscriptionIds.length > 0 &&
    Array.isArray(subscriptions) &&
    subscriptions.length === expectedSubscriptionIds.length &&
    subscriptions.every((subscription) =>
      expectedSubscriptionIds.includes(subscription?.id) &&
      subscription?.customer_id === runState?.buyer?.customerId &&
      squareSubscriptionIsInactive(subscription));
}

export function squareHostedRunIsProviderPrepared(runState) {
  return Boolean(
    runState?.user?.id &&
    runState?.databaseProbeAt &&
    runState?.appCustomerId &&
    runState?.checkout?.intentId &&
    runState?.checkout?.paymentLinkId &&
    runState?.checkout?.orderId &&
    runState?.checkout?.url &&
    runState?.buyer?.customerId &&
    runState?.entitlementBaseline?.capturedAt &&
    runState?.entitlementBaseline?.otherPlus,
  );
}

export function assertSquareQaRunId(runId) {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("Square hosted-correlation run ID is invalid.");
}

function requiredArgumentValue(argument, name) {
  const value = argument.slice(argument.indexOf("=") + 1).trim();
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
}

function normalizedRootUrl(value, label) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:") throw new Error(`${label} must be HTTPS.`);
  if (url.username || url.password || url.search || url.hash || !/^\/+$/u.test(url.pathname)) {
    throw new Error(`${label} must be a credential-free application root URL.`);
  }
  return url.origin;
}

function normalizedUrl(value, label) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:") throw new Error(`${label} must be HTTPS.`);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must not contain credentials, a query, or a fragment.`);
  }
  return url.href.replace(/\/$/, "");
}

function positiveInteger(value, key) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${key} must be a positive integer.`);
  return number;
}

function formatMinor(value) {
  return (value / 100).toFixed(2);
}
