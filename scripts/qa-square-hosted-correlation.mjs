import "dotenv/config";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BillingCustomerProvenance,
  BillingWebhookStatus,
  NotificationDigestFrequency,
  PrismaClient,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@prisma/client";
import { chromium } from "playwright-core";
import { hashPassword } from "../src/lib/auth/password.ts";
import { parseSquareCheckoutCorrelation } from "../src/lib/billing/square-checkout-correlation.ts";
import {
  cancelSquareSubscription,
  createSquareCustomer,
  createSquareSubscriptionCheckout,
  deleteSquareCustomer,
  deleteSquarePaymentLink,
  refundSquarePayment,
  retrieveSquareCustomer,
  retrieveSquareOrder,
  retrieveSquarePayment,
  retrieveSquarePaymentLink,
  retrieveSquareRefund,
  retrieveSquareSubscription,
  searchSquarePaymentsByOrder,
  searchSquareSubscriptions,
  squareCheckoutExpectation,
} from "../src/lib/billing/square.ts";
import { squareHostedQaRuntimeAttestation } from "../src/lib/billing/square-runtime-attestation.ts";
import { createSquareWebhookSignatureHeader } from "../src/lib/billing/webhook-signature.ts";
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
} from "./square-hosted-correlation-policy.mjs";
import { writeAtomicJsonCheckpoint } from "./atomic-json-checkpoint.mjs";

const STATE_DIRECTORY = path.join(process.cwd(), ".local-square-qa");
const STATE_VERSION = 7;
const QA_USER_PREFIX = "square-qa-";
const QA_USER_DOMAIN = "@mintbinder.invalid";
const POLL_MS = 3_000;
const ABORT_PAYMENT_SETTLE_MS = 90_000;
const prisma = new PrismaClient();
const options = parseSquareHostedCorrelationArgs(process.argv.slice(2));

let browser;
let state;
let settings;
let primaryError;

class SafelyCleanedAcceptanceFailure extends Error {
  constructor(message, reportPath) {
    super(message);
    this.name = "SafelyCleanedAcceptanceFailure";
    this.reportPath = reportPath;
  }
}

try {
  if (options.abortRunId) {
    state = await readState(options.abortRunId);
    settings = squareHostedCorrelationSettings(process.env, {
      ...options,
      plan: state.plan,
    });
    await preflight(settings, { cleanupOnly: true });
    assertStateMatchesSettings(state, settings, { requireCommit: false });
    await abortUnpaidRun(state);
    console.log(JSON.stringify({ aborted: true, ok: true, plan: state.plan, runId: state.runId }, null, 2));
  } else {
    if (options.resumeRunId) {
      state = await readState(options.resumeRunId);
    }
    settings = squareHostedCorrelationSettings(process.env, {
      ...options,
      plan: state?.plan ?? options.plan,
    });
    await preflight(settings);

    if (!state) state = await initialiseRun(settings);
    assertStateMatchesSettings(state, settings);
    const paidFailureResumeStage = paidFailureCleanupResumeStage(state);
    if (paidFailureResumeStage) {
      await recoverCompletedAccountDeletion(state);
      let authenticated = null;
      if (!state.accountDeletedAt) {
        authenticated = await authenticateFixture(state, settings);
        browser = authenticated.browser;
      }
      await continuePaidCorrelationFailureCleanup(
        state,
        settings,
        authenticated?.context ?? null,
      );
    }
    if (!state.evidence && !squareHostedRunIsProviderPrepared(state)) {
      state = await ensurePreparedRun(state, settings);
    }
    await recoverCompletedAccountDeletion(state);

    let authenticated = null;
    if (!state.accountDeletedAt) {
      authenticated = await authenticateFixture(state, settings);
      browser = authenticated.browser;
    }

    const evidence = state.evidence
      ? await restoreProviderEvidence(state, settings)
      : await waitForRealProviderEvidence(state, settings, authenticated?.context ?? null);
    if (!state.idempotence.provedAt) {
      await proveWebhookIdempotence(state, settings, evidence);
    }
    const cleanup = await cancelRefundAndDelete(
      state,
      settings,
      evidence,
      authenticated?.context ?? null,
    );

    const report = {
      ok: true,
      runId: state.runId,
      plan: state.plan,
      runtimeCommit: settings.expectedCommit,
      realWebhookEvents: cleanup.realWebhookEvents,
      customerMismatchVerified: true,
      exactOrderVerified: true,
      semanticReplayVerified: true,
      duplicateEventReplayVerified: true,
      cancellationPreservedPaidAccess: true,
      sandboxRefundCompleted: true,
      cleanup: "billing-aware-account-deletion",
    };
    const reportPath = await writeSanitizedReport(state, report);
    await rm(statePath(state.runId), { force: true });
    report.reportPath = reportPath;
    console.log(JSON.stringify(report, null, 2));
  }
} catch (error) {
  primaryError = error;
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  if (error instanceof SafelyCleanedAcceptanceFailure) {
    console.error(`The failed paid acceptance fixture was safely cancelled, refunded, and removed.`);
    console.error(`Sanitized failure report: ${error.reportPath}`);
  } else if (state?.runId) {
    console.error(`Run evidence was preserved at ${statePath(state.runId)}.`);
    console.error(`Resume with: npm run qa:square-hosted-correlation -- --resume=${state.runId}`);
    console.error(`Abort is permitted only while unpaid: npm run qa:square-hosted-correlation -- --abort=${state.runId}`);
  }
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => undefined);
  await prisma.$disconnect();
}

if (primaryError) process.exitCode = 1;

async function preflight(config, { cleanupOnly = false } = {}) {
  if (cleanupOnly) {
    // Abort operates only on exact, already-checkpointed local/provider IDs. It
    // must remain usable after a preparation defect without requiring that
    // defective checkout build to be deployed or replaying provider creation.
    return;
  }
  attestLocalCheckoutSources(config.expectedCommit);
  status("Checking the exact deployed runtime...");
  const healthResponse = await fetch(`${config.baseUrl}/api/health`, {
    headers: { authorization: `Bearer ${config.jobSecret}` },
    signal: AbortSignal.timeout(15_000),
  });
  const health = await healthResponse.json().catch(() => ({}));
  assert.equal(healthResponse.status, 200, `Runtime health returned HTTP ${healthResponse.status}.`);
  assert.equal(health.ok, true, "The deployed runtime did not report ok=true.");
  assert.equal(
    health.build?.commit,
    config.expectedCommit,
    `The deployed runtime is ${health.build?.commit ?? "unknown"}; expected ${config.expectedCommit}.`,
  );
  const localSquareAttestation = squareHostedQaRuntimeAttestation(process.env, {
    webhookUrl: config.webhookUrl,
  });
  assert.deepEqual(
    health.attestations?.squareHostedQa,
    localSquareAttestation,
    "The deployed Square checkout/webhook configuration does not exactly match the local QA runner.",
  );

  status("Checking the configured Square webhook subscription...");
  const configured = await squareApi(
    `/v2/webhooks/subscriptions/${encodeURIComponent(process.env.SQUARE_WEBHOOK_SUBSCRIPTION_ID.trim())}`,
  );
  assertSquareWebhookSubscription(configured.subscription, {
    subscriptionId: process.env.SQUARE_WEBHOOK_SUBSCRIPTION_ID.trim(),
    webhookUrl: config.webhookUrl,
  });

  const listedSubscriptions = await listSquareWebhookSubscriptions();
  const matching = listedSubscriptions.filter((subscription) =>
    subscription.enabled === true && subscription.notification_url === config.webhookUrl);
  assert.equal(
    matching.length,
    1,
    `Expected exactly one enabled Square webhook subscription for ${config.webhookUrl}; found ${matching.length}.`,
  );
}

function attestLocalCheckoutSources(expectedCommit) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  }).trim().toLowerCase();
  assert.equal(
    head,
    expectedCommit,
    `The local checkout code is ${head}; the attested deployment is ${expectedCommit}.`,
  );
  const trackedChanges = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=no"],
    { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
  ).trim();
  assert.equal(
    trackedChanges,
    "",
    "The local tracked worktree is dirty; commit and deploy the exact checkout code before running acceptance.",
  );
}

async function listSquareWebhookSubscriptions() {
  const subscriptions = [];
  let cursor = "";

  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const response = await squareApi(`/v2/webhooks/subscriptions?${query}`);
    subscriptions.push(...(response.subscriptions ?? []));
    cursor = String(response.cursor ?? "").trim();
    if (!cursor) return subscriptions;
  }

  throw new Error("Square webhook subscription listing exceeded its safe pagination limit.");
}

