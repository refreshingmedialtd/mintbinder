import { Prisma, SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  retrieveSquareCustomer,
  retrieveSquarePayment,
  retrieveSquareSubscription,
  type SquarePaymentRecord,
} from "@/lib/billing/square";
import {
  squareSubscriptionPeriodEnd,
  statusFromSquare,
  statusFromSquareForLocalAccess,
  statusFromStripe,
} from "@/lib/billing/subscription-mapping";
import {
  type SquareWebhookEvent,
  type StripeWebhookEvent,
} from "@/lib/billing/webhook-signature";
import { retrieveStripeSubscription } from "@/lib/billing/stripe";
import {
  retireSupersededBillingCheckoutIntents,
} from "@/lib/billing/checkout-intents";
import {
  parseSquareCheckoutCorrelation,
  squarePaymentMatchesCheckout,
} from "@/lib/billing/square-checkout-correlation";
import { claimBillingCustomerOwnership } from "@/lib/billing/customer-ownership";
import {
  selectSquarePaymentActivationTarget,
  selectSquareTerminalCustomerRowsToDetach,
} from "@/lib/billing/subscription-selection";
import {
  exactSquareInvoiceSubscriptionId,
  intentIsLiveForProviderReconciliation,
  providerEventMayAttachNewSubscription,
  squarePlanForProviderEvent,
  stripePlanForProviderEvent,
} from "@/lib/billing/provider-event-safety";

export {
  planFromHint,
  planFromPriceId,
  planFromSquarePlanVariationId,
  squareSubscriptionPeriodEnd,
  statusFromSquareForLocalAccess,
  statusFromSquare,
  statusFromStripe,
} from "@/lib/billing/subscription-mapping";

type StripeCheckoutSession = {
  client_reference_id?: string | null;
  customer?: string | { id?: string | null } | null;
  metadata?: Record<string, string | undefined> | null;
  subscription?: string | { id?: string | null } | null;
};

type StripeSubscription = {
  cancel_at_period_end?: boolean | null;
  current_period_end?: number | null;
  customer?: string | { id?: string | null } | null;
  id?: string | null;
  items?: {
    data?: Array<{
      price?: {
        id?: string | null;
      } | null;
    }>;
  } | null;
  metadata?: Record<string, string | undefined> | null;
  status?: string | null;
};

type SquareSubscription = {
  canceled_date?: string | null;
  charged_through_date?: string | null;
  customer_id?: string | null;
  id?: string | null;
  plan_variation_id?: string | null;
  status?: string | null;
};

type SquareSubscriptionEnvelope = {
  subscription?: SquareSubscription | null;
};

type SquareInvoice = {
  customer_id?: string | null;
  subscription_id?: string | null;
};

type SquareInvoiceEnvelope = {
  invoice?: SquareInvoice | null;
};

type SquarePaymentEnvelope = {
  payment?: SquarePaymentRecord | null;
};

export type StripeWebhookFulfillmentResult = {
  handled: boolean;
  message: string;
};

export type SquareWebhookFulfillmentResult = StripeWebhookFulfillmentResult;

export async function fulfillStripeWebhookEvent(
  event: StripeWebhookEvent,
): Promise<StripeWebhookFulfillmentResult> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as StripeCheckoutSession;
    const subscriptionId = stripeId(session.subscription);

    if (subscriptionId) {
      const current = await retrieveStripeSubscription(subscriptionId) as StripeSubscription;
      return fulfillSubscription(current, new Date());
    }

    throw reconciliationError("Completed Stripe checkout did not include its subscription ID.");
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const eventSubscription = event.data.object as StripeSubscription;
    const subscriptionId = eventSubscription.id;

    if (!subscriptionId) {
      throw reconciliationError("Stripe subscription event did not include a subscription ID.");
    }

    const current = await retrieveStripeSubscription(subscriptionId) as StripeSubscription;
    return fulfillSubscription(current, new Date());
  }

  return {
    handled: false,
    message: `Ignored ${event.type}.`,
  };
}

