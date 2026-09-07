import { randomUUID } from "node:crypto";
import { SubscriptionPlan } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  createSquareSubscriptionCheckout,
  retrieveSquareOrder,
  retrieveSquarePaymentLink,
  searchSquarePaymentsByOrder,
} from "@/lib/billing/square";
import {
  createStripeCheckoutSession,
  expireStripeCheckoutSession,
  findStripeCheckoutSessionByIntent,
  retrieveStripeCheckoutSession,
} from "@/lib/billing/stripe";
import {
  BillingAccountDeletionError,
  assertBillingAccountAvailable,
  externalPaidAgreementBlocksCheckoutWhere,
  lockBillingCheckout,
} from "@/lib/billing/checkout-lock";
import { decideCheckoutCompletion } from "@/lib/billing/checkout-completion";
import { recoverStripeCheckoutAfterResponseLoss } from "@/lib/billing/stripe-checkout-recovery";
import {
  checkoutIntentMustAwaitProviderReconciliation,
  squareMissingCheckoutMustRemainWorkerOwned,
} from "@/lib/billing/checkout-intent-state";
import {
  inspectImmediateSquareRetirement,
  type ImmediateSquareRetirementOperations,
} from "@/lib/billing/square-retirement-precheck";

const INTENT_TTL_MS = 30 * 60 * 1000;
export const INTENT_LEASE_MS = 5 * 60 * 1000;
const STRIPE_IDEMPOTENCY_RECOVERY_MS = 23 * 60 * 60 * 1000;
const ACCOUNT_RETIRABLE_INTENT_STATUSES = ["creating", "recoverable", "ready", "retiring"];

type CheckoutPricingSnapshot = {
  expectedAmountMinor: number | null;
  expectedCurrency: string | null;
  providerPlanVariationId: string | null;
};

type CheckoutIntentReference = CheckoutPricingSnapshot & {
  checkoutOrigin: string;
  createdAt: Date;
  id: string;
  idempotencyKey: string;
  provider: string;
  providerCustomerId: string | null;
};

export class BillingCheckoutConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingCheckoutConflictError";
  }
}

export async function claimBillingCheckoutIntent({
  expectation,
  origin,
  plan,
  provider,
  userId,
}: {
  expectation: { amountMinor?: number | null; currency?: string | null; planVariationId: string };
  origin: string;
  plan: "monthly" | "yearly";
  provider: string;
  userId: string;
}): Promise<
  | (CheckoutIntentReference & { kind: "claimed"; leaseToken: string })
  | (CheckoutIntentReference & {
      kind: "reuse";
      providerCheckoutId: string;
      providerOrderId: string | null;
      url: string;
    })
  | (CheckoutIntentReference & {
      kind: "retire";
      providerCheckoutId: string;
      providerOrderId: string | null;
    })
