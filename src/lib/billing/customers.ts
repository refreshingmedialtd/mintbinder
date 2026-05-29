import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createStripeCustomer } from "@/lib/billing/stripe";

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
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

  if (subscription?.providerCustomerId) {
    return subscription.providerCustomerId;
  }

  const customer = await createStripeCustomer({ email, name, userId });

  if (subscription) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        provider: "stripe",
        providerCustomerId: customer.id,
      },
    });
  } else {
    await prisma.subscription.create({
      data: {
        userId,
        provider: "stripe",
        providerCustomerId: customer.id,
        plan: SubscriptionPlan.FREE,
        status: SubscriptionStatus.ACTIVE,
      },
    });
  }

  return customer.id;
}

export async function getStripeCustomer(userId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      userId,
      providerCustomerId: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: { providerCustomerId: true },
  });

  return subscription?.providerCustomerId ?? null;
}
