import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { retrieveSquareCustomer } from "@/lib/billing/square";
import {
  planFromHint,
  planFromPriceId,
  planFromSquarePlanVariationId,
  statusFromSquare,
  statusFromStripe,
} from "@/lib/billing/subscription-mapping";
import type { SquareWebhookEvent, StripeWebhookEvent } from "@/lib/billing/webhook-signature";

export {
  planFromHint,
  planFromPriceId,
  planFromSquarePlanVariationId,
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

export type StripeWebhookFulfillmentResult = {
  handled: boolean;
  message: string;
};

export type SquareWebhookFulfillmentResult = StripeWebhookFulfillmentResult;

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

export async function fulfillSquareWebhookEvent(
  event: SquareWebhookEvent,
): Promise<SquareWebhookFulfillmentResult> {
  if (event.type === "subscription.created" || event.type === "subscription.updated") {
    const subscription = squareSubscriptionFromEvent(event);

    if (!subscription) {
      return {
        handled: false,
        message: "Square subscription event did not include a subscription object.",
      };
    }

    return fulfillSquareSubscription(subscription);
  }

  if (event.type === "invoice.payment_made") {
    return fulfillSquareInvoicePayment(squareInvoiceFromEvent(event));
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
  const existing = await findExistingSubscription({ customerId, provider: "stripe", subscriptionId });
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

export async function fulfillSquareSubscription(subscription: SquareSubscription) {
  const customerId = subscription.customer_id ?? null;
  const subscriptionId = subscription.id ?? null;
  const existing = await findExistingSubscription({ customerId, provider: "square", subscriptionId });
  const userId = existing?.userId ?? (await userIdFromSquareCustomer(customerId));

  if (!userId || !customerId || !subscriptionId) {
    return {
      handled: false,
      message: "Square subscription event could not be matched to a PokeStop user.",
    };
  }

  await writeProviderSubscription({
    cancelAtPeriodEnd: Boolean(subscription.canceled_date),
    currentPeriodEnd: squareDateToPeriodEnd(subscription.charged_through_date),
    customerId,
    plan: planFromSquarePlanVariationId(subscription.plan_variation_id, existing?.plan),
    provider: "square",
    status: statusFromSquare(subscription.status),
    subscriptionId,
    userId,
  });

  return {
    handled: true,
    message: "Square subscription state synced.",
  };
}

export async function fulfillSquareInvoicePayment(invoice: SquareInvoice | null) {
  const customerId = invoice?.customer_id ?? null;
  const subscriptionId = invoice?.subscription_id ?? null;
  const existing = await findExistingSubscription({ customerId, provider: "square", subscriptionId });

  if (!existing) {
    return {
      handled: false,
      message: "Square invoice payment could not be matched to a PokeStop subscription.",
    };
  }

  await prisma.subscription.update({
    where: { id: existing.id },
    data: { status: SubscriptionStatus.ACTIVE },
  });

  return {
    handled: true,
    message: "Square invoice payment confirmed.",
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
}) {
  if (!customerId && !subscriptionId) {
    return null;
  }

  return prisma.subscription.findFirst({
    where: {
      provider,
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
  return writeProviderSubscription({
    cancelAtPeriodEnd,
    currentPeriodEnd,
    customerId,
    plan,
    provider: "stripe",
    status,
    subscriptionId,
    userId,
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
}: {
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: Date;
  customerId: string;
  plan: SubscriptionPlan;
  provider: string;
  status: SubscriptionStatus;
  subscriptionId: string;
  userId: string;
}) {
  const existing = await findExistingSubscription({ customerId, provider, subscriptionId });
  const data = {
    cancelAtPeriodEnd,
    currentPeriodEnd,
    plan,
    provider,
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

function isSquareSubscriptionEnvelope(value: SquareSubscriptionEnvelope | SquareSubscription): value is SquareSubscriptionEnvelope {
  return "subscription" in value;
}

function isSquareInvoiceEnvelope(value: SquareInvoiceEnvelope | SquareInvoice): value is SquareInvoiceEnvelope {
  return "invoice" in value;
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

function squareDateToPeriodEnd(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T23:59:59.999Z`)
    : new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}