async function initialiseRun(config) {
  const recoveryFiles = await readdir(STATE_DIRECTORY).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const existingRunIds = recoveryFiles
    .filter((name) => /^\d{14}-[0-9a-f]{8}\.json$/.test(name))
    .map((name) => name.slice(0, -5));
  if (existingRunIds.length) {
    throw new Error(
      `A Square QA recovery file already exists. Resume or abort it first: ${existingRunIds.join(", ")}.`,
    );
  }

  const existingFixture = await prisma.user.findFirst({
    where: {
      email: { startsWith: QA_USER_PREFIX, endsWith: QA_USER_DOMAIN },
    },
    select: { email: true },
  });
  if (existingFixture) {
    throw new Error(
      `An earlier Square QA fixture still exists (${existingFixture.email}). Resume or clean it before starting another run.`,
    );
  }

  const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(4).toString("hex")}`;
  const identity = createSquareQaIdentity(runId);
  const password = `${randomBytes(24).toString("base64url")}Sq!7`;
  const now = new Date();
  const prepared = {
    version: STATE_VERSION,
    runId,
    plan: config.plan,
    baseUrl: config.baseUrl,
    expectedCommit: config.expectedCommit,
    createdAt: now.toISOString(),
    phase: "initialised",
    user: { ...identity.user, password, id: null },
    buyer: {
      ...identity.buyer,
      customerId: null,
      customerCreationAttemptStartedAt: null,
      customerCreationRejectedAt: null,
    },
    appCustomerId: null,
    appCustomerIdempotencyKey: randomUUID(),
    appCustomerCreationAttemptStartedAt: null,
    appCustomerCreationRejectedAt: null,
    buyerCustomerIdempotencyKey: randomUUID(),
    checkout: {
      idempotencyKey: randomUUID(),
      intentId: null,
      paymentLinkId: null,
      orderId: null,
      url: null,
      creationAttemptStartedAt: null,
      creationRejectedAt: null,
    },
    paymentId: null,
    providerSubscriptionId: null,
    databaseProbeAt: null,
    evidence: null,
    entitlementBaseline: {
      capturedAt: null,
      otherPlus: null,
    },
    idempotence: {
      beforeSnapshot: null,
      eventId: null,
      payloadCreatedAt: null,
      provedAt: null,
    },
    cancellation: {
      startedAt: null,
      subscriptionUpdatedBaselineEventIds: null,
      webhookProviderEventId: null,
      providerInactiveAt: null,
      providerScheduledAt: null,
      webhookObservedAt: null,
      accessVerifiedAt: null,
    },
    refund: {
      id: null,
      idempotencyKey: randomUUID(),
      startedAt: null,
      completedAt: null,
    },
    failureCleanup: {
      providerInactiveAt: null,
      reason: null,
      subscriptionIds: [],
    },
    paymentLinkDeletedAt: null,
    paymentLinkDeletionStartedAt: null,
    accountDeletionStartedAt: null,
    accountDeletedAt: null,
    buyerDeletionStartedAt: null,
    buyerDeletedAt: null,
    abort: {
      cancellationProof: null,
      cancellationProvedAt: null,
      cancelledOrderId: null,
      paymentLinkDeletionStartedAt: null,
      paymentLinkDeletedAt: null,
      observationStartedAt: null,
    },
  };
  await writeState(prepared);
  return prepared;
}

async function ensurePreparedRun(prepared, config) {
  status("Ensuring the run-scoped verified Mint Binder user...");
  let user = prepared.user.id
    ? await prisma.user.findUnique({
        where: { id: prepared.user.id },
        select: { displayName: true, email: true, emailVerifiedAt: true, id: true },
      })
    : await prisma.user.findUnique({
        where: { email: prepared.user.email },
        select: { displayName: true, email: true, emailVerifiedAt: true, id: true },
      });

  if (!user && prepared.user.id) {
    throw new Error(
      "The saved disposable user no longer exists; refusing to recreate it under a different identity.",
    );
  }
  if (!user) {
    user = await prisma.user.create({
      data: {
        displayName: prepared.user.displayName,
        email: prepared.user.email,
        emailVerifiedAt: new Date(),
        passwordHash: await hashPassword(prepared.user.password),
        preferredCurrency: "GBP",
        preferredRegion: "United Kingdom",
        notificationPreference: {
          create: {
            digestFrequency: NotificationDigestFrequency.OFF,
            priceAlertsEnabled: false,
            weakPriceAlertsEnabled: false,
            wishlistTargetAlertsEnabled: false,
          },
        },
      },
      select: { displayName: true, email: true, emailVerifiedAt: true, id: true },
    });
  }
  assert.ok(
    isSquareQaFixtureIdentity({ ...user, runId: prepared.runId }),
    "The recovered user did not match the exact run identity.",
  );
  assert.ok(user.emailVerifiedAt, "The disposable user is no longer verified.");
  if (prepared.user.id) assert.equal(user.id, prepared.user.id, "The run user ID changed.");
  prepared.user.id = user.id;
  prepared.phase = "user-created";
  await writeState(prepared);

  if (!prepared.databaseProbeAt) {
    // This login proves the local DATABASE_URL and the attested deployment see
    // the same disposable identity before any provider-side object is created.
    const databaseProbe = await authenticateFixture(prepared, config);
    await databaseProbe.browser.close();
    prepared.databaseProbeAt = new Date().toISOString();
    await writeState(prepared);
  }

  status("Ensuring the app-prepared Square sandbox customer...");
  const appCustomer = await ensureCheckpointedExternalResource({
    expectedId: prepared.appCustomerId,
    operationName: "app-prepared Square customer",
    retrieve: retrieveSquareCustomer,
    create: async () => {
      prepared.appCustomerCreationAttemptStartedAt = new Date().toISOString();
      prepared.appCustomerCreationRejectedAt = null;
      prepared.phase = "app-customer-creation-started";
      await writeState(prepared);
      try {
        return await createSquareCustomer({
          email: prepared.user.email,
          idempotencyKey: prepared.appCustomerIdempotencyKey,
          name: prepared.user.displayName,
          note: `Mint Binder hosted-correlation QA app customer ${prepared.runId}`,
          userId: user.id,
        });
      } catch (error) {
        if (squareMutationWasDefinitivelyRejected(error)) {
          prepared.appCustomerCreationRejectedAt = new Date().toISOString();
          prepared.phase = "app-customer-creation-rejected";
          await writeState(prepared);
        }
        throw error;
      }
    },
    validate: (customer) => {
      assert.equal(customer.referenceId, user.id, "The app-prepared customer has a different owner marker.");
    },
    checkpoint: async (customer) => {
      prepared.appCustomerId = customer.id;
      prepared.phase = "app-customer-created";
      await writeState(prepared);
    },
  });
  prepared.appCustomerId = appCustomer.id;

  const expectation = squareCheckoutExpectation(config.plan);
  const expectedPlan = config.plan === "yearly"
    ? SubscriptionPlan.PLUS_YEARLY
    : SubscriptionPlan.PLUS_MONTHLY;
  let intent = await prisma.billingCheckoutIntent.findUnique({
    where: { idempotencyKey: prepared.checkout.idempotencyKey },
  });
  if (!intent) {
    intent = await prisma.billingCheckoutIntent.create({
      data: {
        checkoutOrigin: config.baseUrl,
        expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
        expectedAmountMinor: expectation.amountMinor,
        expectedCurrency: expectation.currency,
        idempotencyKey: prepared.checkout.idempotencyKey,
        leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1_000),
        leaseToken: randomUUID(),
        plan: expectedPlan,
        provider: "square",
        providerCustomerId: appCustomer.id,
        providerPlanVariationId: expectation.planVariationId,
        status: "creating",
        userId: user.id,
      },
    });
  }
  assert.equal(intent.userId, user.id, "The recovered checkout intent belongs to another user.");
  assert.equal(intent.provider, "square");
  assert.equal(intent.plan, expectedPlan, "The recovered checkout intent has a different plan.");
  assert.equal(intent.checkoutOrigin, config.baseUrl, "The recovered checkout intent has a different origin.");
  assert.equal(intent.expectedAmountMinor, expectation.amountMinor);
  assert.equal(intent.expectedCurrency, expectation.currency);
  assert.equal(intent.providerPlanVariationId, expectation.planVariationId);
  prepared.checkout.intentId = intent.id;
  prepared.phase = "intent-created";
  await writeState(prepared);

  const paymentAlreadyCorrelated = Boolean(intent.providerPaymentId);
  if (!paymentAlreadyCorrelated) {
    await ensureFreeBillingBaseline({ appCustomerId: appCustomer.id, userId: user.id });
  }

  if (!prepared.entitlementBaseline?.capturedAt) {
    prepared.entitlementBaseline = {
      capturedAt: new Date().toISOString(),
      otherPlus: await stableOtherPlusSnapshot(user.id),
    };
    prepared.phase = "entitlement-baseline-captured";
    // This checkpoint must precede payment-link creation. If the provider call
    // loses its response, a resume can replay its idempotency key without ever
    // inventing a post-payment baseline.
    await writeState(prepared);
  }
  assert.ok(prepared.entitlementBaseline.otherPlus, "The pre-payment Plus entitlement baseline is missing.");

  status("Ensuring the signed Square hosted checkout...");
  let checkout = intent.providerCheckoutId && intent.providerOrderId && intent.checkoutUrl
    ? { id: intent.providerCheckoutId, orderId: intent.providerOrderId, url: intent.checkoutUrl }
    : null;
  if (!checkout) {
    checkout = await ensureCheckpointedExternalResource({
      expectedId: prepared.checkout.paymentLinkId,
      operationName: "hosted Square payment link",
      retrieve: async (paymentLinkId) => {
        const link = await retrieveSquarePaymentLink(paymentLinkId);
        if (!link) return null;
        return {
          id: link.id,
          orderId: link.order_id,
          url: link.url ?? link.long_url,
        };
      },
      create: async () => {
        prepared.checkout.creationAttemptStartedAt = new Date().toISOString();
        prepared.checkout.creationRejectedAt = null;
        prepared.phase = "payment-link-creation-started";
        await writeState(prepared);
        try {
          return await createSquareSubscriptionCheckout({
            email: prepared.buyer.email,
            expectation,
            idempotencyKey: prepared.checkout.idempotencyKey,
            origin: config.baseUrl,
            plan: config.plan,
            phoneNumber: prepared.buyer.phone,
          });
        } catch (error) {
          if (squareMutationWasDefinitivelyRejected(error)) {
            prepared.checkout.creationRejectedAt = new Date().toISOString();
            prepared.phase = "payment-link-creation-rejected";
            await writeState(prepared);
          }
          throw error;
        }
      },
      validate: (paymentLink) => {
        assertSquareCheckoutUrl(paymentLink.url);
        if (prepared.checkout.paymentLinkId) {
          assert.equal(paymentLink.id, prepared.checkout.paymentLinkId);
        }
        if (prepared.checkout.orderId) assert.equal(paymentLink.orderId, prepared.checkout.orderId);
      },
      checkpoint: async (paymentLink) => {
        prepared.checkout.paymentLinkId = paymentLink.id;
        prepared.checkout.orderId = paymentLink.orderId;
        prepared.checkout.url = paymentLink.url;
        prepared.phase = "payment-link-created";
        await writeState(prepared);
      },
    });
  }
  assertSquareCheckoutUrl(checkout.url);
  if (prepared.checkout.paymentLinkId) assert.equal(checkout.id, prepared.checkout.paymentLinkId);
  if (prepared.checkout.orderId) assert.equal(checkout.orderId, prepared.checkout.orderId);
  prepared.checkout.paymentLinkId = checkout.id;
  prepared.checkout.orderId = checkout.orderId;
  prepared.checkout.url = checkout.url;
  prepared.phase = "payment-link-created";
  await writeState(prepared);

  const published = await prisma.billingCheckoutIntent.updateMany({
    where: {
      id: intent.id,
      idempotencyKey: prepared.checkout.idempotencyKey,
      providerCheckoutId: null,
      status: { in: ["creating", "recoverable"] },
    },
    data: {
      checkoutUrl: checkout.url,
      providerCheckoutId: checkout.id,
      providerOrderId: checkout.orderId,
      status: "ready",
    },
  });
  if (published.count === 0) {
    const current = await prisma.billingCheckoutIntent.findUnique({ where: { id: intent.id } });
    assert.equal(current?.providerCheckoutId, checkout.id, "A different checkout link owns the intent.");
    assert.equal(current?.providerOrderId, checkout.orderId, "A different Square order owns the intent.");
    assert.equal(current?.checkoutUrl, checkout.url, "The durable checkout URL changed.");
  }

  status("Ensuring the deliberately different Square sandbox buyer customer...");
  const buyerCustomer = await ensureCheckpointedExternalResource({
    expectedId: prepared.buyer.customerId,
    operationName: "run-scoped Square buyer customer",
    retrieve: retrieveSquareCustomer,
    create: async () => {
      prepared.buyer.customerCreationAttemptStartedAt = new Date().toISOString();
      prepared.buyer.customerCreationRejectedAt = null;
      prepared.phase = "buyer-customer-creation-started";
      await writeState(prepared);
      try {
        return await createSquareCustomer({
          email: prepared.buyer.email,
          idempotencyKey: prepared.buyerCustomerIdempotencyKey,
          name: prepared.buyer.displayName,
          note: `Mint Binder hosted-correlation QA buyer ${prepared.runId}`,
          phoneNumber: prepared.buyer.phone,
          userId: prepared.buyer.referenceId,
        });
      } catch (error) {
        if (squareMutationWasDefinitivelyRejected(error)) {
          prepared.buyer.customerCreationRejectedAt = new Date().toISOString();
          prepared.phase = "buyer-customer-creation-rejected";
          await writeState(prepared);
        }
        throw error;
      }
    },
    validate: (customer) => {
      assert.notEqual(customer.id, appCustomer.id);
      assert.equal(customer.referenceId, prepared.buyer.referenceId);
    },
    checkpoint: async (customer) => {
      prepared.buyer.customerId = customer.id;
      prepared.phase = "buyer-customer-created";
      await writeState(prepared);
    },
  });
  prepared.buyer.customerId = buyerCustomer.id;
  prepared.phase = "awaiting-payment";
  await writeState(prepared);

  return prepared;
}

async function ensureFreeBillingBaseline({ appCustomerId, userId }) {
  await prisma.$transaction(async (transaction) => {
    const ownership = await transaction.billingCustomer.findUnique({
      where: { provider_providerCustomerId: { provider: "square", providerCustomerId: appCustomerId } },
    });
    if (ownership) {
      assert.equal(ownership.userId, userId, "The app customer is already owned by another user.");
      assert.equal(ownership.provenance, BillingCustomerProvenance.APP_CREATED);
    } else {
      await transaction.billingCustomer.create({
        data: {
          provider: "square",
          providerCustomerId: appCustomerId,
          provenance: BillingCustomerProvenance.APP_CREATED,
          userId,
        },
      });
    }

    const subscription = await transaction.subscription.findUnique({
      where: { providerCustomerId: appCustomerId },
    });
    if (subscription) {
      assert.equal(subscription.userId, userId, "The baseline subscription belongs to another user.");
      assert.equal(subscription.provider, "square");
      assert.equal(subscription.plan, SubscriptionPlan.FREE);
      assert.equal(subscription.providerSubscriptionId, null);
    } else {
      await transaction.subscription.create({
        data: {
          plan: SubscriptionPlan.FREE,
          provider: "square",
          providerCustomerId: appCustomerId,
          status: SubscriptionStatus.ACTIVE,
          userId,
        },
      });
    }
  });
}

async function recoverCompletedAccountDeletion(runState) {
  if (!runState.user.id) return;
  const user = await prisma.user.findUnique({
    where: { id: runState.user.id },
    select: { id: true },
  });
  if (runState.accountDeletedAt) {
    assert.equal(user, null, "The disposable user reappeared after its deletion checkpoint.");
    return;
  }
  if (runState.accountDeletionStartedAt && !user) {
    runState.accountDeletedAt = new Date().toISOString();
    runState.phase = "account-deleted";
    await writeState(runState);
  }
}

async function authenticateFixture(runState, config) {
  status("Signing the disposable user into the exact deployed app...");
  const launchedBrowser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await launchedBrowser.newContext({ locale: "en-GB", serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor({ timeout: 30_000 });
  await page.getByLabel("Email", { exact: true }).fill(runState.user.email);
  await page.getByLabel("Password", { exact: true }).fill(runState.user.password);
  const [signInResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === config.baseUrl && url.pathname === "/api/auth/callback/credentials" &&
        response.request().method() === "POST";
    }, { timeout: 30_000 }),
    page.locator("form.auth-card button[type='submit']").click(),
  ]);
  assert.equal(signInResponse.status(), 200, `Fixture sign-in returned HTTP ${signInResponse.status()}.`);

  await waitFor(async () => {
    const response = await context.request.get(`${config.baseUrl}/api/auth/session`);
    if (!response.ok()) return null;
    const session = await response.json();
    return session?.user?.email === runState.user.email ? session : null;
  }, { description: "the disposable user's production session", timeoutMs: 30_000 });

  return { browser: launchedBrowser, context };
}

async function waitForRealProviderEvidence(runState, config, context) {
  if (runState.abort?.paymentLinkDeletedAt) {
    status("The checkout link is retired; waiting only for already-started Square payment evidence.");
  } else {
    printBuyerInstructions(runState, config);
  }
  const deadline = Date.now() + config.timeoutMs;
  let lastStatusAt = 0;
  let lastProviderProbeAt = 0;
  let exactOrderPayments = [];

  while (Date.now() < deadline) {
    const snapshot = await runSnapshot(runState);
    const paymentId = snapshot.intent?.providerPaymentId;

    if (paymentId) {
      runState.paymentId = paymentId;
      runState.phase = "payment-correlated";
      await writeState(runState);
    }

    const plusRows = snapshot.subscriptions.filter((subscription) =>
      [SubscriptionPlan.PLUS_MONTHLY, SubscriptionPlan.PLUS_YEARLY].includes(subscription.plan) &&
      subscription.status === SubscriptionStatus.ACTIVE);
    const plus = plusRows.find((subscription) => subscription.providerSubscriptionId);
    const succeededPaymentEvents = new Set(
      snapshot.webhookEvents
        .filter((event) => event.status === BillingWebhookStatus.SUCCEEDED)
        .map((event) => event.eventType),
    );
    const requiredEventsArrived = [
      "invoice.payment_made",
      "payment.created",
      "payment.updated",
      "subscription.created",
    ].every((eventType) => succeededPaymentEvents.has(eventType));

    if (
      snapshot.intent?.status === "completed" &&
      paymentId &&
      plus &&
      plusRows.length === 1 &&
      requiredEventsArrived
    ) {
      try {
        return await verifyRealProviderEvidence(runState, config, snapshot, plus);
      } catch (error) {
        const exactPayment = await retrieveSquarePayment(paymentId);
        return rescuePaidCorrelationFailure(
          runState,
          config,
          context,
          exactPayment ? [exactPayment] : [],
          `Provider evidence verification failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (Date.now() - lastProviderProbeAt >= 15_000) {
      exactOrderPayments = await searchSquarePaymentsByOrder({
        beginTime: squareQaExactOrderPaymentSearchBeginTime(runState.createdAt),
        orderId: runState.checkout.orderId,
      });
      const completed = exactOrderPayments.filter((payment) =>
        payment.status?.trim().toUpperCase() === "COMPLETED");
      if (completed.length) {
        assert.equal(completed.length, 1, "Square returned multiple completed payments for the exact QA order.");
        assertHostedPaymentMatches({
          buyerCustomerId: runState.buyer.customerId,
          intent: snapshot.intent,
          payment: completed[0],
          parsedCorrelation: parseSquareCheckoutCorrelation(completed[0].note),
          plan: config.plan,
        });
        runState.paymentId = completed[0].id;
        runState.phase = "provider-payment-observed-awaiting-correlation";
        await writeState(runState);
      }
      lastProviderProbeAt = Date.now();
    }

    if (Date.now() - lastStatusAt >= 15_000) {
      const eventNames = [...succeededPaymentEvents].sort().join(", ") || "none yet";
      status(
        `Waiting for real Square evidence: payment=${paymentId ? "correlated" : "pending"}, ` +
        `intent=${snapshot.intent?.status ?? "missing"}, subscription=${plus?.providerSubscriptionId ? "attached" : "pending"}, ` +
        `webhook events=${eventNames}.`,
      );
      lastStatusAt = Date.now();
    }
    await delay(POLL_MS);
  }

  exactOrderPayments = await searchSquarePaymentsByOrder({
    beginTime: squareQaExactOrderPaymentSearchBeginTime(runState.createdAt),
    orderId: runState.checkout.orderId,
  });
  const completedPayments = exactOrderPayments.filter((payment) =>
    payment.status?.trim().toUpperCase() === "COMPLETED");
  if (completedPayments.length) {
    return rescuePaidCorrelationFailure(runState, config, context, completedPayments);
  }

  throw new Error(
    "Timed out waiting for the completed payment, real invoice/payment/subscription webhooks, and the exact Square subscription. " +
    "The fixture was preserved so delayed Square retries can be observed safely.",
  );
}

