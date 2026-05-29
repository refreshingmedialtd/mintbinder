import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { StripeWebhookEvent } from "@/lib/billing/webhook-signature";

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

export type StripeWebhookFulfillmentResult = {
  handled: boolean;
  message: string;
};

export async function fulfillStripeWebhookEvent(
  event: StripeWebhookEvent,
): Promise<StripeWebhookFulfillmentResult> {
  if (event.type === "checkout.session.completed") {
    return fulfillCheckoutSession(event.data.object as StripeCheckoutSession);
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    return fulfillSubscription(event.data.object as StripeSubscription);
  }

  return {
    handled: false,
    message: `Ignored ${event.type}.`,
  };
}

export async function fulfillCheckoutSession(session: StripeCheckoutSession) {
  const userId = session.metadata?.user_id ?? session.client_reference_id;
  const customerId = stripeId(session.customer);
  const subscriptionId = stripeId(session.subscription);
  const plan = planFromHint(session.metadata?.plan);

  if (!userId || !customerId || !subscriptionId) {
    return {
      handled: false,
      message: "Checkout session did not include user, customer, and subscription ids.",
    };
  }

  await writeStripeSubscription({
    customerId,
    plan,
    status: SubscriptionStatus.ACTIVE,
    subscriptionId,
    userId,
  });

  return {
    handled: true,
    message: "Checkout subscription activated.",
  };
}

export async function fulfillSubscription(subscription: StripeSubscription) {
  const customerId = stripeId(subscription.customer);
  const subscriptionId = subscription.id ?? null;
  const existing = await findExistingSubscription(customerId, subscriptionId);
  const userId = subscription.metadata?.user_id ?? existing?.userId;

  if (!userId || !customerId || !subscriptionId) {
    return {
      handled: false,
      message: "Subscription event could not be matched to a PokeStop user.",
    };
  }

  await writeStripeSubscription({
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    currentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : undefined,
    customerId,
    plan: planFromPriceId(subscription.items?.data?.[0]?.price?.id, existing?.plan),
    status: statusFromStripe(subscription.status),
    subscriptionId,
    userId,
  });

  return {
    handled: true,
    message: "Subscription state synced.",
  };
}

export function statusFromStripe(status?: string | null) {
  switch (status) {
    case "active":
      return SubscriptionStatus.ACTIVE;
    case "trialing":
      return SubscriptionStatus.TRIALING;
    case "past_due":
      return SubscriptionStatus.PAST_DUE;
    case "canceled":
      return SubscriptionStatus.CANCELED;
    case "incomplete_expired":
      return SubscriptionStatus.INCOMPLETE_EXPIRED;
    case "unpaid":
      return SubscriptionStatus.UNPAID;
    case "incomplete":
    default:
      return SubscriptionStatus.INCOMPLETE;
  }
}

export function planFromHint(plan?: string | null) {
  return plan === "yearly" ? SubscriptionPlan.PLUS_YEARLY : SubscriptionPlan.PLUS_MONTHLY;
}

export function planFromPriceId(priceId?: string | null, fallback?: SubscriptionPlan) {
  if (priceId && priceId === process.env.STRIPE_PLUS_YEARLY_PRICE_ID) {
    return SubscriptionPlan.PLUS_YEARLY;
  }

  if (priceId && priceId === process.env.STRIPE_PLUS_MONTHLY_PRICE_ID) {
    return SubscriptionPlan.PLUS_MONTHLY;
  }

  return fallback === SubscriptionPlan.PLUS_YEARLY ? fallback : SubscriptionPlan.PLUS_MONTHLY;
}

async function findExistingSubscription(customerId?: string | null, subscriptionId?: string | null) {
  if (!customerId && !subscriptionId) {
    return null;
  }

  return prisma.subscription.findFirst({
    where: {
      OR: [
        ...(subscriptionId ? [{ providerSubscriptionId: subscriptionId }] : []),
        ...(customerId ? [{ providerCustomerId: customerId }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
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
}: {
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: Date;
  customerId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  subscriptionId: string;
  userId: string;
}) {
  const existing = await findExistingSubscription(customerId, subscriptionId);
  const data = {
    cancelAtPeriodEnd,
    currentPeriodEnd,
    plan,
    provider: "stripe",
    providerCustomerId: customerId,
    providerSubscriptionId: subscriptionId,
    status,
  };

  if (existing) {
    await prisma.subscription.update({
      where: { id: existing.id },
      data,
    });
    return;
  }

  await prisma.subscription.create({
    data: {
      ...data,
      userId,
    },
  });
}

function stripeId(value: string | { id?: string | null } | null | undefined) {
  if (typeof value === "string") {
    return value;
  }

  return value?.id ?? null;
}
