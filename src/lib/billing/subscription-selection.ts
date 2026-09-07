import { SubscriptionStatus, type Subscription } from "@prisma/client";
import { hasEffectivePlusAccess } from "./effective-access.ts";

type SubscriptionCandidate = Pick<
  Subscription,
  | "cancelAtPeriodEnd"
  | "currentPeriodEnd"
  | "plan"
  | "providerSubscriptionId"
  | "status"
>;

/** Candidates must be ordered newest first. */
export function selectSquarePaymentActivationTarget<T extends SubscriptionCandidate>(
  candidates: readonly T[],
) {
  // A Square customer may own several historical subscriptions. A payment
  // proves the checkout order, not which remote subscription Square created,
  // so it may activate only the customer placeholder with no exact provider
  // subscription ID. invoice.payment_made attaches that exact ID later.
  return candidates.find((candidate) => !candidate.providerSubscriptionId) ?? null;
}

export function selectSquareTerminalCustomerRowsToDetach<T extends SubscriptionCandidate & { id: string }>(
  candidates: readonly T[],
) {
  return candidates.filter((candidate) =>
    Boolean(candidate.providerSubscriptionId) &&
    (
      candidate.status === SubscriptionStatus.CANCELED ||
      candidate.status === SubscriptionStatus.INCOMPLETE_EXPIRED
    ));
}

/** Candidates must be ordered newest first. */
export function selectSquareCancellationTarget<T extends SubscriptionCandidate>(
  candidates: readonly T[],
  now = new Date(),
) {
  const effective = candidates.filter((candidate) => hasEffectivePlusAccess(candidate, now));
  return effective.find((candidate) => Boolean(candidate.providerSubscriptionId))
    ?? effective[0]
    ?? candidates.find((candidate) => Boolean(candidate.providerSubscriptionId))
    ?? candidates[0]
    ?? null;
}