async function verifyRealProviderEvidence(runState, config, snapshot, plus) {
  const intent = snapshot.intent;
  const payment = await retrieveSquarePayment(intent.providerPaymentId);
  const remoteSubscription = await retrieveSquareSubscription(plus.providerSubscriptionId);
  const order = await retrieveSquareOrder(intent.providerOrderId);
  const parsedCorrelation = parseSquareCheckoutCorrelation(payment?.note);

  assertHostedPaymentMatches({
    buyerCustomerId: runState.buyer.customerId,
    intent,
    payment,
    parsedCorrelation,
    plan: config.plan,
  });
  assert.equal(payment.id, intent.providerPaymentId);
  assert.equal(order?.id, intent.providerOrderId);
  assert.equal(plus.providerCustomerId, runState.buyer.customerId);
  assert.equal(remoteSubscription?.id, plus.providerSubscriptionId);
  assert.equal(remoteSubscription?.customer_id, runState.buyer.customerId);
  assert.equal(remoteSubscription?.plan_variation_id, config.planVariationId);
  assert.ok(!squareSubscriptionIsInactive(remoteSubscription), "The new Square subscription is already inactive.");

  assertEntitlementIsolation({
    afterOtherPlus: await stableOtherPlusSnapshot(runState.user.id),
    beforeOtherPlus: runState.entitlementBaseline.otherPlus,
    expectedCustomerId: runState.buyer.customerId,
    expectedPlan: config.plan === "yearly" ? SubscriptionPlan.PLUS_YEARLY : SubscriptionPlan.PLUS_MONTHLY,
    expectedSubscriptionId: plus.providerSubscriptionId,
    fixtureSubscriptions: snapshot.subscriptions,
  });

  const buyerOwnership = snapshot.billingCustomers.find((customer) =>
    customer.providerCustomerId === runState.buyer.customerId);
  assert.equal(buyerOwnership?.userId, runState.user.id);
  assert.equal(buyerOwnership?.provenance, BillingCustomerProvenance.PROVIDER_MATCHED);

  runState.providerSubscriptionId = plus.providerSubscriptionId;
  runState.evidence = {
    verifiedAt: new Date().toISOString(),
    intent: {
      expectedAmountMinor: intent.expectedAmountMinor,
      expectedCurrency: intent.expectedCurrency,
      id: intent.id,
      plan: intent.plan,
      providerCustomerId: intent.providerCustomerId,
      providerOrderId: intent.providerOrderId,
      providerPaymentId: intent.providerPaymentId,
    },
    order: {
      id: order.id,
      state: order.state ?? null,
    },
    payment: {
      customerId: payment.customer_id,
      id: payment.id,
      orderId: payment.order_id,
      status: payment.status,
    },
    subscription: {
      canceledDate: remoteSubscription.canceled_date ?? null,
      customerId: remoteSubscription.customer_id,
      id: remoteSubscription.id,
      planVariationId: remoteSubscription.plan_variation_id,
      status: remoteSubscription.status ?? null,
    },
    webhookEvents: webhookEvidence(snapshot.webhookEvents),
  };
  runState.phase = "provider-evidence-verified";
  await writeState(runState);
  return {
    intent,
    payment,
    plus,
    remoteSubscription,
    webhookEventTypes: [...new Set(snapshot.webhookEvents
      .filter((event) => event.status === BillingWebhookStatus.SUCCEEDED)
      .map((event) => event.eventType))].sort(),
  };
}

