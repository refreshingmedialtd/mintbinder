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

export function planFromSquarePlanVariationId(planVariationId?: string | null, fallback?: SubscriptionPlan) {
  if (planVariationId && planVariationId === process.env.SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID) {
    return SubscriptionPlan.PLUS_YEARLY;
  }

  if (planVariationId && planVariationId === process.env.SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID) {
    return SubscriptionPlan.PLUS_MONTHLY;
  }

  return fallback === SubscriptionPlan.PLUS_YEARLY ? fallback : SubscriptionPlan.PLUS_MONTHLY;
}