> {
  const now = new Date();
  const requestedPlan = plan === "yearly"
    ? SubscriptionPlan.PLUS_YEARLY
    : SubscriptionPlan.PLUS_MONTHLY;
  const requestedPricing = checkoutPricingSnapshot(provider, expectation);
  const requestedOrigin = normalizeCheckoutOrigin(origin);
  return prisma.$transaction(async (transaction) => {
    await lockBillingCheckout(transaction, userId);
    try {
      await assertBillingAccountAvailable(transaction, userId, provider);
    } catch (error) {
      if (error instanceof BillingAccountDeletionError) {
        throw new BillingCheckoutConflictError(error.message);
      }
      throw error;
    }

    const blockingSubscription = await transaction.subscription.findFirst({
      where: {
        userId,
        ...externalPaidAgreementBlocksCheckoutWhere(now),
      },
      select: { id: true },
    });

    if (blockingSubscription) {
      throw new BillingCheckoutConflictError(
        "A paid or pending subscription already exists. Use Billing to manage it before starting another checkout.",
      );
    }

    const otherProviderIntent = await transaction.billingCheckoutIntent.findFirst({
      where: {
        userId,
        provider: { not: provider },
        status: { in: ["creating", "recoverable", "ready", "retiring", "paid_pending_subscription"] },
      },
      select: { id: true },
    });
    if (otherProviderIntent) {
      throw new BillingCheckoutConflictError(
        "Another payment provider still has an unresolved checkout for this account. " +
        "Retire it before starting a replacement checkout.",
      );
    }

    const existing = await transaction.billingCheckoutIntent.findFirst({
      where: {
        userId,
        provider,
        status: { in: ["creating", "recoverable", "ready", "retiring", "paid_pending_subscription"] },
      },
      orderBy: { updatedAt: "desc" },
    });

    if (existing) {
      if (existing.plan !== requestedPlan) {
        throw new BillingCheckoutConflictError(
          "Another checkout is already open for a different plan. Finish or retire that checkout first.",
        );
      }
      const pricing = checkoutPricingFromIntent(existing);

      if (existing.status === "ready" && existing.checkoutUrl && existing.expiresAt > now) {
        if (!existing.providerCheckoutId) {
          throw new BillingCheckoutConflictError("The provider checkout reference is missing.");
        }
        return {
          kind: "reuse" as const,
          createdAt: existing.createdAt,
          id: existing.id,
          idempotencyKey: existing.idempotencyKey,
          checkoutOrigin: existing.checkoutOrigin,
          ...pricing,
          provider: existing.provider,
          providerCustomerId: existing.providerCustomerId,
          providerCheckoutId: existing.providerCheckoutId,
          providerOrderId: existing.providerOrderId,
          url: existing.checkoutUrl,
        };
      }

      if (existing.status === "ready") {
        if (!existing.providerCheckoutId) {
          throw new BillingCheckoutConflictError(
            "The previous checkout lacks a provider reference. Contact support before starting another checkout.",
          );
        }
        await transaction.billingCheckoutIntent.update({
          where: { id: existing.id },
          data: {
            leaseExpiresAt: new Date(now.getTime() + INTENT_LEASE_MS),
            status: "retiring",
          },
        });
        return {
          kind: "retire" as const,
          createdAt: existing.createdAt,
          id: existing.id,
          idempotencyKey: existing.idempotencyKey,
          checkoutOrigin: existing.checkoutOrigin,
          ...pricing,
          provider: existing.provider,
          providerCustomerId: existing.providerCustomerId,
          providerCheckoutId: existing.providerCheckoutId,
          providerOrderId: existing.providerOrderId,
        };
      }

      if (existing.status === "paid_pending_subscription") {
        throw new BillingCheckoutConflictError(
          "Payment completed and its Square subscription is still being reconciled. Please try again shortly.",
        );
      }

      if (existing.status === "retiring") {
        if (existing.leaseExpiresAt > now || !existing.providerCheckoutId) {
          throw new BillingCheckoutConflictError("The previous checkout is being retired. Please try again shortly.");
        }
        await transaction.billingCheckoutIntent.update({
          where: { id: existing.id },
          data: { leaseExpiresAt: new Date(now.getTime() + INTENT_LEASE_MS) },
        });
        return {
          kind: "retire" as const,
          createdAt: existing.createdAt,
          id: existing.id,
          idempotencyKey: existing.idempotencyKey,
          checkoutOrigin: existing.checkoutOrigin,
          ...pricing,
          provider: existing.provider,
          providerCustomerId: existing.providerCustomerId,
          providerCheckoutId: existing.providerCheckoutId,
          providerOrderId: existing.providerOrderId,
        };
      }

      const recoverable = existing.status === "recoverable" || (
        existing.status === "creating" && existing.leaseExpiresAt <= now
      );
      if (!recoverable) {
        throw new BillingCheckoutConflictError("Checkout is already being prepared. Please try again shortly.");
      }
      const leaseToken = randomUUID();
      await transaction.billingCheckoutIntent.update({
        where: { id: existing.id },
        data: {
          expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
          leaseExpiresAt: new Date(now.getTime() + INTENT_LEASE_MS),
          leaseToken,
          status: "creating",
        },
      });
      return {
        checkoutOrigin: existing.checkoutOrigin,
        createdAt: existing.createdAt,
        kind: "claimed" as const,
        id: existing.id,
        idempotencyKey: existing.idempotencyKey,
        provider: existing.provider,
        providerCustomerId: existing.providerCustomerId,
        leaseToken,
        ...pricing,
      };
    }

    const idempotencyKey = randomUUID();
    const leaseToken = randomUUID();
    const created = await transaction.billingCheckoutIntent.create({
      data: {
        checkoutOrigin: requestedOrigin,
        userId,
        provider,
        plan: requestedPlan,
        status: "creating",
        idempotencyKey,
        leaseExpiresAt: new Date(now.getTime() + INTENT_LEASE_MS),
        leaseToken,
        ...requestedPricing,
        expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
      },
      select: { createdAt: true, id: true },
    });

    return {
      checkoutOrigin: requestedOrigin,
      createdAt: created.createdAt,
      kind: "claimed" as const,
      id: created.id,
      idempotencyKey,
      leaseToken,
      provider,
      providerCustomerId: null,
      ...requestedPricing,
    };
  });
}

