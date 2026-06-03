import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { activeBillingProvider } from "@/lib/billing/provider";
import { createSquareCustomer } from "@/lib/billing/square";
import { createStripeCustomer } from "@/lib/billing/stripe";
import { prisma } from "@/lib/db/prisma";

export async function getOrCreateBillingCustomer({
  email,
  name,
  userId,
}: {
  email?: string | null;
  name?: string | null;
  userId: string;
}) {
  return activeBillingProvider() === "square"
    ? getOrCreateSquareCustomer({ email, name, userId })
    : getOrCreateStripeCustomer({ email, name, userId });
}

export async function getBillingCustomer(userId: string) {
  return activeBillingProvider() === "square"
    ? getSquareCustomer(userId)
    : getStripeCustomer(userId);
}

export async function getOrCreateSquareCustomer({
  email,
  name,
  userId,
}: {
  email?: string | null;
  name?: string | null;
  userId: string;
}) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      provider: "square",
      userId,
    },
    orderBy: { updatedAt: "desc" },
  });

  if (subscription?.providerCustomerId) {
    return subscription.providerCustomerId;
  }

  const customer = await createSquareCustomer({ email, name, userId });
  const existingSubscription = subscription ?? await latestSubscriptionForUser(userId);

  if (existingSubscription && canReuseSubscriptionForProvider(existingSubscription, "square")) {
    await prisma.subscription.update({
      where: { id: existingSubscription.id },
      data: {
        provider: "square",
        providerCustomerId: customer.id,
      },
    });
    return customer.id;
  }

  await createFreeProviderSubscription({
    customerId: customer.id,
    provider: "square",
    userId,
  });

  return customer.id;
}

export async function getOrCreateStripeCustomer({
  email,
  name,
  userId,
}: {
  email?: string | null;
  name?: string | null;
  userId: string;
}) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      provider: "stripe",
      userId,
    },
    orderBy: { updatedAt: "desc" },
  });

  if (subscription?.providerCustomerId) {
    return subscription.providerCustomerId;
  }

  const customer = await createStripeCustomer({ email, name, userId });
  const existingSubscription = subscription ?? await latestSubscriptionForUser(userId);

  if (existingSubscription && canReuseSubscriptionForProvider(existingSubscription, "stripe")) {
    await prisma.subscription.update({
      where: { id: existingSubscription.id },
      data: {
        provider: "stripe",
        providerCustomerId: customer.id,
      },
    });
    return customer.id;
  }

  await createFreeProviderSubscription({
    customerId: customer.id,
    provider: "stripe",
    userId,
  });

  return customer.id;
}

export async function getSquareCustomer(userId: string) {
  return getProviderCustomer({ provider: "square", userId });
}

export async function getStripeCustomer(userId: string) {
  return getProviderCustomer({ provider: "stripe", userId });
}

async function getProviderCustomer({ provider, userId }: { provider: string; userId: string }) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      provider,
      userId,
      providerCustomerId: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: { providerCustomerId: true },
  });

  return subscription?.providerCustomerId ?? null;
}

async function latestSubscriptionForUser(userId: string) {
  return prisma.subscription.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
}

function canReuseSubscriptionForProvider(
  subscription: { provider: string; providerCustomerId: string | null; providerSubscriptionId: string | null },
  provider: string,
) {
  return (
    subscription.provider === provider ||
    (!subscription.providerCustomerId && !subscription.providerSubscriptionId)
  );
}

async function createFreeProviderSubscription({
  customerId,
  provider,
  userId,
}: {
  customerId: string;
  provider: string;
  userId: string;
}) {
  await prisma.subscription.create({
    data: {
      userId,
      provider,
      providerCustomerId: customerId,
      plan: SubscriptionPlan.FREE,
      status: SubscriptionStatus.ACTIVE,
    },
  });
}
