import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { activeBillingProvider } from "@/lib/billing/provider";
import { cancelSquareSubscription } from "@/lib/billing/square";
import { planFromSquarePlanVariationId, statusFromSquare } from "@/lib/billing/subscription-mapping";
import { prisma } from "@/lib/db/prisma";
import type { AppSubscription } from "@/lib/types";

const activeStatuses = new Set<SubscriptionStatus>([
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
]);

export async function getCurrentBillingSubscription(userId: string): Promise<AppSubscription> {
  const subscription = await latestSubscriptionForUser(userId);

  return serializeSubscription(subscription);
}

export async function cancelCurrentSquareSubscription(userId: string): Promise<AppSubscription> {
  const provider = activeBillingProvider();

  if (provider !== "square") {
    throw new Error("Square billing is not the active billing provider.");
  }

  const subscription = await prisma.subscription.findFirst({
    where: {
      provider: "square",
      providerSubscriptionId: { not: null },
      userId,
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!subscription?.providerSubscriptionId) {
    throw new Error("No Square subscription found for this account.");
  }

  if (subscription.cancelAtPeriodEnd || subscription.status === SubscriptionStatus.CANCELED) {
    return serializeSubscription(subscription);
  }

  const squareSubscription = await cancelSquareSubscription(subscription.providerSubscriptionId);
  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      cancelAtPeriodEnd: Boolean(squareSubscription.canceled_date) || true,
      currentPeriodEnd:
        squareDateToPeriodEnd(squareSubscription.charged_through_date) ??
        subscription.currentPeriodEnd,
      plan: planFromSquarePlanVariationId(squareSubscription.plan_variation_id, subscription.plan),
      status: statusFromSquare(squareSubscription.status),
    },
  });

  return serializeSubscription(updated);
}

function latestSubscriptionForUser(userId: string) {
  return prisma.subscription.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
}

function serializeSubscription(
  subscription: Awaited<ReturnType<typeof latestSubscriptionForUser>>,
): AppSubscription {
  if (!subscription) {
    return {
      cancelAtPeriodEnd: false,
      entitlements: {
        "billing.portal": false,
        "exports.insurance_report": false,
        "pricing.alerts": false,
      },
      plan: "free",
    };
  }

  const isPlus =
    activeStatuses.has(subscription.status) &&
    (subscription.plan === SubscriptionPlan.PLUS_MONTHLY ||
      subscription.plan === SubscriptionPlan.PLUS_YEARLY);

  return {
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString(),
    entitlements: {
      "billing.portal": isPlus,
      "exports.insurance_report": isPlus,
      "pricing.alerts": isPlus,
    },
    plan: isPlus ? "plus" : "free",
    provider: subscription.provider,
    providerSubscriptionId: subscription.providerSubscriptionId ?? undefined,
    status: subscription.status,
  };
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
