import { prisma as defaultPrisma } from "../db/prisma.ts";
import { validateSquareCompletedPaymentCorrelation } from "./square-checkout-correlation.ts";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;
const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;
const RETIREMENT_LEASE_MS = 5 * 60 * 1000;
const SQUARE_PAYMENT_SEARCH_LOOKBACK_MS = 5 * 60 * 1000;
const RETIRABLE_STALE_STATUSES = ["creating", "recoverable", "retiring"] as const;

type CheckoutIntent = {
  checkoutUrl: string | null;
  createdAt: Date;
  expectedAmountMinor: number | null;
  expectedCurrency: string | null;
  expiresAt: Date;
  id: string;
  idempotencyKey: string;
  leaseExpiresAt: Date;
  plan: string;
  provider: string;
  providerCheckoutId: string | null;
  providerCustomerId: string | null;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  providerPlanVariationId: string | null;
  status: string;
  updatedAt: Date;
};

type CheckoutIntentStore = {
  billingCheckoutIntent: {
    findMany(args: unknown): Promise<CheckoutIntent[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

export type CheckoutRetirementProviderOperations = {
  square: {
    correlationSecret?: string;
    deletePaymentLink(paymentLinkId: string): Promise<{
      cancelledOrderId: string | null;
      id: string;
    }>;
    retrieveOrder(orderId: string): Promise<{
      id?: string | null;
      state?: string | null;
      tenders?: Array<{ id?: string | null }> | null;
    } | null>;
    retrievePayment(paymentId: string): Promise<{
      amount_money?: { amount?: number | null; currency?: string | null } | null;
      customer_id?: string | null;
      id?: string | null;
      note?: string | null;
      order_id?: string | null;
      status?: string | null;
    } | null>;
    retrievePaymentLink(paymentLinkId: string): Promise<{ id?: string | null; order_id?: string } | null>;
    searchPaymentsByOrder(input: {
      beginTime: Date;
      orderId: string;
    }): Promise<Array<{ id?: string | null; order_id?: string | null; status?: string | null }>>;
  };
  stripe: {
    expireCheckoutSession(sessionId: string): Promise<unknown>;
    retrieveCheckoutSession(sessionId: string): Promise<{ status?: "complete" | "expired" | "open" }>;
  };
};

export type BillingCheckoutRetirementIssue = {
  intentId: string;
  provider: string;
  reason: string;
};

export type BillingCheckoutRetirementResult = {
  ambiguous: number;
  batchSize: number;
  candidates: number;
  claimed: number;
  completedPendingReconciliation: number;
  errors: number;
  issues: BillingCheckoutRetirementIssue[];
  retired: number;
  settling: number;
  skipped: number;
  staleBefore: string;
};

export class BillingCheckoutRetirementIncompleteError extends Error {
  resultPayload: BillingCheckoutRetirementResult;

  constructor(result: BillingCheckoutRetirementResult) {
    super(
      `Billing checkout retirement needs attention: ${result.ambiguous} ambiguous attempt(s), ` +
      `${result.errors} provider error(s), and ` +
      `${result.completedPendingReconciliation} completed payment(s) awaiting reconciliation.`,
    );
    this.name = "BillingCheckoutRetirementIncompleteError";
    this.resultPayload = result;
  }
}

export function assertBillingCheckoutRetirementHealthy(result: BillingCheckoutRetirementResult) {
  if (
    result.ambiguous > 0 ||
    result.errors > 0 ||
    result.completedPendingReconciliation > 0
  ) {
    throw new BillingCheckoutRetirementIncompleteError(result);
  }

  return result;
}

export async function runBillingCheckoutRetirement({
  batchSize = DEFAULT_BATCH_SIZE,
  now = new Date(),
  prisma = defaultPrisma,
  providers = defaultProviderOperations,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
}: {
  batchSize?: number;
  now?: Date;
  prisma?: CheckoutIntentStore;
  providers?: CheckoutRetirementProviderOperations;
  staleAfterMs?: number;
} = {}): Promise<BillingCheckoutRetirementResult> {
  assertValidDate(now, "retirement timestamp");
  const boundedBatchSize = clampInteger(batchSize, 1, MAX_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  const boundedStaleAfterMs = clampInteger(
    staleAfterMs,
    DEFAULT_STALE_AFTER_MS,
    24 * 60 * 60 * 1000,
    DEFAULT_STALE_AFTER_MS,
  );
  const staleBefore = new Date(now.getTime() - boundedStaleAfterMs);
  const candidates = await prisma.billingCheckoutIntent.findMany({
    where: {
      OR: [
        { expiresAt: { lte: now }, status: "ready" },
        { status: { in: [...RETIRABLE_STALE_STATUSES] }, updatedAt: { lte: staleBefore } },
        {
          provider: "square",
          status: "retired",
          OR: [
            { checkoutUrl: { not: null } },
            { providerCheckoutId: { not: null } },
            { providerOrderId: { not: null } },
            { providerPaymentId: { not: null } },
          ],
        },
      ],
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    select: {
      checkoutUrl: true,
      createdAt: true,
      expectedAmountMinor: true,
      expectedCurrency: true,
      expiresAt: true,
      id: true,
      idempotencyKey: true,
      leaseExpiresAt: true,
      plan: true,
      provider: true,
      providerCheckoutId: true,
      providerCustomerId: true,
      providerOrderId: true,
      providerPaymentId: true,
      providerPlanVariationId: true,
      status: true,
      updatedAt: true,
    },
    take: boundedBatchSize,
  });
  const result: BillingCheckoutRetirementResult = {
    ambiguous: 0,
    batchSize: boundedBatchSize,
    candidates: candidates.length,
    claimed: 0,
    completedPendingReconciliation: 0,
    errors: 0,
    issues: [],
    retired: 0,
    settling: 0,
    skipped: 0,
    staleBefore: staleBefore.toISOString(),
  };

  for (const candidate of candidates) {
    const intent = await claimIntent(prisma, candidate, now, staleBefore);

    if (!intent) {
      result.skipped += 1;
      continue;
    }

    result.claimed += 1;

    if (
      !intent.providerCheckoutId &&
      !(intent.provider === "square" && (intent.providerOrderId || intent.providerPaymentId))
    ) {
      await preserveAmbiguousIntent(prisma, intent, now);
      recordIssue(result, intent, "Provider checkout reference is missing; the attempt was preserved for reconciliation.", "ambiguous");
      continue;
    }

    try {
      const outcome = intent.provider === "square"
        ? await retireSquareIntent(
            intent,
            providers.square,
            (orderId) => persistSquareOrderReference(prisma, intent, orderId, now),
            (paymentLinkId, orderId) => checkpointSquareCancellation(
              prisma,
              intent,
              paymentLinkId,
              orderId,
              now,
            ),
          )
        : intent.provider === "stripe"
          ? await retireStripeIntent(intent, providers.stripe)
          : { kind: "ambiguous" as const, reason: `Unsupported checkout provider: ${intent.provider}.` };

      if (outcome.kind === "retired" || outcome.kind === "retired_payment_free") {
        const updated = await markRetired(prisma, intent, now, outcome.kind);
        if (updated) result.retired += 1;
        else result.skipped += 1;
        continue;
      }

      if (outcome.kind === "settling") {
        const updated = await markSquarePaymentSettlement(prisma, intent, now);
        if (updated) result.settling += 1;
        else result.skipped += 1;
        continue;
      }

      if (outcome.kind === "completed") {
        const providerPaymentId = "paymentId" in outcome && typeof outcome.paymentId === "string"
          ? outcome.paymentId
          : null;
        const updated = await markCompletedPending(prisma, intent, now, providerPaymentId);
        if (updated) result.completedPendingReconciliation += 1;
        else result.skipped += 1;
        continue;
      }

      if (outcome.kind === "superseded") {
        result.skipped += 1;
        continue;
      }

      await preserveUnresolvedIntent(prisma, intent, now);
      recordIssue(result, intent, outcome.reason, "ambiguous");
    } catch (error) {
      await preserveUnresolvedIntent(prisma, intent, now);
      recordIssue(
        result,
        intent,
        error instanceof Error ? error.message : "Provider checkout retirement failed.",
        "error",
      );
    }
  }

  return result;
}

async function claimIntent(
  prisma: CheckoutIntentStore,
  intent: CheckoutIntent,
  now: Date,
  staleBefore: Date,
) {
  const eligible = intent.status === "ready"
    ? intent.expiresAt <= now
    : RETIRABLE_STALE_STATUSES.includes(intent.status as (typeof RETIRABLE_STALE_STATUSES)[number])
      ? intent.updatedAt <= staleBefore
      : isLegacySquareRetirement(intent);

  if (!eligible) return null;

  const leaseExpiresAt = new Date(now.getTime() + RETIREMENT_LEASE_MS);

  const claimed = await prisma.billingCheckoutIntent.updateMany({
    where: {
      id: intent.id,
      idempotencyKey: intent.idempotencyKey,
      status: intent.status,
      updatedAt: intent.updatedAt,
    },
    data: {
      leaseExpiresAt,
      status: "retiring",
      updatedAt: now,
    },
  });

  if (claimed.count !== 1) return null;
  return {
    ...intent,
    leaseExpiresAt,
    status: "retiring",
    updatedAt: now,
  };
}

async function retireSquareIntent(
  intent: CheckoutIntent,
  square: CheckoutRetirementProviderOperations["square"],
  persistOrderId: (orderId: string) => Promise<boolean>,
  checkpointCancellation: (paymentLinkId: string, orderId: string) => Promise<boolean>,
) {
  const storedPaymentId = intent.providerPaymentId?.trim();
  if (storedPaymentId) {
    return validateExactSquareCompletedPayment(intent, storedPaymentId, square);
  }

  const paymentLink = intent.providerCheckoutId
    ? await square.retrievePaymentLink(intent.providerCheckoutId)
    : null;
  if (
    paymentLink &&
    paymentLink.id !== intent.providerCheckoutId
  ) {
    throw new Error(
      "Square returned a payment link whose identity did not exactly match the retirement request.",
    );
  }
  const linkedOrderId = paymentLink?.order_id?.trim();
  const storedOrderId = intent.providerOrderId?.trim();

  if (linkedOrderId && storedOrderId && linkedOrderId !== storedOrderId) {
    return {
      kind: "ambiguous" as const,
      reason: "Square returned an order that differs from the durably recorded checkout order; the link was not deleted.",
    };
  }

  if (linkedOrderId && !storedOrderId) {
    const persisted = await persistOrderId(linkedOrderId);
    if (!persisted) return { kind: "superseded" as const };
    intent.providerOrderId = linkedOrderId;
  }

  const orderId = linkedOrderId || intent.providerOrderId?.trim();

  if (!orderId) {
    return {
      kind: "ambiguous" as const,
      reason: "Square did not return an order and no durable order reference exists; the attempt was preserved.",
    };
  }

  const before = await inspectSquareOrderPaymentEvidence(intent, orderId, square);
  const beforePayment = await classifySquarePaymentEvidence(intent, orderId, before, square);
  if (beforePayment.kind !== "none") return beforePayment;
  if (!isKnownNonCompletedSquareState(before.state)) {
    return {
      kind: "ambiguous" as const,
      reason: `Square returned an unrecognised order state (${before.state || "missing"}); the link was not deleted.`,
    };
  }

  if (!intent.providerCheckoutId) {
    if (
      intent.status === "retiring" &&
      intent.checkoutUrl === null &&
      before.state === "CANCELED"
    ) {
      // Clearing the durable link reference is this worker's marker that an
      // earlier pass validated Square's exact DELETE response. This stale pass
      // supplies the delayed second provider check.
      return { kind: "retired_payment_free" as const };
    }
    return {
      kind: "ambiguous" as const,
      reason: "Square cancellation proof is missing or its exact order is not canceled; the attempt was preserved.",
    };
  }

  if (!paymentLink) {
    if (before.state === "CANCELED") {
      // Recovery for a hard crash between Square's DELETE response and the
      // normal checkpoint: the exact stored link is now absent, the exact
      // stored order is canceled, and this is the first empty provider pass.
      const checkpointed = await checkpointCancellation(intent.providerCheckoutId, orderId);
      if (!checkpointed) return { kind: "superseded" as const };
      intent.checkoutUrl = null;
      intent.providerCheckoutId = null;
      intent.status = "retiring";
      return { kind: "settling" as const };
    }
    return {
      kind: "ambiguous" as const,
      reason: "Square no longer returns the payment link, but its exact order is not canceled; the attempt was preserved.",
    };
  }

  const deletion = await square.deletePaymentLink(intent.providerCheckoutId);
  if (
    deletion.id !== intent.providerCheckoutId ||
    deletion.cancelledOrderId !== orderId
  ) {
    return {
      kind: "ambiguous" as const,
      reason: "Square did not prove deletion of the exact payment link and checkout order; the attempt was preserved.",
    };
  }
  const checkpointed = await checkpointCancellation(intent.providerCheckoutId, orderId);
  if (!checkpointed) return { kind: "superseded" as const };
  intent.checkoutUrl = null;
  intent.providerCheckoutId = null;
  intent.status = "retiring";
  const after = await inspectSquareOrderPaymentEvidence(intent, orderId, square);
  const afterPayment = await classifySquarePaymentEvidence(intent, orderId, after, square);
  if (afterPayment.kind !== "none") return afterPayment;
  if (after.state === "OPEN" || after.state === "DRAFT") {
    // Square can lag its own DELETE response. The durable exact-cancellation
    // checkpoint remains fenced in `retiring`; only a later CANCELED read can
    // become terminal.
    return { kind: "settling" as const };
  }
  if (after.state !== "CANCELED") {
    return {
      kind: "ambiguous" as const,
      reason: `Square did not confirm the exact checkout order as canceled after link deletion (${after.state || "missing"}).`,
    };
  }

  // A later stale pass repeats both provider reads before this can become the
  // terminal payment-free state.
  return { kind: "settling" as const };
}

async function inspectSquareOrderPaymentEvidence(
  intent: CheckoutIntent,
  orderId: string,
  square: CheckoutRetirementProviderOperations["square"],
) {
  const beginTime = new Date(intent.createdAt.getTime() - SQUARE_PAYMENT_SEARCH_LOOKBACK_MS);
  const payments = await square.searchPaymentsByOrder({ beginTime, orderId });
  const order = await square.retrieveOrder(orderId);

  if (!Array.isArray(payments)) {
    throw new Error("Square Payments returned an invalid exact-order result; checkout retirement was preserved.");
  }
  if (order?.tenders != null && !Array.isArray(order.tenders)) {
    throw new Error("Square Orders returned invalid tender evidence; checkout retirement was preserved.");
  }
  if (order?.id !== orderId) {
    throw new Error("Square did not return the exact requested order; checkout retirement was preserved.");
  }
  for (const payment of payments) {
    if (
      !payment ||
      typeof payment !== "object" ||
      !payment.id?.trim() ||
      payment.id !== payment.id.trim() ||
      payment.order_id !== orderId
    ) {
      throw new Error(
        "Square Payments returned malformed or non-exact order evidence; checkout retirement was preserved.",
      );
    }
  }
  const tenders = order?.tenders ?? [];

  return {
    payments,
    state: normalizeSquareOrderState(order?.state),
    tenders,
  };
}

async function classifySquarePaymentEvidence(
  intent: CheckoutIntent,
  orderId: string,
  {
  payments,
  state,
  tenders,
}: {
  payments: Array<{ id?: string | null; order_id?: string | null; status?: string | null }>;
  state: string;
  tenders: Array<{ id?: string | null }>;
  },
  square: CheckoutRetirementProviderOperations["square"],
) {
  const completedPaymentIds = [...new Set(
    payments
      .filter((payment) => normalizeSquarePaymentStatus(payment.status) === "COMPLETED")
      .map((payment) => payment.id!.trim()),
  )];

  if (completedPaymentIds.length === 1) {
    const candidatePaymentId = completedPaymentIds[0];
    return validateExactSquareCompletedPayment(
      { ...intent, providerOrderId: orderId },
      candidatePaymentId,
      square,
    );
  }
  if (payments.length > 0 || tenders.length > 0 || state === "COMPLETED") {
    return {
      kind: "ambiguous" as const,
      reason: "Square returned payment or tender evidence without one uniquely proven completed payment; manual reconciliation is required.",
    };
  }
  return { kind: "none" as const };
}

async function validateExactSquareCompletedPayment(
  intent: CheckoutIntent,
  expectedPaymentId: string,
  square: CheckoutRetirementProviderOperations["square"],
) {
  const exactPayment = await square.retrievePayment(expectedPaymentId);
  const validation = validateSquareCompletedPaymentCorrelation({
    expectedPaymentId,
    intent,
    payment: exactPayment,
    secret: square.correlationSecret,
  });
  if (validation.ok) {
    return { kind: "completed" as const, paymentId: validation.paymentId };
  }
  return {
    kind: "ambiguous" as const,
    reason: `${validation.reason} Manual reconciliation is required.`,
  };
}

async function retireStripeIntent(
  intent: CheckoutIntent,
  stripe: CheckoutRetirementProviderOperations["stripe"],
) {
  const before = (await stripe.retrieveCheckoutSession(intent.providerCheckoutId!)).status;

  if (before === "complete") return { kind: "completed" as const };
  if (before === "expired") return { kind: "retired" as const };
  if (before !== "open") {
    return {
      kind: "ambiguous" as const,
      reason: `Stripe returned an unrecognised session status (${before || "missing"}); the attempt was preserved.`,
    };
  }

  await stripe.expireCheckoutSession(intent.providerCheckoutId!);
  const after = (await stripe.retrieveCheckoutSession(intent.providerCheckoutId!)).status;

  if (after === "complete") return { kind: "completed" as const };
  if (after === "expired") return { kind: "retired" as const };

  return {
    kind: "ambiguous" as const,
    reason: `Stripe session retirement could not be confirmed (${after || "missing"}).`,
  };
}

async function markRetired(
  prisma: CheckoutIntentStore,
  intent: CheckoutIntent,
  now: Date,
  outcome: "retired" | "retired_payment_free",
) {
  if (outcome === "retired_payment_free" && !intent.providerOrderId?.trim()) return false;
  const updated = await prisma.billingCheckoutIntent.updateMany({
    where: {
      id: intent.id,
      idempotencyKey: intent.idempotencyKey,
      status: "retiring",
      ...(outcome === "retired_payment_free"
        ? {
            checkoutUrl: null,
            providerCheckoutId: null,
            providerOrderId: intent.providerOrderId,
            providerPaymentId: null,
          }
        : {}),
    },
    data: {
      checkoutUrl: null,
      expiresAt: new Date(0),
      status: outcome,
      updatedAt: now,
    },
  });
  return updated.count === 1;
}

async function markSquarePaymentSettlement(
  prisma: CheckoutIntentStore,
  intent: CheckoutIntent,
  now: Date,
) {
  const updated = await prisma.billingCheckoutIntent.updateMany({
    where: { id: intent.id, idempotencyKey: intent.idempotencyKey, status: "retiring" },
    data: {
      checkoutUrl: null,
      expiresAt: new Date(0),
      providerCheckoutId: null,
      status: "retiring",
      updatedAt: now,
    },
  });
  return updated.count === 1;
}

async function persistSquareOrderReference(
  prisma: CheckoutIntentStore,
  intent: CheckoutIntent,
  providerOrderId: string,
  now: Date,
) {
  const updated = await prisma.billingCheckoutIntent.updateMany({
    where: {
      id: intent.id,
      idempotencyKey: intent.idempotencyKey,
      providerOrderId: null,
      status: "retiring",
    },
    data: { providerOrderId, updatedAt: now },
  });
  return updated.count === 1;
}

async function checkpointSquareCancellation(
  prisma: CheckoutIntentStore,
  intent: CheckoutIntent,
  providerCheckoutId: string,
  providerOrderId: string,
  now: Date,
) {
  const updated = await prisma.billingCheckoutIntent.updateMany({
    where: {
      id: intent.id,
      idempotencyKey: intent.idempotencyKey,
      providerCheckoutId,
      providerOrderId,
      status: "retiring",
    },
    data: {
      checkoutUrl: null,
      expiresAt: new Date(0),
      leaseExpiresAt: new Date(now.getTime() + RETIREMENT_LEASE_MS),
      providerCheckoutId: null,
      updatedAt: now,
    },
  });
  return updated.count === 1;
}

async function markCompletedPending(
  prisma: CheckoutIntentStore,
  intent: CheckoutIntent,
  now: Date,
  providerPaymentId: string | null,
) {
  const updated = await prisma.billingCheckoutIntent.updateMany({
    where: {
      expectedAmountMinor: intent.expectedAmountMinor,
      expectedCurrency: intent.expectedCurrency,
      id: intent.id,
      idempotencyKey: intent.idempotencyKey,
      plan: intent.plan,
      provider: intent.provider,
      providerCustomerId: intent.providerCustomerId,
      providerOrderId: intent.providerOrderId,
      providerPaymentId: intent.providerPaymentId,
      providerPlanVariationId: intent.providerPlanVariationId,
      status: "retiring",
    },
    data: {
      checkoutUrl: null,
      ...(providerPaymentId ? { providerPaymentId } : {}),
      status: "paid_pending_subscription",
      updatedAt: now,
    },
  });
  return updated.count === 1;
}

async function preserveAmbiguousIntent(prisma: CheckoutIntentStore, intent: CheckoutIntent, now: Date) {
  await prisma.billingCheckoutIntent.updateMany({
    where: { id: intent.id, idempotencyKey: intent.idempotencyKey, status: "retiring" },
    data: { status: "recoverable", updatedAt: now },
  });
}

async function preserveUnresolvedIntent(
  prisma: CheckoutIntentStore,
  intent: CheckoutIntent,
  now: Date,
) {
  if (
    intent.provider === "square" &&
    intent.status === "retiring" &&
    intent.checkoutUrl === null &&
    !intent.providerCheckoutId &&
    Boolean(intent.providerOrderId?.trim())
  ) {
    await markSquarePaymentSettlement(prisma, intent, now);
    return;
  }
  await preserveAmbiguousIntent(prisma, intent, now);
}

function recordIssue(
  result: BillingCheckoutRetirementResult,
  intent: CheckoutIntent,
  reason: string,
  kind: "ambiguous" | "error",
) {
  result[kind === "ambiguous" ? "ambiguous" : "errors"] += 1;
  result.issues.push({ intentId: intent.id, provider: intent.provider, reason });
}

function normalizeSquareOrderState(state?: string | null) {
  return state?.trim().toUpperCase() ?? "";
}

function normalizeSquarePaymentStatus(status?: string | null) {
  return status?.trim().toUpperCase() ?? "";
}

function isKnownNonCompletedSquareState(state: string) {
  return state === "CANCELED" || state === "DRAFT" || state === "OPEN";
}

function isLegacySquareRetirement(intent: CheckoutIntent) {
  return intent.provider === "square" && intent.status === "retired" && Boolean(
    intent.checkoutUrl ||
    intent.providerCheckoutId ||
    intent.providerOrderId ||
    intent.providerPaymentId,
  );
}

function assertValidDate(value: Date, label: string) {
  if (Number.isNaN(value.getTime())) throw new Error(`Invalid ${label}.`);
}

function clampInteger(value: number, minimum: number, maximum: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

const defaultProviderOperations: CheckoutRetirementProviderOperations = {
  square: {
    async deletePaymentLink(paymentLinkId) {
      const { deleteSquarePaymentLink } = await import("./square.ts");
      return deleteSquarePaymentLink(paymentLinkId);
    },
    async retrieveOrder(orderId) {
      const { retrieveSquareOrder } = await import("./square.ts");
      return retrieveSquareOrder(orderId);
    },
    async retrievePayment(paymentId) {
      const { retrieveSquarePayment } = await import("./square.ts");
      return retrieveSquarePayment(paymentId);
    },
    async retrievePaymentLink(paymentLinkId) {
      const { retrieveSquarePaymentLink } = await import("./square.ts");
      return retrieveSquarePaymentLink(paymentLinkId);
    },
    async searchPaymentsByOrder(input) {
      const { searchSquarePaymentsByOrder } = await import("./square.ts");
      return searchSquarePaymentsByOrder(input);
    },
  },
  stripe: {
    async expireCheckoutSession(sessionId) {
      const { expireStripeCheckoutSession } = await import("./stripe.ts");
      return expireStripeCheckoutSession(sessionId);
    },
    async retrieveCheckoutSession(sessionId) {
      const { retrieveStripeCheckoutSession } = await import("./stripe.ts");
      return retrieveStripeCheckoutSession(sessionId);
    },
  },
};
