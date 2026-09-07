import {
  type Prisma,
  type Subscription,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from "@prisma/client";
import {
  assertNoConflictingExternalPaidAgreement,
  externalPaidAgreementBlocksReconciliation,
  lockBillingCheckout,
} from "./checkout-lock.ts";

type ProviderSubscriptionTransactionClient = Pick<
  Prisma.TransactionClient,
  "$executeRaw" | "subscription"
>;

/**
 * Applies provider subscription truth under the user-wide billing lock. The
 * injected seams keep both completion orders executable in unit tests without
 * weakening the production transaction boundary.
 */
export async function reconcileProviderSubscriptionTransaction({
  cancelAtPeriodEnd = false,
  claimCustomerOwnership,
  currentPeriodEnd,
  customerId,
  findExistingSubscription,
  now = new Date(),
  plan,
  provider,
  providerUpdatedAt,
  status,
  subscriptionId,
  transaction,
  userId,
}: {
  cancelAtPeriodEnd?: boolean;
  claimCustomerOwnership: (input: { customerId: string; userId: string }) => Promise<unknown>;
  currentPeriodEnd?: Date;
  customerId: string;
  findExistingSubscription: () => Promise<Subscription | null>;
  now?: Date;
  plan: SubscriptionPlan;
  provider: string;
  providerUpdatedAt?: Date;
  status: SubscriptionStatus;
  subscriptionId: string;
  transaction: ProviderSubscriptionTransactionClient;
  userId: string;
}) {
  await lockBillingCheckout(transaction, userId);
  const existing = await findExistingSubscription();
  const effectiveProviderUpdatedAt = providerUpdatedAt ?? now;

  // Do not turn a harmless stale ACTIVE delivery into a false second-payment
  // incident after a newer cancellation or terminal provider update won.
  if (
    existing?.providerSubscriptionId === subscriptionId &&
    existing?.providerUpdatedAt &&
    existing.providerUpdatedAt.getTime() >= effectiveProviderUpdatedAt.getTime()
  ) {
    return false;
  }

  await claimCustomerOwnership({ customerId, userId });
  const incomingCreatesNonterminalExternalAgreement =
    existing?.providerSubscriptionId !== subscriptionId &&
    externalPaidAgreementBlocksReconciliation({
      cancelAtPeriodEnd,
      currentPeriodEnd: currentPeriodEnd ?? null,
      plan,
      provider,
      providerSubscriptionId: subscriptionId,
      status,
    }, now);
  if (incomingCreatesNonterminalExternalAgreement) {
    await assertNoConflictingExternalPaidAgreement(transaction, {
      allowedSubscriptionIds: existing ? [existing.id] : [],
      incomingProvider: provider,
      now,
      userId,
    });
  }

  const customerHolder = await transaction.subscription.findUnique({
    where: { providerCustomerId: customerId },
    select: { id: true },
  });
  const data = {
    cancelAtPeriodEnd,
    currentPeriodEnd,
    plan,
    provider,
    // Historical exact subscriptions may receive late terminal events after
    // a newer subscription has become the one local row holding the
    // customer's rollback-compatible unique providerCustomerId. Keep the
    // exact ID state update without stealing that live customer's slot.
    providerCustomerId: customerHolder && customerHolder.id !== existing?.id ? null : customerId,
    providerSubscriptionId: subscriptionId,
    providerUpdatedAt: effectiveProviderUpdatedAt,
    status,
  };

  if (existing) {
    const updated = await transaction.subscription.updateMany({
      where: existing.providerSubscriptionId === subscriptionId
        ? {
            id: existing.id,
            OR: [
              { providerUpdatedAt: null },
              { providerUpdatedAt: { lt: effectiveProviderUpdatedAt } },
            ],
          }
        : {
            id: existing.id,
            providerSubscriptionId: null,
          },
      data,
    });
    return updated.count > 0;
  }

  if (customerHolder) {
    throw reconciliationError(
      "Provider customer is already linked to a different subscription and no checkout placeholder matched.",
    );
  }

  await transaction.subscription.create({
    data: {
      ...data,
      userId,
    },
  });
  return true;
}

function reconciliationError(message: string) {
  const error = new Error(message);
  error.name = "BillingWebhookReconciliationError";
  return error;
}
