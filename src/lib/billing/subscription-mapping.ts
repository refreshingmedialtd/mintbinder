import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";

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

export function statusFromSquare(status?: string | null) {
  switch (status?.toUpperCase()) {
    case "ACTIVE":
      return SubscriptionStatus.ACTIVE;
    case "PENDING":
      return SubscriptionStatus.INCOMPLETE;
    case "PAUSED":
    case "PAST_DUE":
      return SubscriptionStatus.PAST_DUE;
    case "CANCELED":
    case "DEACTIVATED":
      return SubscriptionStatus.CANCELED;
    default:
      return SubscriptionStatus.INCOMPLETE;
  }
}

export function statusFromSquareForLocalAccess({
  cancelAtPeriodEnd,
  currentPeriodEnd,
  now = new Date(),
  plan,
  status,
}: {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd?: Date;
  now?: Date;
  plan: SubscriptionPlan;
  status?: string | null;
}) {
  const mappedStatus = statusFromSquare(status);

  if (!cancelAtPeriodEnd || !isPlusPlan(plan)) {
    return mappedStatus;
  }

  if (!currentPeriodEnd || currentPeriodEnd.getTime() > now.getTime()) {
    return SubscriptionStatus.ACTIVE;
  }

  return mappedStatus;
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

export function squareSubscriptionPeriodEnd({
  anchor = new Date(),
  chargedThroughDate,
  estimateWhenMissing = false,
  fallback,
  plan,
}: {
  anchor?: Date;
  chargedThroughDate?: string | null;
  estimateWhenMissing?: boolean;
  fallback?: Date | null;
  plan: SubscriptionPlan;
}) {
  return (
    squareDateToPeriodEnd(chargedThroughDate) ??
    fallback ??
    (estimateWhenMissing ? estimateSquarePeriodEnd(plan, anchor) : undefined)
  );
}

function isPlusPlan(plan: SubscriptionPlan) {
  return plan === SubscriptionPlan.PLUS_MONTHLY || plan === SubscriptionPlan.PLUS_YEARLY;
}

function estimateSquarePeriodEnd(plan: SubscriptionPlan, anchor: Date) {
  if (!isPlusPlan(plan)) {
    return undefined;
  }

  const periodEnd = new Date(anchor);

  if (plan === SubscriptionPlan.PLUS_YEARLY) {
    periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
    return periodEnd;
  }

  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  return periodEnd;
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

export function planFromSquarePlanVariationId(planVariationId?: string | null, fallback?: SubscriptionPlan) {
  if (planVariationId && planVariationId === process.env.SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID) {
    return SubscriptionPlan.PLUS_YEARLY;
  }

  if (planVariationId && planVariationId === process.env.SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID) {
    return SubscriptionPlan.PLUS_MONTHLY;
  }

  return fallback === SubscriptionPlan.PLUS_YEARLY ? fallback : SubscriptionPlan.PLUS_MONTHLY;
}
