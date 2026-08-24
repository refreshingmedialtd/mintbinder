export type CheckoutCompletionRow = {
  checkoutUrl: string | null;
  deletionRequestedAt?: Date | null;
  leaseToken: string;
  providerCheckoutId: string | null;
  providerOrderId: string | null;
  status: string;
};

export type CheckoutCompletionInput = {
  leaseToken: string;
  providerCheckoutId: string;
  providerOrderId?: string | null;
  url: string;
};

export type CheckoutCompletionDecision =
  | { kind: "publish"; url: string }
  | { kind: "reuse"; url: string }
  | { kind: "retire" }
  | { kind: "reconciled" }
  | { kind: "superseded" }
  | { kind: "ambiguous" };

/**
 * Decides ownership of a provider result without making the losing request
 * destroy an idempotently shared checkout object. The database caller applies
 * this decision while holding both the checkout advisory lock and row lock.
 */
export function decideCheckoutCompletion(
  row: CheckoutCompletionRow,
  input: CheckoutCompletionInput,
): CheckoutCompletionDecision {
  if (row.status === "ready") {
    return providerReferencesMatch(row, input) && row.checkoutUrl
      ? { kind: "reuse", url: row.checkoutUrl }
      : { kind: "ambiguous" };
  }

  if (row.status === "paid_pending_subscription" || row.status === "completed") {
    return { kind: "reconciled" };
  }

  if (row.status === "retiring" || row.status === "retired" || row.status === "failed") {
    return providerReferencesCompatible(row, input)
      ? { kind: "retire" }
      : { kind: "ambiguous" };
  }

  if (row.status !== "creating") return { kind: "ambiguous" };
  if (!providerReferencesCompatible(row, input)) return { kind: "ambiguous" };
  if (row.leaseToken !== input.leaseToken) return { kind: "superseded" };
  if (row.deletionRequestedAt) return { kind: "retire" };
  return { kind: "publish", url: input.url };
}

function providerReferencesMatch(row: CheckoutCompletionRow, input: CheckoutCompletionInput) {
  return row.providerCheckoutId === input.providerCheckoutId && providerOrderIdsCompatible(row, input);
}

function providerReferencesCompatible(row: CheckoutCompletionRow, input: CheckoutCompletionInput) {
  return (!row.providerCheckoutId || row.providerCheckoutId === input.providerCheckoutId) &&
    providerOrderIdsCompatible(row, input);
}

function providerOrderIdsCompatible(row: CheckoutCompletionRow, input: CheckoutCompletionInput) {
  const inputOrderId = input.providerOrderId?.trim() || null;
  return !row.providerOrderId || !inputOrderId || row.providerOrderId === inputOrderId;
}
