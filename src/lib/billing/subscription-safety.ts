export function squareSubscriptionNeedsCancellation(subscription: {
  canceled_date?: string | null;
  status?: string | null;
}) {
  const status = subscription.status?.trim().toUpperCase();

  return !subscription.canceled_date &&
    status !== "CANCELED" &&
    status !== "COMPLETED" &&
    status !== "DEACTIVATED";
}

export function squareSubscriptionBlocksCheckout(subscription: {
  status?: string | null;
}) {
  const status = subscription.status?.trim().toUpperCase();

  return status !== "CANCELED" &&
    status !== "COMPLETED" &&
    status !== "DEACTIVATED";
}

export function squareCustomerHasUnrelatedActiveAgreements(
  subscriptions: Array<{ canceled_date?: string | null; id?: string | null; status?: string | null }>,
  mintBinderSubscriptionIds: ReadonlySet<string>,
) {
  return subscriptions.some((subscription) =>
    squareSubscriptionNeedsCancellation(subscription) &&
    (!subscription.id || !mintBinderSubscriptionIds.has(subscription.id)));
}