async function rescuePaidCorrelationFailure(
  runState,
  config,
  context,
  completedPayments,
  failureReason = "Completed Square payment was not fully correlated before the acceptance timeout.",
) {
  assert.equal(
    completedPayments.length,
    1,
    "Safe automatic cleanup requires exactly one completed payment for the QA order.",
  );
  const intent = await prisma.billingCheckoutIntent.findUnique({
    where: { id: runState.checkout.intentId },
  });
  assert.ok(intent, "The exact checkout intent disappeared before paid-failure cleanup.");
  assert.ok(completedPayments[0].id, "Square returned a completed payment without an ID.");
  const payment = await retrieveSquarePayment(completedPayments[0].id);
  assertHostedPaymentMatches({
    buyerCustomerId: runState.buyer.customerId,
    intent,
    payment,
    parsedCorrelation: parseSquareCheckoutCorrelation(payment?.note),
    plan: config.plan,
  });
  assert.equal(payment.id, completedPayments[0].id);
  runState.paymentId = payment.id;
  runState.failureCleanup.reason = failureReason;
  runState.phase = "paid-correlation-failure-cleanup-started";
  await writeState(runState);

  return continuePaidCorrelationFailureCleanup(runState, config, context);
}

async function continuePaidCorrelationFailureCleanup(runState, config, context) {
  const resumeStage = paidFailureCleanupResumeStage(runState);
  assert.ok(resumeStage, "Paid-failure cleanup was resumed without a durable failure marker.");
  status(`Resuming fenced sandbox paid-failure cleanup at ${resumeStage}...`);

  const databaseIntent = runState.checkout.intentId
    ? await prisma.billingCheckoutIntent.findUnique({ where: { id: runState.checkout.intentId } })
    : null;
  const intent = databaseIntent ?? {
    expectedAmountMinor: config.amountMinor,
    expectedCurrency: "GBP",
    id: runState.checkout.intentId,
    idempotencyKey: runState.checkout.idempotencyKey,
    plan: config.plan === "yearly" ? SubscriptionPlan.PLUS_YEARLY : SubscriptionPlan.PLUS_MONTHLY,
    providerCustomerId: runState.appCustomerId,
    providerOrderId: runState.checkout.orderId,
    providerPaymentId: runState.paymentId,
  };
  assert.equal(intent.id, runState.checkout.intentId, "The paid-failure checkout intent ID changed.");
  assert.equal(intent.providerOrderId, runState.checkout.orderId, "The paid-failure order ID changed.");
  assert.equal(intent.expectedAmountMinor, config.amountMinor, "The paid-failure amount changed.");
  assert.equal(intent.expectedCurrency?.trim().toUpperCase(), "GBP", "The paid-failure currency changed.");

  const [payment, order] = await Promise.all([
    retrieveSquarePayment(runState.paymentId),
    retrieveSquareOrder(runState.checkout.orderId),
  ]);
  assertHostedPaymentMatches({
    buyerCustomerId: runState.buyer.customerId,
    intent,
    payment,
    parsedCorrelation: parseSquareCheckoutCorrelation(payment?.note),
    plan: config.plan,
  });
  assert.equal(payment.id, runState.paymentId, "The paid-failure payment ID changed.");
  assert.equal(order?.id, runState.checkout.orderId, "Square did not return the exact paid-failure order.");

  status("A completed exact-order payment did not correlate in time; beginning fenced sandbox cleanup...");
  await deleteExactRunPaymentLink(runState, {
    deletedAtKey: "paymentLinkDeletedAt",
    startedAtKey: "paymentLinkDeletionStartedAt",
    target: runState,
  });
  await ensureExactRefund(runState, {
    amountMinor: intent.expectedAmountMinor,
    currency: intent.expectedCurrency,
    paymentId: runState.paymentId,
  });

  const buyerCustomer = await retrieveSquareCustomer(runState.buyer.customerId);
  if (runState.buyerDeletedAt) {
    assert.equal(buyerCustomer, null, "The paid-failure buyer customer reappeared after deletion.");
  } else if (buyerCustomer) {
    assert.equal(buyerCustomer?.referenceId, runState.buyer.referenceId, "The paid buyer no longer has the run marker.");
  } else {
    assert.ok(
      runState.buyerDeletionStartedAt && runState.failureCleanup.subscriptionIds.length,
      "The paid buyer disappeared before exact subscription IDs and deletion intent were checkpointed.",
    );
  }
  let subscriptions = [];
  if (runState.failureCleanup.subscriptionIds.length) {
    subscriptions = await Promise.all(
      runState.failureCleanup.subscriptionIds.map((id) => retrieveSquareSubscription(id)),
    );
    assert.ok(subscriptions.every(Boolean), "A checkpointed paid-failure subscription cannot be re-retrieved exactly.");
  } else {
    assert.ok(buyerCustomer, "The buyer disappeared before its subscriptions were checkpointed.");
    subscriptions = await waitFor(async () => {
      const found = await searchSquareSubscriptions(runState.buyer.customerId);
      return found.length ? found : null;
    }, { description: "the paid checkout's Square subscription before failure cleanup", timeoutMs: 120_000 });
  }
  for (const subscription of subscriptions) {
    assert.ok(subscription.id, "Square returned a subscription without an ID.");
    assert.equal(subscription.customer_id, runState.buyer.customerId);
    assert.equal(
      subscription.plan_variation_id,
      config.planVariationId,
      "Refusing to cancel a subscription outside the exact QA plan variation.",
    );
  }
  const subscriptionIds = subscriptions.map((subscription) => subscription.id).sort();
  if (!runState.failureCleanup.subscriptionIds.length) {
    runState.failureCleanup.subscriptionIds = subscriptionIds;
    await writeState(runState);
  } else {
    const checkpointed = [...runState.failureCleanup.subscriptionIds].sort();
    assert.deepEqual(subscriptionIds, checkpointed, "The exact paid-failure subscription set changed.");
  }
  for (const subscription of subscriptions) {
    if (
      !squareSubscriptionIsInactive(subscription) &&
      !squareSubscriptionHasScheduledCancellation(subscription)
    ) {
      await cancelSquareSubscription(subscription.id);
    }
  }
  await waitFor(async () => {
    const current = await Promise.all(
      runState.failureCleanup.subscriptionIds.map((id) => retrieveSquareSubscription(id)),
    );
    assertExactBuyerSubscriptions(runState, runState.failureCleanup.subscriptionIds, current);
    return current.every((subscription) =>
      squareSubscriptionIsInactive(subscription) ||
      squareSubscriptionHasScheduledCancellation(subscription))
      ? current
      : null;
  }, { description: "all exact paid-failure subscriptions to schedule cancellation", timeoutMs: 120_000 });

  await deleteDisposableAccount(runState, config, context);
  await deleteRunOwnedBuyerAfterPaidCleanup(
    runState,
    runState.failureCleanup.subscriptionIds,
  );
  if (!runState.failureCleanup.providerInactiveAt) {
    runState.failureCleanup.providerInactiveAt = new Date().toISOString();
    runState.phase = "paid-failure-subscriptions-terminal";
    await writeState(runState);
  }
  assert.equal(await retrieveSquareCustomer(runState.appCustomerId), null);
  assert.equal(await retrieveSquareCustomer(runState.buyer.customerId), null);
  assert.equal(
    await prisma.user.findUnique({ where: { id: runState.user.id }, select: { id: true } }),
    null,
  );

  await assertOtherEntitlementsUnchanged(runState);
  runState.phase = "paid-correlation-failure-cleaned";
  await writeState(runState);
  const reportPath = await writeSanitizedFailureReport(runState, {
    amountMinor: intent.expectedAmountMinor,
    currency: intent.expectedCurrency,
    otherEntitlementsUnchanged: true,
    orderId: intent.providerOrderId,
    paymentId: runState.paymentId,
    reason: runState.failureCleanup.reason,
    subscriptionIds: runState.failureCleanup.subscriptionIds,
  });
  await rm(statePath(runState.runId), { force: true });
  throw new SafelyCleanedAcceptanceFailure(
    "Hosted-checkout acceptance failed, but the exact sandbox payment and fixtures were safely cleaned up.",
    reportPath,
  );
}

async function ensureExactRefund(runState, { amountMinor, currency, paymentId }) {
  assert.ok(Number.isSafeInteger(amountMinor) && amountMinor > 0, "The exact refund amount is missing.");
  assert.ok(currency, "The exact refund currency is missing.");
  assert.ok(paymentId, "The exact payment ID is missing.");
  if (runState.refund.completedAt) {
    const saved = await retrieveSquareRefund(runState.refund.id);
    assert.equal(saved?.payment_id, paymentId);
    assert.equal(saved?.amount_money?.amount, amountMinor);
    assert.equal(saved?.amount_money?.currency?.toUpperCase(), currency.toUpperCase());
    assert.equal(saved?.status?.toUpperCase(), "COMPLETED");
    return saved;
  }

  status("Refunding the exact sandbox payment...");
  if (!runState.refund.startedAt) {
    runState.refund.startedAt = new Date().toISOString();
    runState.phase = "refund-started";
    await writeState(runState);
  }
  let refund = runState.refund.id ? await retrieveSquareRefund(runState.refund.id) : null;
  if (!refund) {
    refund = await refundSquarePayment({
      amountMinor,
      currency,
      idempotencyKey: runState.refund.idempotencyKey,
      paymentId,
    });
    runState.refund.id = refund.id;
    await writeState(runState);
  }
  const completedRefund = await waitFor(async () => {
    const current = await retrieveSquareRefund(runState.refund.id);
    return current?.status?.trim().toUpperCase() === "COMPLETED" ? current : null;
  }, { description: "the exact Square sandbox refund", timeoutMs: 90_000 });
  assert.equal(completedRefund.payment_id, paymentId);
  assert.equal(completedRefund.amount_money?.amount, amountMinor);
  assert.equal(completedRefund.amount_money?.currency?.toUpperCase(), currency.toUpperCase());
  runState.refund.completedAt = new Date().toISOString();
  runState.phase = "refund-completed";
  await writeState(runState);
  return completedRefund;
}

