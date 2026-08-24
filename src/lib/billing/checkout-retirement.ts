import { prisma as defaultPrisma } from "../db/prisma.ts";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;
const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;
const RETIRABLE_STALE_STATUSES = ["creating", "recoverable", "retiring"] as const;

type CheckoutIntent = {
  checkoutUrl: string | null;
  expiresAt: Date;
  id: string;
  idempotencyKey: string;
  provider: string;
  providerCheckoutId: string | null;
  providerOrderId: string | null;
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
    deletePaymentLink(paymentLinkId: string): Promise<void>;
    retrieveOrder(orderId: string): Promise<{ state?: string | null } | null>;
    retrievePaymentLink(paymentLinkId: string): Promise<{ order_id?: string } | null>;
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
  skipped: number;
  staleBefore: string;
};

export class BillingCheckoutRetirementIncompleteError extends Error {
  resultPayload: BillingCheckoutRetirementResult;

  constructor(result: BillingCheckoutRetirementResult) {
    super(
      `Billing checkout retirement needs attention: ${result.ambiguous} ambiguous attempt(s), ` +
      `${result.errors} provider error(s).`,
    );
    this.name = "BillingCheckoutRetirementIncompleteError";
    this.resultPayload = result;
  }
}

export function assertBillingCheckoutRetirementHealthy(result: BillingCheckoutRetirementResult) {
  if (result.ambiguous > 0 || result.errors > 0) {
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
  const boundedStaleAfterMs = clampInteger(staleAfterMs, 1_000, 24 * 60 * 60 * 1000, DEFAULT_STALE_AFTER_MS);
  const staleBefore = new Date(now.getTime() - boundedStaleAfterMs);
  const candidates = await prisma.billingCheckoutIntent.findMany({
    where: {
      OR: [
        { expiresAt: { lte: now }, status: "ready" },
        { status: { in: [...RETIRABLE_STALE_STATUSES] }, updatedAt: { lte: staleBefore } },
      ],
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    select: {
      checkoutUrl: true,
      expiresAt: true,
      id: true,
      idempotencyKey: true,
      provider: true,
      providerCheckoutId: true,
      providerOrderId: true,
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
    skipped: 0,
    staleBefore: staleBefore.toISOString(),
  };

  for (const intent of candidates) {
    const claimed = await claimIntent(prisma, intent, now, staleBefore);

    if (!claimed) {
      result.skipped += 1;
      continue;
    }

    result.claimed += 1;

    if (!intent.providerCheckoutId && !(intent.provider === "square" && intent.providerOrderId)) {
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
          )
        : intent.provider === "stripe"
          ? await retireStripeIntent(intent, providers.stripe)
          : { kind: "ambiguous" as const, reason: `Unsupported checkout provider: ${intent.provider}.` };

      if (outcome.kind === "retired") {
        const updated = await markRetired(prisma, intent, now);
        if (updated) result.retired += 1;
        else result.skipped += 1;
        continue;
      }

      if (outcome.kind === "completed") {
        const updated = await markCompletedPending(prisma, intent, now);
        if (updated) result.completedPendingReconciliation += 1;
        else result.skipped += 1;
        continue;
      }

      if (outcome.kind === "superseded") {
        result.skipped += 1;
        continue;
      }

      await preserveAmbiguousIntent(prisma, intent, now);
      recordIssue(result, intent, outcome.reason, "ambiguous");
    } catch (error) {
      await preserveAmbiguousIntent(prisma, intent, now);
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
    : RETIRABLE_STALE_STATUSES.includes(intent.status as (typeof RETIRABLE_STALE_STATUSES)[number]) &&
      intent.updatedAt <= staleBefore;

  if (!eligible) return false;

  const claimed = await prisma.billingCheckoutIntent.updateMany({
    where: {
      id: intent.id,
      idempotencyKey: intent.idempotencyKey,
      status: intent.status,
      updatedAt: intent.updatedAt,
    },
    data: { status: "retiring", updatedAt: now },
  });

  return claimed.count === 1;
}

async function retireSquareIntent(
  intent: CheckoutIntent,
  square: CheckoutRetirementProviderOperations["square"],
  persistOrderId: (orderId: string) => Promise<boolean>,
) {
  const paymentLink = intent.providerCheckoutId
    ? await square.retrievePaymentLink(intent.providerCheckoutId)
    : null;
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

  const before = normalizeSquareOrderState((await square.retrieveOrder(orderId))?.state);

  if (before === "COMPLETED") return { kind: "completed" as const };
  if (!isKnownNonCompletedSquareState(before)) {
    return {
      kind: "ambiguous" as const,
      reason: `Square returned an unrecognised order state (${before || "missing"}); the link was not deleted.`,
    };
  }

  if (!paymentLink || !intent.providerCheckoutId) {
    if (before === "CANCELED") return { kind: "retired" as const };
    return {
      kind: "ambiguous" as const,
      reason: `Square payment link is missing while its stored order remains ${before}; the attempt was preserved.`,
    };
  }

  await square.deletePaymentLink(intent.providerCheckoutId);
  const after = normalizeSquareOrderState((await square.retrieveOrder(orderId))?.state);

  if (after === "COMPLETED") return { kind: "completed" as const };
  if (!isKnownNonCompletedSquareState(after)) {
    return {
      kind: "ambiguous" as const,
      reason: `Square order truth could not be confirmed after link deletion (${after || "missing"}).`,
    };
  }

  return { kind: "retired" as const };
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

async function markRetired(prisma: CheckoutIntentStore, intent: CheckoutIntent, now: Date) {
  const updated = await prisma.billingCheckoutIntent.updateMany({
    where: { id: intent.id, idempotencyKey: intent.idempotencyKey, status: "retiring" },
    data: {
      checkoutUrl: null,
      expiresAt: new Date(0),
      status: "retired",
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

async function markCompletedPending(prisma: CheckoutIntentStore, intent: CheckoutIntent, now: Date) {
  const updated = await prisma.billingCheckoutIntent.updateMany({
    where: { id: intent.id, idempotencyKey: intent.idempotencyKey, status: "retiring" },
    data: {
      checkoutUrl: null,
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

function isKnownNonCompletedSquareState(state: string) {
  return state === "CANCELED" || state === "DRAFT" || state === "OPEN";
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
    async retrievePaymentLink(paymentLinkId) {
      const { retrieveSquarePaymentLink } = await import("./square.ts");
      return retrieveSquarePaymentLink(paymentLinkId);
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