export async function fulfillSquareWebhookEvent(
  event: SquareWebhookEvent,
): Promise<SquareWebhookFulfillmentResult> {
  if (event.type === "subscription.created" || event.type === "subscription.updated") {
    const eventSubscription = squareSubscriptionFromEvent(event);

    if (!eventSubscription?.id) {
      throw reconciliationError("Square subscription event did not include a subscription object.");
    }

    const current = await retrieveSquareSubscription(eventSubscription.id);

    if (!current) {
      throw reconciliationError("Square subscription could not be retrieved for reconciliation.");
    }

    return fulfillSquareSubscription(current, new Date());
  }

  if (event.type === "invoice.payment_made") {
    const invoice = squareInvoiceFromEvent(event);

    const subscriptionId = exactSquareInvoiceSubscriptionId(invoice?.subscription_id);
    if (subscriptionId) {
      const current = await retrieveSquareSubscription(subscriptionId);

      if (!current) {
        throw reconciliationError("Square invoice subscription could not be retrieved for reconciliation.");
      }

      return fulfillSquareSubscription(current, new Date());
    }

    return {
      handled: false,
      message: "Ignored a Square invoice without an exact subscription ID.",
    };
  }

  if (event.type === "payment.created" || event.type === "payment.updated") {
    const eventPayment = squarePaymentFromEvent(event);

    if (!eventPayment?.id) {
      throw reconciliationError("Square payment event did not include a payment ID.");
    }

    const current = await retrieveSquarePayment(eventPayment.id);
    if (!current) throw reconciliationError("Square payment could not be retrieved for reconciliation.");

    return fulfillSquareCheckoutPayment(current);
  }

  return {
    handled: false,
    message: `Ignored ${event.type}.`,
  };
}