export async function retireProviderCheckout(
  provider: string,
  providerCheckoutId: string,
  providerOrderId?: string | null,
  checkoutCreatedAt?: Date,
  square = defaultImmediateSquareRetirementOperations,
) {
  if (provider === "stripe") {
    const session = await retrieveStripeCheckoutSession(providerCheckoutId);

    if (session.status === "complete") {
      throw new BillingCheckoutConflictError(
        "Payment completed and is still being reconciled. Wait a moment before trying again.",
      );
    }

    if (session.status === "expired") return;
    if (session.status === "open") {
      await expireStripeCheckoutSession(providerCheckoutId);
      const after = await retrieveStripeCheckoutSession(providerCheckoutId);
      if (after.status === "expired") return;
      if (after.status === "complete") {
        throw new BillingCheckoutConflictError(
          "Payment completed while Stripe checkout retirement was in progress and is still being reconciled.",
        );
      }
      throw new BillingCheckoutConflictError(
        "Stripe checkout retirement could not be confirmed safely. Contact support before trying again.",
      );
    }
    throw new BillingCheckoutConflictError(
      "The previous Stripe checkout could not be retired safely. Contact support before trying again.",
    );
  }

  if (provider === "square") {
    const inspection = await inspectImmediateSquareRetirement({
      checkoutCreatedAt,
      providerCheckoutId,
      providerOrderId,
      square,
    });
    if (inspection.kind === "completed") {
      throw new BillingCheckoutConflictError(
        "The previous Square checkout completed and is still being reconciled. Wait a moment before trying again.",
      );
    }
    if (inspection.kind === "invalid") {
      throw new BillingCheckoutConflictError(inspection.message);
    }
    // Leave the intent in `retiring`. The scheduled worker owns payment-link
    // deletion and both settlement evidence passes; the request path cannot
    // make a Square checkout terminal.
    throw new BillingCheckoutConflictError(
      "The previous Square checkout is queued for safe retirement and its final payment-free settlement check. Please try again shortly.",
    );
  }

  throw new BillingCheckoutConflictError("The previous checkout provider could not be retired safely.");
}

export async function completeBillingCheckoutRetirement(id: string, idempotencyKey: string) {
  const retired = await prisma.billingCheckoutIntent.updateMany({
    where: { id, idempotencyKey, status: "retiring" },
    data: { checkoutUrl: null, expiresAt: new Date(0), status: "retired" },
  });
  if (retired.count === 1) return;
  const alreadyRetired = await prisma.billingCheckoutIntent.findFirst({
    where: { id, idempotencyKey, status: "retired" },
    select: { id: true },
  });
  if (!alreadyRetired) throw new BillingCheckoutConflictError("Checkout retirement could not be recorded safely.");
}