async function deleteDisposableAccount(runState, config, context) {
  if (runState.accountDeletedAt) {
    assert.equal(
      await prisma.user.findUnique({ where: { id: runState.user.id }, select: { id: true } }),
      null,
    );
    return;
  }
  const currentUser = await prisma.user.findUnique({
    where: { id: runState.user.id },
    select: { id: true },
  });
  if (currentUser) {
    assert.ok(context, "An authenticated app session is required for billing-aware account deletion.");
    if (!runState.accountDeletionStartedAt) {
      runState.accountDeletionStartedAt = new Date().toISOString();
      runState.phase = "account-deletion-started";
      await writeState(runState);
    }
    status("Deleting the disposable account through the billing-aware account endpoint...");
    const deleteResponse = await context.request.delete(`${config.baseUrl}/api/account`, {
      data: {
        confirmation: "DELETE MY ACCOUNT",
        email: runState.user.email,
        password: runState.user.password,
      },
      headers: { origin: config.baseUrl },
    });
    const deleteBody = await deleteResponse.json().catch(() => ({}));
    assert.equal(
      deleteResponse.status(),
      200,
      deleteBody.error ?? `Account deletion returned ${deleteResponse.status()}.`,
    );
  } else {
    assert.ok(
      runState.accountDeletionStartedAt,
      "The disposable user disappeared before billing-aware account deletion began.",
    );
  }
  assert.equal(
    await prisma.user.findUnique({ where: { id: runState.user.id }, select: { id: true } }),
    null,
  );
  runState.accountDeletedAt = new Date().toISOString();
  runState.phase = "account-deleted";
  await writeState(runState);
}

async function restoreProviderEvidence(runState, config) {
  status("Restoring the exact provider evidence saved before cleanup...");
  const saved = runState.evidence;
  assert.ok(saved?.payment?.id, "Saved evidence is missing the exact Square payment ID.");
  assert.ok(saved?.subscription?.id, "Saved evidence is missing the exact Square subscription ID.");

  const [databaseIntent, payment, remoteSubscription, order] = await Promise.all([
    runState.checkout.intentId
      ? prisma.billingCheckoutIntent.findUnique({ where: { id: runState.checkout.intentId } })
      : null,
    retrieveSquarePayment(saved.payment.id),
    retrieveSquareSubscription(saved.subscription.id),
    retrieveSquareOrder(saved.intent.providerOrderId),
  ]);
  const intent = databaseIntent ?? {
    ...saved.intent,
    idempotencyKey: runState.checkout.idempotencyKey,
  };
  assert.equal(intent.id, saved.intent.id, "The restored checkout intent ID changed.");
  assert.equal(intent.expectedAmountMinor, saved.intent.expectedAmountMinor);
  assert.equal(intent.expectedCurrency, saved.intent.expectedCurrency);
  assert.equal(intent.providerOrderId, saved.intent.providerOrderId);
  assert.equal(intent.providerPaymentId, saved.payment.id);

  assertHostedPaymentMatches({
    buyerCustomerId: runState.buyer.customerId,
    intent,
    payment,
    parsedCorrelation: parseSquareCheckoutCorrelation(payment?.note),
    plan: config.plan,
  });
  assert.equal(order?.id, saved.intent.providerOrderId);
  assert.equal(remoteSubscription?.id, saved.subscription.id);
  assert.equal(remoteSubscription?.customer_id, runState.buyer.customerId);
  assert.equal(remoteSubscription?.plan_variation_id, config.planVariationId);

  return {
    intent,
    payment,
    plus: {
      providerCustomerId: saved.subscription.customerId,
      providerSubscriptionId: saved.subscription.id,
    },
    remoteSubscription,
    webhookEventTypes: [...new Set((saved.webhookEvents ?? []).map((event) => event.eventType))].sort(),
  };
}

async function proveWebhookIdempotence(runState, config, evidence) {
  status("Proving semantic and event-ID idempotence against the real webhook route...");
  assert.equal(
    await prisma.user.findUnique({ where: { id: runState.user.id }, select: { id: true } })
      .then((user) => user?.id ?? null),
    runState.user.id,
    "The disposable user disappeared before idempotence could be proved.",
  );
  if (!runState.idempotence.beforeSnapshot) {
    runState.idempotence.beforeSnapshot = await stableBillingSnapshot(
      runState.user.id,
      runState.checkout.intentId,
    );
    await writeState(runState);
  }
  if (!runState.idempotence.eventId) {
    runState.idempotence.eventId = `mintbinder_square_qa_${runState.runId}_${randomUUID()}`;
    runState.idempotence.payloadCreatedAt = new Date().toISOString();
    await writeState(runState);
  }
  const eventId = runState.idempotence.eventId;
  const payload = JSON.stringify({
    created_at: runState.idempotence.payloadCreatedAt,
    data: {
      id: evidence.payment.id,
      object: { payment: { id: evidence.payment.id } },
      type: "payment",
    },
    event_id: eventId,
    merchant_id: "mintbinder_square_hosted_qa",
    type: "payment.updated",
  });
  const signature = createSquareWebhookSignatureHeader({
    notificationUrl: config.webhookUrl,
    payload,
    signatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY.trim(),
  });
  const first = await postSignedWebhook(config.webhookUrl, payload, signature);
  assert.equal(first.status, 200);
  assert.equal(first.body.handled, false);
  if (first.body.duplicate === false) {
    assert.match(first.body.message ?? "", /already correlated/i);
  } else {
    assert.equal(first.body.duplicate, true, "The first semantic replay returned an invalid result.");
  }

  const persistedEvent = await prisma.billingWebhookEvent.findUnique({
    where: {
      provider_providerEventId: {
        provider: "square",
        providerEventId: eventId,
      },
    },
  });
  assert.equal(persistedEvent?.status, BillingWebhookStatus.SUCCEEDED);
  assert.equal(persistedEvent?.eventType, "payment.updated");
  assert.equal(persistedEvent?.resourceId, evidence.payment.id);

  const second = await postSignedWebhook(config.webhookUrl, payload, signature);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.handled, false);

  const after = await stableBillingSnapshot(runState.user.id, runState.checkout.intentId);
  assert.deepEqual(
    after,
    runState.idempotence.beforeSnapshot,
    "Duplicate payment processing changed subscription or checkout state.",
  );
  runState.idempotence.provedAt = new Date().toISOString();
  runState.phase = "idempotence-proved";
  await writeState(runState);
}

async function cancelRefundAndDelete(runState, config, evidence, context) {
  const subscriptionId = evidence.plus.providerSubscriptionId;
  if (runState.cancellation.subscriptionUpdatedBaselineEventIds === null) {
    runState.cancellation.subscriptionUpdatedBaselineEventIds = (
      await succeededWebhookEventsByType(runState, "subscription.updated")
    ).map((event) => event.providerEventId);
    await writeState(runState);
  }

  if (!runState.cancellation.providerScheduledAt) {
    const currentRemote = await retrieveSquareSubscription(subscriptionId);
    assert.equal(currentRemote?.id, subscriptionId, "Square did not return the exact QA subscription.");
    assert.equal(currentRemote?.customer_id, runState.buyer.customerId);
    if (squareSubscriptionIsInactive(currentRemote) && !runState.cancellation.startedAt) {
      throw new Error("The QA subscription became inactive before this run checkpointed cancellation.");
    }
    if (
      !squareSubscriptionIsInactive(currentRemote) &&
      !squareSubscriptionHasScheduledCancellation(currentRemote)
    ) {
      assert.ok(context, "An authenticated app session is required to cancel this run.");
      if (!runState.cancellation.startedAt) {
        runState.cancellation.startedAt = new Date().toISOString();
        runState.phase = "cancellation-started";
        await writeState(runState);
      }
      status("Cancelling renewal through the authenticated Mint Binder API...");
      const cancelResponse = await context.request.patch(`${config.baseUrl}/api/billing/subscription`, {
        data: { action: "cancel" },
        headers: { origin: config.baseUrl },
      });
      const cancelBody = await cancelResponse.json().catch(() => ({}));
      assert.equal(
        cancelResponse.status(),
        200,
        cancelBody.error ?? `Cancellation returned ${cancelResponse.status()}.`,
      );
      assert.equal(cancelBody.subscription?.cancelAtPeriodEnd, true);
      assert.equal(cancelBody.subscription?.plan, "plus");
      assert.ok(new Date(cancelBody.subscription?.currentPeriodEnd).getTime() > Date.now());
    }

    const scheduledRemote = await waitFor(async () => {
      const subscription = await retrieveSquareSubscription(subscriptionId);
      assert.equal(subscription?.id, subscriptionId, "Square returned a different subscription during cancellation.");
      assert.equal(subscription?.customer_id, runState.buyer.customerId);
      assert.ok(
        !squareSubscriptionIsInactive(subscription),
        "The subscription became terminal before retained paid access could be verified.",
      );
      return squareSubscriptionHasScheduledCancellation(subscription) ? subscription : null;
    }, { description: "Square scheduled-cancellation truth", timeoutMs: 90_000 });
    assert.equal(scheduledRemote.id, subscriptionId);
    runState.cancellation.providerScheduledAt = new Date().toISOString();
    runState.phase = "provider-cancellation-scheduled";
    await writeState(runState);
  }

  if (!runState.cancellation.accessVerifiedAt) {
    assert.ok(context, "An authenticated app session is required to verify retained paid access.");
    const stillPlusResponse = await context.request.get(`${config.baseUrl}/api/billing/subscription`);
    const stillPlus = await stillPlusResponse.json();
    assert.equal(stillPlusResponse.status(), 200);
    assert.equal(stillPlus.subscription?.plan, "plus");
    assert.equal(stillPlus.subscription?.cancelAtPeriodEnd, true);
    runState.cancellation.accessVerifiedAt = new Date().toISOString();
    await writeState(runState);
  }

  if (!runState.cancellation.webhookObservedAt) {
    assert.ok(runState.cancellation.startedAt, "The cancellation start checkpoint is missing.");
    const cancellationEvent = await waitFor(async () => {
      const events = await succeededWebhookEventsByType(runState, "subscription.updated");
      return findPostCancellationWebhookEvent(events, {
        baselineProviderEventIds: runState.cancellation.subscriptionUpdatedBaselineEventIds,
        resourceId: subscriptionId,
        startedAt: runState.cancellation.startedAt,
      });
    }, { description: "a real post-cancellation subscription.updated webhook", timeoutMs: 120_000 });
    runState.cancellation.webhookProviderEventId = cancellationEvent.providerEventId;
    runState.cancellation.webhookObservedAt = new Date().toISOString();
    runState.phase = "cancellation-webhook-verified";
    await writeState(runState);
  }

  await ensureExactRefund(runState, {
    amountMinor: evidence.intent.expectedAmountMinor,
    currency: evidence.intent.expectedCurrency,
    paymentId: evidence.payment.id,
  });

  await deleteExactRunPaymentLink(runState, {
    deletedAtKey: "paymentLinkDeletedAt",
    startedAtKey: "paymentLinkDeletionStartedAt",
    target: runState,
  });
  await waitForWebhookQuiescence(runState);
  const realWebhookEventRows = await succeededWebhookEvents(runState, {
    excludedProviderEventId: runState.idempotence.eventId,
  });
  const realWebhookEvents = [...new Set(realWebhookEventRows.map((event) => event.eventType))].sort();
  const missingWebhookEvents = REQUIRED_SQUARE_WEBHOOK_EVENTS.filter(
    (eventType) => !realWebhookEvents.includes(eventType),
  );
  assert.deepEqual(
    missingWebhookEvents,
    [],
    `The hosted run did not produce every required real Square webhook: ${missingWebhookEvents.join(", ")}.`,
  );
  runState.evidence.webhookEvents = webhookEvidence(realWebhookEventRows);
  await writeState(runState);

  await deleteDisposableAccount(runState, config, context);
  await deleteRunOwnedBuyerAfterPaidCleanup(runState, [subscriptionId]);
  if (!runState.cancellation.providerInactiveAt) {
    runState.cancellation.providerInactiveAt = new Date().toISOString();
    runState.phase = "provider-subscription-terminal";
    await writeState(runState);
  }
  assert.equal(await retrieveSquareCustomer(runState.appCustomerId), null, "The app-created QA customer was not removed.");
  assert.equal(await retrieveSquareCustomer(runState.buyer.customerId), null, "The run-scoped buyer customer was not removed.");
  await assertOtherEntitlementsUnchanged(runState);
  runState.phase = "cleaned";
  await writeState(runState);
  return { realWebhookEvents };
}

