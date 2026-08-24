import { SubscriptionPlan } from "@prisma/client";
import {
  planFromPriceId,
  planFromSquarePlanVariationId,
} from "./subscription-mapping.ts";

const LIVE_INTENT_STATUSES = new Set([
  "creating",
  "recoverable",
  "ready",
  "retiring",
  "paid_pending_subscription",
]);

export type ProviderPlanIntent = {
  id: string;
  plan: SubscriptionPlan;
  providerPlanVariationId: string | null;
  status: string;
};

export function squarePlanForProviderEvent(
  planVariationId: string | null | undefined,
  matchingIntent?: ProviderPlanIntent | null,
) {
  const normalized = planVariationId?.trim();
  if (!normalized) return null;

  if (
    matchingIntent?.providerPlanVariationId === normalized &&
    isPlusPlan(matchingIntent.plan)
  ) {
    return matchingIntent.plan;
  }

  return planFromSquarePlanVariationId(normalized);
}

export function stripePlanForProviderEvent(
  priceId: string | null | undefined,
  matchingIntent?: ProviderPlanIntent | null,
) {
  const normalized = priceId?.trim();
  if (!normalized) return null;

  if (
    matchingIntent?.providerPlanVariationId === normalized &&
    isPlusPlan(matchingIntent.plan)
  ) {
    return matchingIntent.plan;
  }

  return planFromPriceId(normalized);
}

export function providerEventMayAttachNewSubscription({
  existingProviderSubscriptionId,
  matchingIntent,
  subscriptionId,
}: {
  existingProviderSubscriptionId?: string | null;
  matchingIntent?: ProviderPlanIntent | null;
  subscriptionId: string;
}) {
  if (existingProviderSubscriptionId === subscriptionId) return true;
  return Boolean(matchingIntent && LIVE_INTENT_STATUSES.has(matchingIntent.status));
}

export function intentIsLiveForProviderReconciliation(intent?: ProviderPlanIntent | null) {
  return Boolean(intent && LIVE_INTENT_STATUSES.has(intent.status));
}

export function exactSquareInvoiceSubscriptionId(value?: string | null) {
  return value?.trim() || null;
}

function isPlusPlan(plan: SubscriptionPlan) {
  return plan === SubscriptionPlan.PLUS_MONTHLY || plan === SubscriptionPlan.PLUS_YEARLY;
}
