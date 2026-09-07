export function checkoutPreparationCanBeReclaimed({
  leaseMs,
  now,
  status,
  updatedAt,
}: {
  leaseMs: number;
  now: Date;
  status: string;
  updatedAt: Date;
}) {
  return status === "recoverable" ||
    (status === "creating" && updatedAt.getTime() <= now.getTime() - leaseMs);
}

export function squareMissingCheckoutMustRemainWorkerOwned({
  checkoutUrl,
  providerCheckoutId,
  providerOrderId,
  providerPaymentId,
  status,
}: {
  checkoutUrl: string | null;
  providerCheckoutId: string | null;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  status: string;
}) {
  if (providerCheckoutId) return false;
  if (providerPaymentId || status === "paid_pending_subscription") return true;
  return status === "retiring" && checkoutUrl === null && Boolean(providerOrderId?.trim());
}

export function checkoutIntentMustAwaitProviderReconciliation({
  providerPaymentId,
  status,
}: {
  providerPaymentId: string | null;
  status: string;
}) {
  return status === "paid_pending_subscription" || Boolean(providerPaymentId?.trim());
}