export async function assertBillingCheckoutIntentAvailable({
  customerId,
  id,
  idempotencyKey,
  leaseToken,
  provider,
  userId,
}: {
  customerId: string;
  id: string;
  idempotencyKey: string;
  leaseToken: string;
  provider: string;
  userId: string;
}) {
  await prisma.$transaction(async (transaction) => {
    await assertBillingAccountAvailable(transaction, userId, provider);
    const intent = await transaction.billingCheckoutIntent.updateMany({
      where: {
        id,
        idempotencyKey,
        leaseToken,
        provider,
        status: "creating",
        userId,
        OR: [{ providerCustomerId: null }, { providerCustomerId: customerId }],
      },
      data: {
        leaseExpiresAt: new Date(Date.now() + INTENT_LEASE_MS),
        providerCustomerId: customerId,
      },
    });
    if (intent.count !== 1) {
      throw new BillingCheckoutConflictError("Checkout is no longer available for provider creation.");
    }
  });
}

export async function beginBillingCheckoutRetirement(id: string, idempotencyKey: string) {
  const claimed = await prisma.billingCheckoutIntent.updateMany({
    where: { id, idempotencyKey, status: "ready" },
    data: { leaseExpiresAt: new Date(Date.now() + INTENT_LEASE_MS), status: "retiring" },
  });
  if (claimed.count !== 1) throw new BillingCheckoutConflictError("Checkout could not be claimed for retirement.");
}

export async function fenceBillingForAccountDeletion(userId: string) {
  await prisma.$transaction(async (transaction) => {
    await lockBillingCheckout(transaction, userId);
    await transaction.user.update({
      where: { id: userId },
      data: { deletionRequestedAt: new Date() },
    });
  });
}

export async function clearBillingAccountDeletionFence(userId: string) {
  await prisma.$transaction(async (transaction) => {
    await lockBillingCheckout(transaction, userId);
    await transaction.user.updateMany({
      where: { id: userId },
      data: { deletionRequestedAt: null },
    });
  });
}

export async function retireBillingCheckoutIntentsForAccount(userId: string) {
  return retireBillingCheckoutIntents(userId);
}

export async function retireSupersededBillingCheckoutIntents(
  userId: string,
  provider: string,
  completedIntentId: string,
) {
  return retireBillingCheckoutIntents(userId, { excludeId: completedIntentId, provider });
}

