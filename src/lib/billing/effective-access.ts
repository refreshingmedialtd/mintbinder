import { Prisma, SubscriptionPlan, SubscriptionStatus } from "@prisma/client";

export function hasEffectivePlusAccess(
  subscription: {
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date | null;
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
  } | null | undefined,
  now = new Date(),
) {
  if (!subscription) return false;
  const active = subscription.status === SubscriptionStatus.ACTIVE ||
    subscription.status === SubscriptionStatus.TRIALING;
  const plus = subscription.plan === SubscriptionPlan.PLUS_MONTHLY ||
    subscription.plan === SubscriptionPlan.PLUS_YEARLY;

  if (!active || !plus) return false;
  if (!subscription.cancelAtPeriodEnd) return true;

  // Missing paid-through data remains conservative in the subscriber's favour;
  // a known paid-through timestamp never grants access after it passes.
  return !subscription.currentPeriodEnd || subscription.currentPeriodEnd > now;
}

export function effectivePlusAccessWhere(now = new Date()): Prisma.SubscriptionWhereInput {
  return {
    plan: { in: [SubscriptionPlan.PLUS_MONTHLY, SubscriptionPlan.PLUS_YEARLY] },
    status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
    OR: [
      { cancelAtPeriodEnd: false },
      { currentPeriodEnd: null },
      { currentPeriodEnd: { gt: now } },
    ],
  };
}