async function abortUnpaidRun(runState) {
  assertStateMatchesSettings(runState, settings, { requireCommit: false });
  await hydrateAbortStateFromDurableIntent(runState);
  if (runState.evidence || runState.paymentId) {
    throw new Error("This run has payment evidence and cannot use unpaid abort. Resume it for verified cleanup.");
  }
  // Never destroy a known link, local user, or known customer while another
  // customer creation might have succeeded without its response being saved.
  // Resume replays the persisted idempotency key and recovers that exact ID.
  assertSquareQaCustomerCreationOutcomesKnown(runState);

  // Retire the checkout first. A Square payment-link order can remain OPEN
  // even after payment, so order state is never used as proof that raw fixture
  // deletion is safe.
  if (runState.checkout.paymentLinkId && !runState.abort.paymentLinkDeletedAt) {
    await deleteExactRunPaymentLink(runState, {
      deletedAtKey: "paymentLinkDeletedAt",
      requireCanceledOrder: true,
      startedAtKey: "paymentLinkDeletionStartedAt",
      target: runState.abort,
    });
    runState.abort.observationStartedAt = runState.abort.paymentLinkDeletedAt;
    runState.phase = "abort-link-retired";
    await writeState(runState);
  }

  if (runState.checkout.orderId) {
    if (!runState.abort.observationStartedAt) {
      runState.abort.observationStartedAt = new Date().toISOString();
      await writeState(runState);
    }
    const observeUntil = new Date(runState.abort.observationStartedAt).getTime() + ABORT_PAYMENT_SETTLE_MS;
    do {
      await assertNoExactOrderPaymentEvidence(runState, { requireCanceledOrder: true });
      if (Date.now() < observeUntil) await delay(POLL_MS);
    } while (Date.now() < observeUntil);
  } else {
    assert.equal(runState.checkout.paymentLinkId, null, "A payment link without its exact order cannot be aborted safely.");
    assert.equal(runState.checkout.url, null, "A checkout URL without exact provider IDs cannot be aborted safely.");
    if (runState.checkout.creationAttemptStartedAt && !runState.checkout.creationRejectedAt) {
      throw new Error(
        "Square checkout creation has an unconfirmed outcome. Resume to recover its exact idempotent resource before aborting.",
      );
    }
    await assertNoExactOrderPaymentEvidence(runState);
  }

  for (const customer of [
    [runState.appCustomerId, runState.user.id],
    [runState.buyer.customerId, runState.buyer.referenceId],
  ]) {
    if (!customer[0]) continue;
    const subscriptions = await searchSquareSubscriptions(customer[0]);
    if (subscriptions.some((subscription) => !squareSubscriptionIsInactive(subscription))) {
      throw new Error(`Customer ${customer[0]} has a non-terminal Square subscription; abort is forbidden.`);
    }
  }

  // Final provider and local check immediately before any raw deletion closes
  // the race between link retirement and eventual payment visibility.
  await assertNoExactOrderPaymentEvidence(runState, { requireCanceledOrder: true });
  if (runState.buyer.customerId) {
    await deleteRunOwnedCustomer(runState.buyer.customerId, runState.buyer.referenceId);
  }
  if (runState.appCustomerId) {
    await deleteRunOwnedCustomer(runState.appCustomerId, runState.user.id);
  }
  if (runState.user.id) {
    const user = await prisma.user.findUnique({
      where: { id: runState.user.id },
      select: { displayName: true, email: true, id: true },
    });
    if (user) {
      assert.ok(isSquareQaFixtureIdentity({ ...user, runId: runState.runId }));
      await prisma.user.delete({ where: { id: user.id } });
    }
  }
  if (runState.appCustomerId) {
    assert.equal(
      await retrieveSquareCustomer(runState.appCustomerId),
      null,
      "The app-prepared Square customer survived unpaid abort.",
    );
  }
  if (runState.buyer.customerId) {
    assert.equal(
      await retrieveSquareCustomer(runState.buyer.customerId),
      null,
      "The run-scoped buyer customer survived unpaid abort.",
    );
  }
  if (runState.user.id) {
    assert.equal(
      await prisma.user.findUnique({ where: { id: runState.user.id }, select: { id: true } }),
      null,
      "The disposable Mint Binder user survived unpaid abort.",
    );
  }
  await rm(statePath(runState.runId), { force: true });
}

async function hydrateAbortStateFromDurableIntent(runState) {
  if (!runState.checkout.intentId) return;
  const intent = await prisma.billingCheckoutIntent.findUnique({
    where: { id: runState.checkout.intentId },
  });
  if (!intent) {
    throw new Error("The saved checkout intent no longer exists; refusing partial-run cleanup.");
  }
  const expectation = squareCheckoutExpectation(runState.plan);
  const expectedPlan = runState.plan === "yearly"
    ? SubscriptionPlan.PLUS_YEARLY
    : SubscriptionPlan.PLUS_MONTHLY;
  assert.equal(intent.userId, runState.user.id, "The saved checkout intent belongs to another user.");
  assert.equal(intent.provider, "square");
  assert.equal(intent.plan, expectedPlan);
  assert.equal(intent.idempotencyKey, runState.checkout.idempotencyKey);
  assert.equal(intent.providerCustomerId, runState.appCustomerId);
  assert.equal(intent.checkoutOrigin, runState.baseUrl);
  assert.equal(intent.expectedAmountMinor, expectation.amountMinor);
  assert.equal(intent.expectedCurrency, expectation.currency);
  assert.equal(intent.providerPlanVariationId, expectation.planVariationId);

  for (const [stateKey, providerValue] of [
    ["paymentLinkId", intent.providerCheckoutId],
    ["orderId", intent.providerOrderId],
    ["url", intent.checkoutUrl],
  ]) {
    const savedValue = runState.checkout[stateKey];
    if (savedValue && providerValue) {
      assert.equal(savedValue, providerValue, `The saved checkout ${stateKey} differs from durable provider state.`);
    }
    if (!savedValue && providerValue) runState.checkout[stateKey] = providerValue;
  }
  if (intent.providerPaymentId) runState.paymentId = intent.providerPaymentId;
  if (["completed", "paid_pending_subscription"].includes(intent.status)) {
    throw new Error("The checkout intent has paid provider state; unpaid abort is forbidden.");
  }

  const hasAnyCheckoutState = Boolean(
    runState.checkout.paymentLinkId || runState.checkout.orderId || runState.checkout.url,
  );
  const hasCompleteCheckoutState = Boolean(
    runState.checkout.paymentLinkId && runState.checkout.orderId && runState.checkout.url,
  );
  assert.equal(
    hasAnyCheckoutState,
    hasCompleteCheckoutState,
    "Partial durable checkout identity cannot be aborted safely.",
  );
  await writeState(runState);
}

