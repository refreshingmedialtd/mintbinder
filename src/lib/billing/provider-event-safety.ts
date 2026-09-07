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

export type SquareInvoicePlanIntent = ProviderPlanIntent & {
  providerOrderId: string | null;
  providerPaymentId: string | null;
};

export type SquareSubscriptionAttachmentDecision =
  | "attach_invoice"
  | "ignore_unproven"
  | "retry_invoice"
  | "update_exact"
  | "update_exact_invoice";

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

export function exactSquareInvoiceOrderId(value?: string | null) {
  return value?.trim() || null;
}

/**
 * Square subscription webhooks do not identify the checkout order, and a
 * returning customer may have several same-plan subscriptions. Only an exact
 * invoice order+subscription correlation may attach a new remote ID to the
 * payment-created provisional row. Later events may update that exact ID.
 */
export function squareSubscriptionAttachmentDecision({
  existingProviderSubscriptionId,
  invoiceOrderId,
  invoiceSubscriptionId,
  matchingIntent,
  planVariationId,
  subscriptionId,
}: {
  existingProviderSubscriptionId?: string | null;
  invoiceOrderId?: string | null;
  invoiceSubscriptionId?: string | null;
  matchingIntent?: SquareInvoicePlanIntent | null;
  planVariationId?: string | null;
  subscriptionId: string;
}): SquareSubscriptionAttachmentDecision {
  const normalizedOrderId = exactSquareInvoiceOrderId(invoiceOrderId);
  const normalizedInvoiceSubscriptionId = exactSquareInvoiceSubscriptionId(invoiceSubscriptionId);
  const invoiceMatchesPaidCheckout = Boolean(
    normalizedOrderId &&
    normalizedInvoiceSubscriptionId === subscriptionId &&
    matchingIntent &&
    matchingIntent.status === "paid_pending_subscription" &&
    matchingIntent.providerOrderId === normalizedOrderId &&
    matchingIntent.providerPaymentId?.trim() &&
    matchingIntent.providerPlanVariationId === planVariationId?.trim() &&
    isPlusPlan(matchingIntent.plan)
  );
  if (existingProviderSubscriptionId === subscriptionId) {
    return invoiceMatchesPaidCheckout ? "update_exact_invoice" : "update_exact";
  }
  if (existingProviderSubscriptionId) {
    return normalizedOrderId || normalizedInvoiceSubscriptionId
      ? "retry_invoice"
      : "ignore_unproven";
  }
  if (!normalizedOrderId && !normalizedInvoiceSubscriptionId) return "ignore_unproven";
  if (
    !normalizedOrderId ||
    normalizedInvoiceSubscriptionId !== subscriptionId ||
    !invoiceMatchesPaidCheckout
  ) {
    return "retry_invoice";
  }
  return "attach_invoice";
}

function isPlusPlan(plan: SubscriptionPlan) {
  return plan === SubscriptionPlan.PLUS_MONTHLY || plan === SubscriptionPlan.PLUS_YEARLY;
}
