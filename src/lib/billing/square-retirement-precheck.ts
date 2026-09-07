const SQUARE_PAYMENT_SEARCH_LOOKBACK_MS = 5 * 60 * 1000;

export type ImmediateSquareRetirementOperations = {
  retrieveOrder(orderId: string): Promise<{
    state?: string | null;
    tenders?: Array<{ id?: string | null }> | null;
  } | null>;
  retrievePaymentLink(paymentLinkId: string): Promise<{ order_id?: string } | null>;
  searchPaymentsByOrder(input: {
    beginTime: Date;
    orderId: string;
  }): Promise<Array<{ id?: string | null; order_id?: string | null; status?: string | null }>>;
};

export type ImmediateSquareRetirementPrecheck =
  | { kind: "completed"; orderId: string }
  | { kind: "deferred"; orderId: string }
  | { kind: "invalid"; message: string };

/**
 * Read-only Square evidence check used by the request path after an intent has
 * moved to `retiring`. It deliberately cannot delete a payment link or mark an
 * intent terminal: only the settlement-aware retirement worker may do that.
 */
export async function inspectImmediateSquareRetirement({
  checkoutCreatedAt,
  providerCheckoutId,
  providerOrderId,
  square,
}: {
  checkoutCreatedAt?: Date;
  providerCheckoutId: string;
  providerOrderId?: string | null;
  square: ImmediateSquareRetirementOperations;
}): Promise<ImmediateSquareRetirementPrecheck> {
  if (!checkoutCreatedAt || Number.isNaN(checkoutCreatedAt.getTime())) {
    return {
      kind: "invalid",
      message: "The Square checkout creation time is missing. Contact support before trying again.",
    };
  }

  const paymentLink = await square.retrievePaymentLink(providerCheckoutId);
  const linkedOrderId = paymentLink?.order_id?.trim();
  const storedOrderId = providerOrderId?.trim();
  if (linkedOrderId && storedOrderId && linkedOrderId !== storedOrderId) {
    return {
      kind: "invalid",
      message: "Square returned a different order for the recorded payment link. Contact support before trying again.",
    };
  }

  const orderId = linkedOrderId || storedOrderId;
  if (!orderId) {
    return {
      kind: "invalid",
      message: "The Square checkout order reference is missing. Contact support before trying again.",
    };
  }

  const beginTime = new Date(
    checkoutCreatedAt.getTime() - SQUARE_PAYMENT_SEARCH_LOOKBACK_MS,
  );
  const [payments, order] = await Promise.all([
    square.searchPaymentsByOrder({ beginTime, orderId }),
    square.retrieveOrder(orderId),
  ]);
  if (!Array.isArray(payments)) {
    return {
      kind: "invalid",
      message: "Square Payments returned an invalid exact-order result. Contact support before trying again.",
    };
  }
  if (order?.tenders != null && !Array.isArray(order.tenders)) {
    return {
      kind: "invalid",
      message: "Square Orders returned invalid tender evidence. Contact support before trying again.",
    };
  }
  const tenders = order?.tenders ?? [];
  const state = normalizeSquareOrderState(order?.state);

  if (payments.length > 0 || tenders.length > 0 || state === "COMPLETED") {
    return { kind: "completed", orderId };
  }
  if (!isKnownNonCompletedSquareOrderState(state)) {
    return {
      kind: "invalid",
      message: "The previous Square checkout order state could not be verified safely. Contact support before trying again.",
    };
  }

  // Whether the link is already gone or still open, the HTTP request stops
  // here. The worker owns DELETE plus both settlement evidence passes.
  return { kind: "deferred", orderId };
}

function normalizeSquareOrderState(state?: string | null) {
  return state?.trim().toUpperCase() ?? "";
}

function isKnownNonCompletedSquareOrderState(state: string) {
  return state === "CANCELED" || state === "DRAFT" || state === "OPEN";
}