async function deleteExactRunPaymentLink(runState, {
  deletedAtKey,
  requireCanceledOrder = false,
  startedAtKey,
  target,
}) {
  const paymentLinkId = runState.checkout.paymentLinkId;
  if (!paymentLinkId) return;

  const intent = runState.checkout.intentId
    ? await prisma.billingCheckoutIntent.findUnique({
        where: { id: runState.checkout.intentId },
        select: { providerCheckoutId: true, providerOrderId: true },
      })
    : null;
  if (intent?.providerCheckoutId) {
    assert.equal(intent.providerCheckoutId, paymentLinkId, "The database intent points to another payment link.");
  }
  if (intent?.providerOrderId) {
    assert.equal(intent.providerOrderId, runState.checkout.orderId, "The database intent points to another Square order.");
  }

  const link = await retrieveSquarePaymentLink(paymentLinkId);
  if (target[deletedAtKey]) {
    assert.equal(link, null, "A deleted Square payment link unexpectedly reappeared.");
    if (requireCanceledOrder) {
      assert.equal(target.cancelledOrderId, runState.checkout.orderId);
      assert.ok(target.cancellationProvedAt, "The unpaid abort cancellation proof is missing.");
      const order = await retrieveSquareOrder(runState.checkout.orderId);
      assert.equal(order?.id, runState.checkout.orderId);
      assert.equal(order?.state?.trim().toUpperCase(), "CANCELED");
    }
    return;
  }
  let deletion = null;
  if (link) {
    assertRunPaymentLink(link, {
      orderId: runState.checkout.orderId,
      paymentLinkId,
    });
    if (!target[startedAtKey]) {
      target[startedAtKey] = new Date().toISOString();
      await writeState(runState);
    }
    deletion = await deleteSquarePaymentLink(paymentLinkId);
  }
  assert.equal(
    await retrieveSquarePaymentLink(paymentLinkId),
    null,
    "Square still returns the exact payment link after deletion.",
  );
  if (requireCanceledOrder) {
    const order = await retrieveSquareOrder(runState.checkout.orderId);
    assert.equal(order?.id, runState.checkout.orderId, "Square did not return the exact unpaid order.");
    assert.equal(
      order?.state?.trim().toUpperCase(),
      "CANCELED",
      "Unpaid cleanup requires the exact Square order to be canceled.",
    );
    if (deletion) {
      assert.equal(deletion.id, paymentLinkId, "Square deleted a different payment link.");
      assert.equal(
        deletion.cancelledOrderId,
        runState.checkout.orderId,
        "Square did not cancel the exact unpaid checkout order.",
      );
      target.cancellationProof = "delete-response";
    } else {
      assert.ok(
        target[startedAtKey],
        "An absent payment link without a prior deletion checkpoint is not safe to recover.",
      );
      target.cancellationProof = "canceled-order-response-loss";
    }
    target.cancelledOrderId = runState.checkout.orderId;
    target.cancellationProvedAt = new Date().toISOString();
  }
  target[deletedAtKey] = new Date().toISOString();
  await writeState(runState);
}

async function assertNoExactOrderPaymentEvidence(
  runState,
  { requireCanceledOrder = false } = {},
) {
  const intent = runState.checkout.intentId
    ? await prisma.billingCheckoutIntent.findUnique({ where: { id: runState.checkout.intentId } })
    : null;
  if (intent?.providerPaymentId || intent?.status === "completed") {
    runState.paymentId = intent.providerPaymentId ?? runState.paymentId;
    await writeState(runState);
    throw new Error("The checkout intent has payment evidence; unpaid abort is forbidden. Resume the run.");
  }

  if (!runState.checkout.orderId) return;
  const [payments, order] = await Promise.all([
    searchSquarePaymentsByOrder({
      beginTime: squareQaExactOrderPaymentSearchBeginTime(runState.createdAt),
      orderId: runState.checkout.orderId,
    }),
    retrieveSquareOrder(runState.checkout.orderId),
  ]);
  assert.ok(Array.isArray(payments), "Square returned malformed exact-order payment evidence.");
  if (order?.tenders != null) {
    assert.ok(Array.isArray(order.tenders), "Square returned malformed exact-order tender evidence.");
  }
  if (requireCanceledOrder) {
    assert.equal(order?.id, runState.checkout.orderId, "Square did not return the exact unpaid order.");
    assert.equal(
      order?.state?.trim().toUpperCase(),
      "CANCELED",
      "Unpaid cleanup requires the exact Square order to remain canceled.",
    );
  }
  const tenders = Array.isArray(order?.tenders) ? order.tenders : [];
  if (payments.length || tenders.length) {
    runState.paymentId = payments[0]?.id ?? runState.paymentId;
    runState.phase = "payment-evidence-detected";
    await writeState(runState);
    throw new Error(
      "Square reports payment or tender evidence for this exact order; raw abort is forbidden. Resume the run.",
    );
  }
}

async function deleteRunOwnedBuyerAfterPaidCleanup(runState, subscriptionIds) {
  assert.ok(runState.accountDeletedAt, "The disposable account must be deleted before its paid buyer cleanup.");
  assert.ok(runState.paymentLinkDeletedAt, "The exact payment link must be deleted before buyer cleanup.");
  assert.ok(runState.refund?.completedAt, "The exact payment must be refunded before buyer cleanup.");
  const expectedSubscriptionIds = [...new Set(subscriptionIds)].sort();
  assert.ok(expectedSubscriptionIds.length, "Buyer cleanup requires at least one exact subscription ID.");
  assert.equal(
    expectedSubscriptionIds.length,
    subscriptionIds.length,
    "Buyer cleanup received duplicate subscription IDs.",
  );

  const buyerCustomer = await retrieveSquareCustomer(runState.buyer.customerId);
  const beforeSubscriptions = await Promise.all(
    expectedSubscriptionIds.map((id) => retrieveSquareSubscription(id)),
  );
  assertExactBuyerSubscriptions(runState, expectedSubscriptionIds, beforeSubscriptions);

  if (runState.buyerDeletedAt) {
    assert.equal(buyerCustomer, null, "The run-owned buyer customer reappeared after deletion.");
    assert.ok(
      beforeSubscriptions.every(squareSubscriptionIsInactive),
      "A subscription reactivated after buyer cleanup completed.",
    );
    return beforeSubscriptions;
  }

  if (buyerCustomer) {
    assert.equal(
      buyerCustomer.referenceId,
      runState.buyer.referenceId,
      "Refusing to delete a Square buyer without the exact run marker.",
    );
    assert.ok(
      beforeSubscriptions.every((subscription) =>
        squareSubscriptionIsInactive(subscription) ||
        squareSubscriptionHasScheduledCancellation(subscription)),
      "Refusing to force terminal cleanup before every exact subscription has cancellation proof.",
    );
    if (!runState.buyerDeletionStartedAt) {
      runState.buyerDeletionStartedAt = new Date().toISOString();
      runState.phase = "buyer-deletion-started";
      await writeState(runState);
    }
    await deleteSquareCustomer(runState.buyer.customerId);
  } else {
    assert.ok(
      runState.buyerDeletionStartedAt,
      "The run-owned buyer disappeared before its deletion checkpoint.",
    );
  }

  const terminalSubscriptions = await waitFor(async () => {
    const [currentBuyer, ...currentSubscriptions] = await Promise.all([
      retrieveSquareCustomer(runState.buyer.customerId),
      ...expectedSubscriptionIds.map((id) => retrieveSquareSubscription(id)),
    ]);
    assertExactBuyerSubscriptions(runState, expectedSubscriptionIds, currentSubscriptions);
    return currentBuyer === null && currentSubscriptions.every(squareSubscriptionIsInactive)
      ? currentSubscriptions
      : null;
  }, { description: "the exact buyer subscriptions to become terminal", timeoutMs: 120_000 });

  if (runState.failureCleanup?.reason) {
    assert.ok(
      canRecoverPaidFailureBuyerDeletion(runState, null, terminalSubscriptions),
      "Paid-failure buyer deletion did not satisfy every crash-recovery gate.",
    );
  }
  runState.buyerDeletedAt = new Date().toISOString();
  runState.phase = "buyer-deletion-verified-terminal";
  await writeState(runState);
  return terminalSubscriptions;
}

function assertExactBuyerSubscriptions(runState, expectedSubscriptionIds, subscriptions) {
  assert.ok(Array.isArray(subscriptions), "Square returned malformed exact subscription evidence.");
  assert.ok(subscriptions.every(Boolean), "An exact Square subscription could not be re-retrieved.");
  assert.deepEqual(
    subscriptions.map((subscription) => subscription.id).sort(),
    [...expectedSubscriptionIds].sort(),
    "Square returned a different subscription during buyer cleanup.",
  );
  for (const subscription of subscriptions) {
    assert.equal(
      subscription.customer_id,
      runState.buyer.customerId,
      "A subscription no longer belongs to the exact run-owned buyer.",
    );
  }
}

async function deleteRunOwnedCustomer(customerId, referenceId) {
  const customer = await retrieveSquareCustomer(customerId);
  if (!customer) return;
  assert.equal(customer.referenceId, referenceId, "Refusing to delete a Square customer with a different run marker.");
  const subscriptions = await searchSquareSubscriptions(customerId);
  if (subscriptions.some((subscription) => !squareSubscriptionIsInactive(subscription))) {
    throw new Error("Refusing to delete a Square customer with a non-terminal subscription.");
  }
  await deleteSquareCustomer(customerId);
}

