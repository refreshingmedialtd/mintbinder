import { squareSubscriptionNeedsCancellation } from "./subscription-safety.ts";

export type ExactSquareSubscription = {
  id: string;
  providerSubscriptionId: string | null;
};

export async function reconcileExactSquareSubscriptionTruth<T>({
  cancel,
  persist,
  retrieve,
  subscriptions,
}: {
  cancel: (subscriptionId: string) => Promise<T>;
  persist: (localId: string, remote: T, cancellationRequested: boolean) => Promise<unknown>;
  retrieve: (subscriptionId: string) => Promise<T | null>;
  subscriptions: readonly ExactSquareSubscription[];
}) {
  const seen = new Set<string>();
  let cancelled = 0;
  let checked = 0;

  for (const local of subscriptions) {
    const subscriptionId = local.providerSubscriptionId?.trim();
    if (!subscriptionId || seen.has(subscriptionId)) continue;
    seen.add(subscriptionId);
    checked += 1;

    const current = await retrieve(subscriptionId);
    if (!current) continue;
    const cancellationRequired = squareSubscriptionNeedsCancellation(current);
    const providerTruth = cancellationRequired ? await cancel(subscriptionId) : current;
    if (cancellationRequired) cancelled += 1;
    await persist(local.id, providerTruth, cancellationRequired);
  }

  return { cancelled, checked };
}