export async function fulfillSquareCheckoutPayment(payment: SquarePaymentRecord) {
  const idempotencyKey = parseSquareCheckoutCorrelation(payment.note);

  if (!idempotencyKey) {
    return { handled: false, message: "Ignored an unrelated Square payment." };
  }

  if (payment.status?.trim().toUpperCase() !== "COMPLETED") {
    return { handled: false, message: "Square checkout payment is not complete yet." };
  }

  const intent = await prisma.billingCheckoutIntent.findUnique({ where: { idempotencyKey } });
  const customerId = payment.customer_id?.trim();
  const paymentId = payment.id?.trim();

  if (!intent || intent.provider !== "square" || !customerId || !paymentId) {
    throw reconciliationError("Square payment correlation could not be matched to a checkout intent and customer.");
  }

  if (!squarePaymentMatchesCheckout({
    amountMinor: payment.amount_money?.amount,
    currency: payment.amount_money?.currency,
    expectedAmountMinor: intent.expectedAmountMinor,
    expectedCurrency: intent.expectedCurrency,
  })) {
    throw reconciliationError("Square payment amount, currency, or plan did not match the checkout intent.");
  }

  if (intent.plan !== SubscriptionPlan.PLUS_MONTHLY && intent.plan !== SubscriptionPlan.PLUS_YEARLY) {
    throw reconciliationError("Square payment checkout intent did not contain a Plus plan.");
  }

  const now = new Date();
  const currentPeriodEnd = squareSubscriptionPeriodEnd({
    anchor: now,
    estimateWhenMissing: true,
    plan: intent.plan,
  });

  const activated = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "billing_checkout_intents"
      WHERE "id" = ${intent.id}::uuid
      FOR UPDATE
    `;
    const lockedIntent = await transaction.billingCheckoutIntent.findUnique({ where: { id: intent.id } });

    if (!lockedIntent || lockedIntent.idempotencyKey !== idempotencyKey) {
      throw reconciliationError("Square checkout intent changed during payment reconciliation.");
    }

    if (![
      "creating",
      "recoverable",
      "ready",
      "retiring",
      "paid_pending_subscription",
      "completed",
    ].includes(lockedIntent.status)) {
      throw reconciliationError("Square payment matched a terminal checkout intent.");
    }

    if (lockedIntent.providerPaymentId) {
      if (lockedIntent.providerPaymentId !== paymentId) {
        throw reconciliationError("Square checkout intent was already completed by a different payment.");
      }
      return false;
    }

    await claimBillingCustomerOwnership({
      allowDuringDeletion: true,
      client: transaction,
      customerId,
      provider: "square",
      userId: lockedIntent.userId,
    });

    const candidates = await transaction.subscription.findMany({
      where: {
        userId: lockedIntent.userId,
        provider: "square",
        providerCustomerId: customerId,
      },
      orderBy: { updatedAt: "desc" },
    });
    const existing = selectSquarePaymentActivationTarget(candidates, lockedIntent.plan, now);
    const data = {
      cancelAtPeriodEnd: false,
      currentPeriodEnd,
      plan: lockedIntent.plan,
      providerCustomerId: customerId,
      providerUpdatedAt: now,
      status: SubscriptionStatus.ACTIVE,
    };

    if (existing) {
      await transaction.subscription.update({ where: { id: existing.id }, data });
    } else {
      const terminalRows = selectSquareTerminalCustomerRowsToDetach(candidates);
      const unsafeHolder = candidates.find((candidate) =>
        !terminalRows.some((terminal) => terminal.id === candidate.id));
      if (unsafeHolder) {
        throw reconciliationError(
          "Square payment customer is still linked to a different non-terminal subscription.",
        );
      }
      if (terminalRows.length) {
        await transaction.subscription.updateMany({
          where: { id: { in: terminalRows.map((candidate) => candidate.id) } },
          data: { providerCustomerId: null },
        });
      }
      await transaction.subscription.create({
        data: { ...data, provider: "square", userId: lockedIntent.userId },
      });
    }

    await transaction.billingCheckoutIntent.update({
      where: { id: lockedIntent.id },
      data: {
        checkoutUrl: null,
        expiresAt: new Date(0),
        providerPaymentId: paymentId,
        status: existing?.providerSubscriptionId ? "completed" : "paid_pending_subscription",
      },
    });
    return true;
  });

  await retireSupersededBillingCheckoutIntents(intent.userId, "square", intent.id);

  return {
    handled: activated,
    message: activated
      ? "Square checkout payment correlated and Plus access activated."
      : "Square checkout payment was already correlated.",
  };
}

export async function fulfillSubscription(subscription: StripeSubscription, providerUpdatedAt?: Date) {
  const customerId = stripeId(subscription.customer);
  const subscriptionId = subscription.id ?? null;
  const existing = await findExistingSubscription({ customerId, provider: "stripe", subscriptionId });
  const userId = subscription.metadata?.user_id ?? existing?.userId;

  if (!userId || !customerId || !subscriptionId) {
    if (statusFromStripe(subscription.status) === SubscriptionStatus.CANCELED) {
      return {
        handled: false,
        message: "Ignored an unmatched terminal Stripe subscription.",
      };
    }

    throw reconciliationError("Subscription event could not be matched to a Mint Binder user.");
  }

  const priceId = subscription.items?.data?.[0]?.price?.id;
  const matchingIntent = await findMatchingBillingCheckoutIntent({
    intentId: subscription.metadata?.checkout_intent_id,
    planVariationId: priceId,
    provider: "stripe",
    userId,
  });
  const plan = stripePlanForProviderEvent(priceId, matchingIntent);
  if (!plan) {
    return { handled: false, message: "Ignored a Stripe subscription with an unknown price." };
  }
  if (!providerEventMayAttachNewSubscription({
    existingProviderSubscriptionId: existing?.providerSubscriptionId,
    matchingIntent,
    subscriptionId,
  })) {
    return { handled: false, message: "Ignored an unrelated Stripe subscription." };
  }

  const written = await writeStripeSubscription({
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    currentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : undefined,
    customerId,
    plan,
    status: statusFromStripe(subscription.status),
    subscriptionId,
    userId,
    providerUpdatedAt,
  });
  if (written && matchingIntent && intentIsLiveForProviderReconciliation(matchingIntent)) {
    await closeMatchingBillingCheckoutIntent(matchingIntent.id);
  }

  return {
    handled: written,
    message: written ? "Subscription state synced." : "Ignored an older subscription event.",
  };
}

export async function fulfillSquareSubscription(subscription: SquareSubscription, providerUpdatedAt?: Date) {
  const customerId = subscription.customer_id ?? null;
  const subscriptionId = subscription.id ?? null;
  const existing = await findExistingSubscription({ customerId, provider: "square", subscriptionId });
  const userId = existing?.userId ?? (await userIdFromSquareCustomer(customerId));

  if (!userId || !customerId || !subscriptionId) {
    if (statusFromSquare(subscription.status) === SubscriptionStatus.CANCELED) {
      return {
        handled: false,
        message: "Ignored an unmatched terminal Square subscription.",
      };
    }

    throw reconciliationError("Square subscription event could not be matched to a Mint Binder user.");
  }

  const matchingIntent = await findMatchingBillingCheckoutIntent({
    planVariationId: subscription.plan_variation_id,
    provider: "square",
    userId,
  });
  const plan = squarePlanForProviderEvent(subscription.plan_variation_id, matchingIntent);
  if (!plan) {
    return { handled: false, message: "Ignored a Square subscription with an unknown plan variation." };
  }
  if (!providerEventMayAttachNewSubscription({
    existingProviderSubscriptionId: existing?.providerSubscriptionId,
    matchingIntent,
    subscriptionId,
  })) {
    return { handled: false, message: "Ignored an unrelated Square subscription." };
  }

  const cancelAtPeriodEnd = Boolean(subscription.canceled_date);
  const squareStatus = statusFromSquare(subscription.status);
  const currentPeriodEnd = squareSubscriptionPeriodEnd({
    anchor: existing?.updatedAt ?? existing?.createdAt,
    chargedThroughDate: subscription.charged_through_date,
    estimateWhenMissing:
      cancelAtPeriodEnd ||
      squareStatus === SubscriptionStatus.ACTIVE,
    fallback: existing?.currentPeriodEnd,
    plan,
  });

  const written = await writeProviderSubscription({
    cancelAtPeriodEnd,
    currentPeriodEnd,
    customerId,
    plan,
    provider: "square",
    status: statusFromSquareForLocalAccess({
      cancelAtPeriodEnd,
      currentPeriodEnd,
      plan,
      status: subscription.status,
    }),
    subscriptionId,
    userId,
    providerUpdatedAt,
  });
  if (
    written &&
    !existing?.providerSubscriptionId &&
    matchingIntent &&
    intentIsLiveForProviderReconciliation(matchingIntent)
  ) {
    await closeMatchingBillingCheckoutIntent(matchingIntent.id);
  }

  return {
    handled: written,
    message: written ? "Square subscription state synced." : "Ignored an older Square subscription event.",
  };
}

async function findExistingSubscription({
  customerId,
  provider,
  subscriptionId,
}: {
  customerId?: string | null;
  provider: string;
  subscriptionId?: string | null;
}, client: Pick<Prisma.TransactionClient, "billingCustomer" | "subscription"> = prisma) {
  if (!customerId && !subscriptionId) {
    return null;
  }

  if (subscriptionId) {
    const exact = await client.subscription.findFirst({
      where: { provider, providerSubscriptionId: subscriptionId },
      orderBy: { updatedAt: "desc" },
    });

    if (exact || !customerId) return exact;

    // A customer fallback may attach the first provider subscription to a
    // checkout-created placeholder. It must never replace a different existing
    // subscription ID and orphan the original external agreement.
    const owner = await client.billingCustomer.findUnique({
      where: { provider_providerCustomerId: { provider, providerCustomerId: customerId } },
      select: { userId: true },
    });

    if (!owner) return null;

    return client.subscription.findFirst({
      where: {
        provider,
        providerCustomerId: customerId,
        providerSubscriptionId: null,
        userId: owner.userId,
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  if (!customerId) return null;
  const owner = await client.billingCustomer.findUnique({
    where: { provider_providerCustomerId: { provider, providerCustomerId: customerId } },
    select: { userId: true },
  });

  return owner
    ? client.subscription.findFirst({
        where: { provider, providerCustomerId: customerId, userId: owner.userId },
        orderBy: { updatedAt: "desc" },
      })
    : null;
}

async function findMatchingBillingCheckoutIntent({
  intentId,
  planVariationId,
  provider,
  userId,
}: {
  intentId?: string | null;
  planVariationId?: string | null;
  provider: string;
  userId: string;
}) {
  const normalizedVariationId = planVariationId?.trim() || null;
  const select = {
    id: true,
    plan: true,
    providerPlanVariationId: true,
    status: true,
  } as const;

  if (intentId?.trim()) {
    const exact = await prisma.billingCheckoutIntent.findFirst({
      where: { id: intentId.trim(), provider, userId },
      select,
    });
    if (
      exact?.providerPlanVariationId &&
      normalizedVariationId &&
      exact.providerPlanVariationId !== normalizedVariationId
    ) {
      return null;
    }
    return exact;
  }

  if (!normalizedVariationId) return null;
  return prisma.billingCheckoutIntent.findFirst({
    where: {
      provider,
      providerPlanVariationId: normalizedVariationId,
      status: {
        in: ["creating", "recoverable", "ready", "retiring", "paid_pending_subscription", "completed"],
      },
      userId,
    },
    orderBy: { updatedAt: "desc" },
    select,
  });
}

async function closeMatchingBillingCheckoutIntent(intentId: string) {
  await prisma.billingCheckoutIntent.updateMany({
    where: {
      id: intentId,
      status: { in: ["creating", "recoverable", "ready", "retiring", "paid_pending_subscription"] },
    },
    data: {
      checkoutUrl: null,
      expiresAt: new Date(0),
      status: "completed",
    },
  });
}

async function writeStripeSubscription({
  cancelAtPeriodEnd = false,
  currentPeriodEnd,
  customerId,
  plan,
  status,
  subscriptionId,
  userId,
  providerUpdatedAt,
}: {
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: Date;
  customerId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  subscriptionId: string;
  userId: string;
  providerUpdatedAt?: Date;
}) {
  return writeProviderSubscription({
    cancelAtPeriodEnd,
    currentPeriodEnd,
    customerId,
    plan,
    provider: "stripe",
    status,
    subscriptionId,
    userId,
    providerUpdatedAt,
  });
}

async function writeProviderSubscription({
  cancelAtPeriodEnd = false,
  currentPeriodEnd,
  customerId,
  plan,
  provider,
  status,
  subscriptionId,
  userId,
  providerUpdatedAt,
}: {
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: Date;
  customerId: string;
  plan: SubscriptionPlan;
  provider: string;
  status: SubscriptionStatus;
  subscriptionId: string;
  userId: string;
  providerUpdatedAt?: Date;
}) {
  return prisma.$transaction(async (transaction) => {
    await claimBillingCustomerOwnership({
      allowDuringDeletion: true,
      client: transaction,
      customerId,
      provider,
      userId,
    });
    const existing = await findExistingSubscription({ customerId, provider, subscriptionId }, transaction);
    const effectiveProviderUpdatedAt = providerUpdatedAt ?? new Date();
    const customerHolder = await transaction.subscription.findUnique({
      where: { providerCustomerId: customerId },
      select: { id: true },
    });
    const data = {
      cancelAtPeriodEnd,
      currentPeriodEnd,
      plan,
      provider,
      // Historical exact subscriptions may receive late terminal events after
      // a newer subscription has become the one local row holding the
      // customer's rollback-compatible unique providerCustomerId. Keep the
      // exact ID state update without stealing that live customer's slot.
      providerCustomerId: customerHolder && customerHolder.id !== existing?.id ? null : customerId,
      providerSubscriptionId: subscriptionId,
      providerUpdatedAt: effectiveProviderUpdatedAt,
      status,
    };

    if (existing) {
      const updated = await transaction.subscription.updateMany({
        where: {
          id: existing.id,
          OR: [
            { providerUpdatedAt: null },
            { providerUpdatedAt: { lt: effectiveProviderUpdatedAt } },
          ],
        },
        data,
      });
      return updated.count > 0;
    }

    if (customerHolder) {
      throw reconciliationError(
        "Provider customer is already linked to a different subscription and no checkout placeholder matched.",
      );
    }

    await transaction.subscription.create({
      data: {
        ...data,
        userId,
      },
    });
    return true;
  });
}

function stripeId(value: string | { id?: string | null } | null | undefined) {
  if (typeof value === "string") {
    return value;
  }

  return value?.id ?? null;
}

function squareSubscriptionFromEvent(event: SquareWebhookEvent) {
  const object = event.data?.object as SquareSubscriptionEnvelope | SquareSubscription | undefined;

  if (!object) {
    return null;
  }

  return isSquareSubscriptionEnvelope(object) ? object.subscription ?? null : object;
}

function squareInvoiceFromEvent(event: SquareWebhookEvent) {
  const object = event.data?.object as SquareInvoiceEnvelope | SquareInvoice | undefined;

  if (!object) {
    return null;
  }

  return isSquareInvoiceEnvelope(object) ? object.invoice ?? null : object;
}

function squarePaymentFromEvent(event: SquareWebhookEvent) {
  const object = event.data?.object as SquarePaymentEnvelope | SquarePaymentRecord | undefined;
  if (!object) return null;
  return isSquarePaymentEnvelope(object) ? object.payment ?? null : object;
}

function isSquareSubscriptionEnvelope(value: SquareSubscriptionEnvelope | SquareSubscription): value is SquareSubscriptionEnvelope {
  return "subscription" in value;
}

function isSquareInvoiceEnvelope(value: SquareInvoiceEnvelope | SquareInvoice): value is SquareInvoiceEnvelope {
  return "invoice" in value;
}

function isSquarePaymentEnvelope(value: SquarePaymentEnvelope | SquarePaymentRecord): value is SquarePaymentEnvelope {
  return "payment" in value;
}

async function userIdFromSquareCustomer(customerId?: string | null) {
  if (!customerId) {
    return null;
  }

  const customer = await retrieveSquareCustomer(customerId);
  const userId = customer?.referenceId;

  if (userId && await userExists(userId)) {
    return userId;
  }

  return null;
}

async function userExists(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  return Boolean(user);
}

function reconciliationError(message: string) {
  const error = new Error(message);
  error.name = "BillingWebhookReconciliationError";
  return error;
}