async function retireBillingCheckoutIntents(
  userId: string,
  options: { excludeId?: string; provider?: string } = {},
) {
  const intents = await prisma.billingCheckoutIntent.findMany({
    where: {
      userId,
      ...(options.excludeId ? { id: { not: options.excludeId } } : {}),
      ...(options.provider ? { provider: options.provider } : {}),
      OR: [
        {
          status: {
            in: [...ACCOUNT_RETIRABLE_INTENT_STATUSES, "paid_pending_subscription"],
          },
        },
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
        {
          provider: "square",
          status: "failed",
          OR: [
            { checkoutUrl: { not: null } },
            { providerCheckoutId: { not: null } },
            { providerCustomerId: { not: null } },
            { providerOrderId: { not: null } },
            { providerPaymentId: { not: null } },
          ],
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  let claimedCount = 0;
  for (const candidate of intents) {
    const intent = await claimBillingCheckoutIntentForAccountRetirement(userId, candidate.id);
    if (!intent) continue;
    claimedCount += 1;

    let providerCheckoutId = intent.providerCheckoutId;
    let providerOrderId = intent.providerOrderId;

    if (!providerCheckoutId) {
      if (intent.provider === "square") {
        if (squareMissingCheckoutMustRemainWorkerOwned(intent)) {
          throw new BillingCheckoutConflictError(
            "The Square checkout is awaiting worker-owned payment settlement or subscription reconciliation. " +
            "It cannot be recreated while account deletion is in progress.",
          );
        }
        const checkout = await createSquareSubscriptionCheckout({
          email: intent.user.email,
          expectation: squareExpectationFromIntent(intent),
          idempotencyKey: intent.idempotencyKey,
          origin: intent.checkoutOrigin,
          plan: checkoutPlanFromIntent(intent.plan),
        });
        providerCheckoutId = checkout.id;
        providerOrderId = checkout.orderId;
      } else if (intent.provider === "stripe") {
        const checkout = await recoverStripeCheckoutSession(intent);
        providerCheckoutId = checkout.id;
      }

      if (providerCheckoutId) {
        await prisma.billingCheckoutIntent.update({
          where: { id: intent.id },
          data: { providerCheckoutId, providerOrderId },
        });
      }
    }

    if (!providerCheckoutId) {
      throw new BillingCheckoutConflictError(
        "A provider checkout may still be in progress and cannot be retired safely. Contact support before deleting the account.",
      );
    }

    await retireProviderCheckout(
      intent.provider,
      providerCheckoutId,
      providerOrderId,
      intent.createdAt,
    );
    await completeBillingCheckoutRetirement(intent.id, intent.idempotencyKey);
  }

  return { retired: claimedCount };
}

async function claimBillingCheckoutIntentForAccountRetirement(userId: string, intentId: string) {
  return prisma.$transaction(async (transaction) => {
    await lockBillingCheckout(transaction, userId);
    await transaction.$queryRaw`
      SELECT "id"
      FROM "billing_checkout_intents"
      WHERE "id" = ${intentId}::uuid
        AND "user_id" = ${userId}::uuid
      FOR UPDATE
    `;
    const intent = await transaction.billingCheckoutIntent.findFirst({
      where: { id: intentId, userId },
      include: { user: { select: { email: true } } },
    });
    if (!intent) return null;

    const failedSquareProviderState = intent.provider === "square" &&
      intent.status === "failed" &&
      Boolean(
        intent.checkoutUrl ||
        intent.providerCheckoutId ||
        intent.providerCustomerId ||
        intent.providerOrderId ||
        intent.providerPaymentId,
      );
    if (failedSquareProviderState) {
      throw new BillingCheckoutConflictError(
        "A failed Square checkout still retains provider state and requires manual reconciliation before account deletion.",
      );
    }

    if (checkoutIntentMustAwaitProviderReconciliation(intent)) {
      throw new BillingCheckoutConflictError(
        "A completed provider payment is still awaiting subscription reconciliation. " +
        "Wait for provider truth before deleting the account.",
      );
    }

    const legacySquareProviderObject = intent.provider === "square" &&
      intent.status === "retired" &&
      Boolean(
        intent.checkoutUrl ||
        intent.providerCheckoutId ||
        intent.providerOrderId ||
        intent.providerPaymentId,
      );
    if (!ACCOUNT_RETIRABLE_INTENT_STATUSES.includes(intent.status) && !legacySquareProviderObject) {
      return null;
    }

    const claimed = await transaction.billingCheckoutIntent.updateMany({
      where: {
        id: intent.id,
        providerPaymentId: null,
        status: intent.status,
        userId,
      },
      data: {
        leaseExpiresAt: new Date(Date.now() + INTENT_LEASE_MS),
        status: "retiring",
      },
    });
    if (claimed.count !== 1) return null;
    return { ...intent, status: "retiring" };
  });
}

async function recoverStripeCheckoutSession(intent: {
  checkoutOrigin: string;
  createdAt: Date;
  id: string;
  idempotencyKey: string;
  plan: SubscriptionPlan;
  providerCustomerId: string | null;
  providerPlanVariationId: string | null;
  userId: string;
}) {
  let customerId = intent.providerCustomerId;
  if (!customerId) {
    const ownedCustomer = await prisma.billingCustomer.findFirst({
      where: { provider: "stripe", userId: intent.userId },
      orderBy: { updatedAt: "desc" },
      select: { providerCustomerId: true },
    });
    customerId = ownedCustomer?.providerCustomerId ?? null;
    if (customerId) {
      await prisma.billingCheckoutIntent.updateMany({
        where: { id: intent.id, providerCustomerId: null },
        data: { providerCustomerId: customerId },
      });
    }
  }

  if (!customerId) {
    throw new BillingCheckoutConflictError(
      "The Stripe checkout customer reference is missing. Contact support before deleting the account.",
    );
  }

  const recovery = await recoverStripeCheckoutAfterResponseLoss({
    checkoutIntentId: intent.id,
    createdAt: intent.createdAt,
    customerId,
    findExact: () => findStripeCheckoutSessionByIntent({
      checkoutIntentId: intent.id,
      customerId,
    }),
    maxAgeMs: STRIPE_IDEMPOTENCY_RECOVERY_MS,
    replay: async () => {
      if (!intent.providerPlanVariationId) {
        throw new BillingCheckoutConflictError(
          "The Stripe checkout is missing its immutable price reference. Contact support before deleting the account.",
        );
      }
      return createStripeCheckoutSession({
        checkoutIntentId: intent.id,
        customerId,
        idempotencyKey: intent.idempotencyKey,
        origin: intent.checkoutOrigin,
        plan: checkoutPlanFromIntent(intent.plan),
        priceId: intent.providerPlanVariationId,
        userId: intent.userId,
      });
    },
  }).catch((error) => {
    if (error instanceof BillingCheckoutConflictError) throw error;
    throw new BillingCheckoutConflictError(
      `${error instanceof Error ? error.message : "Stripe checkout recovery failed."} ` +
      "Contact support before deleting the account.",
    );
  });
  return recovery.session;
}

export async function completeBillingCheckoutIntent({
  id,
  idempotencyKey,
  leaseToken,
  providerCheckoutId,
  providerOrderId,
  url,
}: {
  id: string;
  idempotencyKey: string;
  leaseToken: string;
  providerCheckoutId: string;
  providerOrderId?: string;
  url: string;
}) {
  return prisma.$transaction(async (transaction) => {
    const reference = await transaction.billingCheckoutIntent.findFirst({
      where: { id, idempotencyKey },
      select: { provider: true, userId: true },
    });
    if (!reference) throw new BillingCheckoutConflictError("Checkout intent no longer exists.");

    await lockBillingCheckout(transaction, reference.userId);
    await transaction.$queryRaw`
      SELECT "id"
      FROM "billing_checkout_intents"
      WHERE "id" = ${id}::uuid
      FOR UPDATE
    `;
    const [intent, user] = await Promise.all([
      transaction.billingCheckoutIntent.findFirst({ where: { id, idempotencyKey } }),
      transaction.user.findUnique({
        where: { id: reference.userId },
        select: { deletionRequestedAt: true },
      }),
    ]);
    if (!intent) throw new BillingCheckoutConflictError("Checkout intent no longer exists.");

    const decision = decideCheckoutCompletion({
      checkoutUrl: intent.checkoutUrl,
      deletionRequestedAt: user ? user.deletionRequestedAt : new Date(),
      leaseToken: intent.leaseToken,
      providerCheckoutId: intent.providerCheckoutId,
      providerOrderId: intent.providerOrderId,
      status: intent.status,
    }, {
      leaseToken,
      providerCheckoutId,
      providerOrderId,
      url,
    });

    if (decision.kind === "publish") {
      await transaction.billingCheckoutIntent.update({
        where: { id: intent.id },
        data: {
          checkoutUrl: url,
          providerCheckoutId,
          providerOrderId,
          status: "ready",
        },
      });
      return decision;
    }

    if (
      decision.kind === "retire" &&
      (intent.status === "creating" || intent.status === "retiring" || intent.status === "failed")
    ) {
      await transaction.billingCheckoutIntent.update({
        where: { id: intent.id },
        data: {
          checkoutUrl: url,
          leaseExpiresAt: new Date(Date.now() + INTENT_LEASE_MS),
          providerCheckoutId,
          providerOrderId,
          status: "retiring",
        },
      });
    }

    if (decision.kind === "superseded" && !intent.providerCheckoutId) {
      // Preserve the durable result obtained by the old generation. The new
      // generation must receive the same idempotent provider object before it
      // may publish; if it differs, completion fails ambiguous and neither
      // request blindly destroys the other's checkout.
      await transaction.billingCheckoutIntent.update({
        where: { id: intent.id },
        data: { checkoutUrl: url, providerCheckoutId, providerOrderId },
      });
    }

    return decision;
  });
}

export async function failBillingCheckoutIntent(id: string, idempotencyKey: string, leaseToken: string) {
  await prisma.billingCheckoutIntent.updateMany({
    where: { id, idempotencyKey, leaseToken, status: "creating" },
    data: { expiresAt: new Date(0), status: "failed" },
  }).catch((error) => {
    console.error("Unable to release failed checkout intent.", error);
  });
}

export async function markBillingCheckoutIntentRecoverable(
  id: string,
  idempotencyKey: string,
  leaseToken: string,
) {
  await prisma.billingCheckoutIntent.updateMany({
    where: { id, idempotencyKey, leaseToken, status: "creating" },
    data: { status: "recoverable" },
  }).catch((error) => {
    console.error("Unable to preserve recoverable checkout intent.", error);
  });
}

const defaultImmediateSquareRetirementOperations: ImmediateSquareRetirementOperations = {
  retrieveOrder: retrieveSquareOrder,
  retrievePaymentLink: retrieveSquarePaymentLink,
  searchPaymentsByOrder: searchSquarePaymentsByOrder,
};

function checkoutPricingSnapshot(
  provider: string,
  expectation: { amountMinor?: number | null; currency?: string | null; planVariationId: string },
): CheckoutPricingSnapshot {
  if (provider !== "square") {
    if (!expectation.planVariationId.trim()) {
      throw new BillingCheckoutConflictError("Stripe checkout pricing could not be snapshotted safely.");
    }
    return {
      expectedAmountMinor: null,
      expectedCurrency: null,
      providerPlanVariationId: expectation.planVariationId.trim(),
    };
  }
  if (!Number.isSafeInteger(expectation.amountMinor) || (expectation.amountMinor ?? 0) <= 0 ||
    !expectation.currency?.trim() || !expectation.planVariationId.trim()) {
    throw new BillingCheckoutConflictError("Square checkout pricing could not be snapshotted safely.");
  }
  return {
    expectedAmountMinor: expectation.amountMinor ?? null,
    expectedCurrency: expectation.currency.trim().toUpperCase(),
    providerPlanVariationId: expectation.planVariationId.trim(),
  };
}

function checkoutPricingFromIntent(intent: CheckoutPricingSnapshot & { provider: string }) {
  if (intent.provider === "square") {
    squareExpectationFromIntent(intent);
  } else if (!intent.providerPlanVariationId) {
    throw new BillingCheckoutConflictError(
      "The Stripe checkout is missing its immutable price snapshot. Contact support before continuing.",
    );
  }
  return {
    expectedAmountMinor: intent.expectedAmountMinor,
    expectedCurrency: intent.expectedCurrency,
    providerPlanVariationId: intent.providerPlanVariationId,
  };
}

function checkoutPlanFromIntent(plan: SubscriptionPlan): "monthly" | "yearly" {
  if (plan === SubscriptionPlan.PLUS_YEARLY) return "yearly";
  if (plan === SubscriptionPlan.PLUS_MONTHLY) return "monthly";
  throw new BillingCheckoutConflictError("Checkout intent did not contain a Plus plan.");
}

function normalizeCheckoutOrigin(origin: string) {
  const normalized = origin.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(normalized)) {
    throw new BillingCheckoutConflictError("Checkout origin could not be recorded safely.");
  }
  return normalized;
}

function squareExpectationFromIntent(intent: CheckoutPricingSnapshot) {
  if (!intent.expectedAmountMinor || !intent.expectedCurrency || !intent.providerPlanVariationId) {
    throw new BillingCheckoutConflictError(
      "The Square checkout is missing its immutable pricing snapshot. Contact support before continuing.",
    );
  }
  return {
    amountMinor: intent.expectedAmountMinor,
    currency: intent.expectedCurrency,
    planVariationId: intent.providerPlanVariationId,
  };
}