async function runSnapshot(runState) {
  const [intent, subscriptions, billingCustomers] = await Promise.all([
    prisma.billingCheckoutIntent.findUnique({ where: { id: runState.checkout.intentId } }),
    prisma.subscription.findMany({ where: { userId: runState.user.id }, orderBy: { createdAt: "asc" } }),
    prisma.billingCustomer.findMany({ where: { userId: runState.user.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const providerSubscriptionId = runState.providerSubscriptionId ?? subscriptions
    .find((subscription) => subscription.providerSubscriptionId)?.providerSubscriptionId;
  const webhookEvents = await prisma.billingWebhookEvent.findMany({
    where: exactWebhookWhere(runState, {
      paymentId: intent?.providerPaymentId ?? runState.paymentId,
      subscriptionId: providerSubscriptionId,
    }),
    orderBy: { createdAt: "asc" },
  });
  return { billingCustomers, intent, subscriptions, webhookEvents };
}

async function succeededWebhookEventsByType(runState, eventType) {
  return prisma.billingWebhookEvent.findMany({
    where: {
      ...exactWebhookWhere(runState),
      eventType,
      status: BillingWebhookStatus.SUCCEEDED,
    },
    orderBy: { createdAt: "asc" },
    select: {
      eventType: true,
      occurredAt: true,
      providerEventId: true,
      resourceId: true,
      status: true,
    },
  });
}

async function succeededWebhookEvents(runState, { excludedProviderEventId = "" } = {}) {
  return prisma.billingWebhookEvent.findMany({
    where: {
      ...exactWebhookWhere(runState),
      status: BillingWebhookStatus.SUCCEEDED,
      ...(excludedProviderEventId ? { providerEventId: { not: excludedProviderEventId } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      eventType: true,
      occurredAt: true,
      processedAt: true,
      providerEventId: true,
      resourceId: true,
    },
  });
}

function exactWebhookWhere(runState, {
  paymentId = runState.paymentId ?? runState.evidence?.payment?.id,
  subscriptionId = runState.providerSubscriptionId ?? runState.evidence?.subscription?.id,
} = {}) {
  const resources = [];
  if (paymentId) {
    resources.push({
      eventType: { in: ["payment.created", "payment.updated"] },
      resourceId: paymentId,
    });
  }
  if (subscriptionId) {
    resources.push({
      eventType: { in: ["invoice.payment_made", "subscription.created", "subscription.updated"] },
      resourceId: subscriptionId,
    });
  }

  return {
    provider: "square",
    createdAt: { gte: new Date(runState.createdAt) },
    eventType: { in: REQUIRED_SQUARE_WEBHOOK_EVENTS },
    ...(resources.length ? { OR: resources } : { providerEventId: "__mintbinder_no_exact_resource__" }),
  };
}

function webhookEvidence(events) {
  return events.map((event) => ({
    eventType: event.eventType,
    occurredAt: event.occurredAt?.toISOString?.() ?? event.occurredAt ?? null,
    processedAt: event.processedAt?.toISOString?.() ?? event.processedAt ?? null,
    providerEventId: event.providerEventId,
    resourceId: event.resourceId,
  }));
}

async function stableBillingSnapshot(userId, intentId) {
  const [intent, subscriptions] = await Promise.all([
    prisma.billingCheckoutIntent.findUnique({
      where: { id: intentId },
      select: {
        id: true,
        providerCustomerId: true,
        providerOrderId: true,
        providerPaymentId: true,
        status: true,
      },
    }),
    prisma.subscription.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      select: {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: true,
        id: true,
        plan: true,
        provider: true,
        providerCustomerId: true,
        providerSubscriptionId: true,
        status: true,
      },
    }),
  ]);
  return JSON.parse(JSON.stringify({ intent, subscriptions }));
}

async function stableOtherPlusSnapshot(fixtureUserId) {
  const rows = await prisma.subscription.findMany({
    where: {
      plan: { in: [SubscriptionPlan.PLUS_MONTHLY, SubscriptionPlan.PLUS_YEARLY] },
      userId: { not: fixtureUserId },
    },
    orderBy: { id: "asc" },
    select: {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: true,
      id: true,
      plan: true,
      provider: true,
      providerCustomerId: true,
      providerSubscriptionId: true,
      status: true,
      userId: true,
    },
  });
  const serialized = JSON.stringify(rows);
  return {
    count: rows.length,
    fingerprint: createHash("sha256").update(serialized, "utf8").digest("hex"),
  };
}

async function assertOtherEntitlementsUnchanged(runState) {
  const baseline = runState.entitlementBaseline?.otherPlus;
  assert.ok(baseline, "The pre-payment global Plus entitlement baseline is missing.");
  const current = await stableOtherPlusSnapshot(runState.user.id);
  assert.equal(
    current.count,
    baseline.count,
    "A different Mint Binder account's Plus entitlement count changed during the smoke; recovery state was preserved for manual review.",
  );
  assert.equal(
    current.fingerprint,
    baseline.fingerprint,
    "A different Mint Binder account's Plus entitlement changed during the smoke; recovery state was preserved for manual review.",
  );
  return current;
}

async function waitForWebhookQuiescence(runState) {
  const deadline = Date.now() + 120_000;
  let stableSince = 0;
  let previousFingerprint = "";

  while (Date.now() < deadline) {
    const events = await prisma.billingWebhookEvent.findMany({
      where: exactWebhookWhere(runState),
      orderBy: { createdAt: "asc" },
      select: {
        eventType: true,
        providerEventId: true,
        resourceId: true,
        status: true,
        updatedAt: true,
      },
    });
    const unsettled = events.some((event) => event.status !== BillingWebhookStatus.SUCCEEDED);
    const fingerprint = JSON.stringify(events);
    if (!unsettled && fingerprint === previousFingerprint) {
      stableSince ||= Date.now();
      if (Date.now() - stableSince >= 15_000) return;
    } else {
      stableSince = 0;
    }
    previousFingerprint = fingerprint;
    await delay(POLL_MS);
  }
  throw new Error("Square webhook activity did not become successful and quiet before cleanup.");
}

async function postSignedWebhook(url, payload, signature) {
  const response = await fetch(url, {
    body: payload,
    headers: {
      "content-type": "application/json",
      "x-square-hmacsha256-signature": signature,
    },
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  });
  return { body: await response.json().catch(() => ({})), status: response.status };
}

async function squareApi(apiPath) {
  const response = await fetch(`${squareApiBaseUrl()}${apiPath}`, {
    headers: {
      authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN.trim()}`,
      "content-type": "application/json",
      "square-version": process.env.SQUARE_VERSION?.trim() || "2026-05-20",
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.errors?.map((error) => error.detail || error.code).filter(Boolean).join(" ");
    throw new Error(message || `Square API returned HTTP ${response.status}.`);
  }
  return body;
}

function squareApiBaseUrl() {
  assert.equal(process.env.SQUARE_ENVIRONMENT.trim().toLowerCase(), "sandbox");
  return "https://connect.squareupsandbox.com";
}

function printBuyerInstructions(runState, config) {
  console.log("");
  console.log("Complete this ONE Square Sandbox checkout now. Never enter a real card:");
  console.log(`Plan: ${config.plan} (GBP ${(config.amountMinor / 100).toFixed(2)})`);
  console.log(`Buyer email: ${runState.buyer.email}`);
  console.log(`Buyer phone: ${runState.buyer.phone}`);
  console.log("Sandbox card: 4111 1111 1111 1111");
  console.log("Expiry: any future date | CVV: 111 | Postal code: 94103");
  console.log(`Checkout URL: ${runState.checkout.url}`);
  console.log("");
  console.log("Keep this command running. A redirect alone does not count; provider and webhook truth are checked.");
}

function assertSquareCheckoutUrl(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  assert.equal(url.protocol, "https:");
  assert.ok(
    host === "square.link" || host.endsWith(".square.link") || host === "square.site" || host.endsWith(".square.site"),
    `Square returned an unexpected checkout host: ${host}`,
  );
}

function assertStateMatchesSettings(runState, config, { requireCommit = true } = {}) {
  assert.equal(runState.version, STATE_VERSION, "Saved Square QA state uses an unsupported version.");
  assert.equal(runState.plan, config.plan, "Saved Square QA plan does not match the current command.");
  assert.equal(runState.baseUrl, config.baseUrl, "Saved Square QA target does not match the current target.");
  if (requireCommit) {
    assert.equal(runState.expectedCommit, config.expectedCommit, "Saved Square QA runtime commit does not match.");
  }
  const expectedIdentity = createSquareQaIdentity(runState.runId);
  assert.ok(isSquareQaFixtureIdentity({
    displayName: runState.user.displayName,
    email: runState.user.email,
    runId: runState.runId,
  }));
  assert.deepEqual(
    {
      displayName: runState.buyer.displayName,
      email: runState.buyer.email,
      phone: runState.buyer.phone,
      referenceId: runState.buyer.referenceId,
    },
    expectedIdentity.buyer,
    "Saved Square buyer identity does not match its run ID.",
  );
  for (const [label, value] of [
    ["app customer", runState.appCustomerIdempotencyKey],
    ["buyer customer", runState.buyerCustomerIdempotencyKey],
    ["checkout", runState.checkout.idempotencyKey],
    ["refund", runState.refund.idempotencyKey],
  ]) {
    assert.match(
      value,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      `Saved ${label} idempotency key is invalid.`,
    );
  }
  assert.ok(Number.isFinite(new Date(runState.createdAt).getTime()), "Saved run creation time is invalid.");
  if (runState.checkout.url) assertSquareCheckoutUrl(runState.checkout.url);
}

async function readState(runId) {
  const parsed = JSON.parse(await readFile(statePath(runId), "utf8"));
  if (parsed.runId !== runId) throw new Error("Saved Square QA state has a different run ID.");
  return parsed;
}

async function writeState(runState) {
  await writeAtomicJsonCheckpoint(statePath(runState.runId), runState);
}

async function writeSanitizedReport(runState, report) {
  const reportDirectory = path.join(STATE_DIRECTORY, "reports");
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
  const target = path.join(reportDirectory, `${runState.runId}.json`);
  const evidence = runState.evidence;
  const sanitized = {
    ...report,
    generatedAt: new Date().toISOString(),
    providerEvidence: {
      appCustomerId: runState.appCustomerId,
      buyerCustomerId: runState.buyer.customerId,
      checkoutIntentId: evidence.intent.id,
      amountMinor: evidence.intent.expectedAmountMinor,
      currency: evidence.intent.expectedCurrency,
      orderId: evidence.order.id,
      orderState: evidence.order.state,
      paymentId: evidence.payment.id,
      paymentStatus: evidence.payment.status,
      subscriptionId: evidence.subscription.id,
      subscriptionStatusAtPayment: evidence.subscription.status,
      verifiedAt: evidence.verifiedAt,
      webhookEvents: evidence.webhookEvents,
    },
    lifecycle: {
      cancellationAccessVerifiedAt: runState.cancellation.accessVerifiedAt,
      cancellationProviderVerifiedAt: runState.cancellation.providerInactiveAt,
      cancellationScheduledAt: runState.cancellation.providerScheduledAt,
      cancellationWebhookObservedAt: runState.cancellation.webhookObservedAt,
      idempotenceProvedAt: runState.idempotence.provedAt,
      refundCompletedAt: runState.refund.completedAt,
      accountDeletedAt: runState.accountDeletedAt,
      buyerDeletedAt: runState.buyerDeletedAt,
    },
  };
  await writeFile(target, `${JSON.stringify(sanitized, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(target, 0o600).catch(() => undefined);
  return target;
}

async function writeSanitizedFailureReport(runState, failure) {
  const reportDirectory = path.join(STATE_DIRECTORY, "reports");
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
  const target = path.join(reportDirectory, `${runState.runId}-failed.json`);
  const sanitized = {
    cleanup: {
      accountDeletedAt: runState.accountDeletedAt,
      buyerDeletedAt: runState.buyerDeletedAt,
      paymentLinkDeletedAt: runState.paymentLinkDeletedAt,
      providerInactiveAt: runState.failureCleanup.providerInactiveAt,
      refundCompletedAt: runState.refund.completedAt,
      refundId: runState.refund.id,
    },
    failure,
    generatedAt: new Date().toISOString(),
    ok: false,
    plan: runState.plan,
    runId: runState.runId,
    runtimeCommit: runState.expectedCommit,
  };
  await writeFile(target, `${JSON.stringify(sanitized, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(target, 0o600).catch(() => undefined);
  return target;
}

function statePath(runId) {
  if (!/^\d{14}-[0-9a-f]{8}$/.test(runId)) throw new Error("Refusing an invalid Square QA state path.");
  return path.join(STATE_DIRECTORY, `${runId}.json`);
}

async function waitFor(callback, { description, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await callback();
    if (value) return value;
    await delay(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function status(message) {
  console.error(`[square-hosted-qa] ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
