import { SubscriptionStatus, type Subscription, type SubscriptionPlan } from "@prisma/client";
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
  plan: SubscriptionPlan,
  now = new Date(),
) {
  const effectiveForPlan = candidates.filter((candidate) =>
    candidate.plan === plan && hasEffectivePlusAccess(candidate, now));

  return effectiveForPlan.find((candidate) => Boolean(candidate.providerSubscriptionId))
    ?? effectiveForPlan[0]
    ?? candidates.find((candidate) => !candidate.providerSubscriptionId)
    ?? null;
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
