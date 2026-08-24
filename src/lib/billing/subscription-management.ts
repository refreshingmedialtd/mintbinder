import {
  BillingCustomerProvenance,
  SubscriptionStatus,
  type Subscription as PrismaSubscription,
} from "@prisma/client";
import { activeBillingProvider } from "@/lib/billing/provider";
import {
  cancelSquareSubscription,
  deleteSquareCustomer,
  retrieveSquareSubscription,
  searchSquareSubscriptions,
  type SquareSubscriptionRecord,
} from "@/lib/billing/square";
import {
  planFromSquarePlanVariationId,
  squareSubscriptionPeriodEnd,
  statusFromSquareForLocalAccess,
} from "@/lib/billing/subscription-mapping";
import { prisma } from "@/lib/db/prisma";
import type { AppSubscription } from "@/lib/types";
import {
  squareCustomerHasUnrelatedActiveAgreements,
  squareSubscriptionNeedsCancellation,
} from "@/lib/billing/subscription-safety";
import { effectivePlusAccessWhere, hasEffectivePlusAccess } from "@/lib/billing/effective-access";
import { selectSquareCancellationTarget } from "@/lib/billing/subscription-selection";
import { reconcileExactSquareSubscriptionTruth } from "@/lib/billing/square-account-reconciliation";

export async function getCurrentBillingSubscription(userId: string): Promise<AppSubscription> {
  const subscription = await preferredSubscriptionForUser(userId);

  return serializeSubscription(subscription);
}

export async function cancelCurrentSquareSubscription(userId: string): Promise<AppSubscription> {
  const provider = activeBillingProvider();

  if (provider !== "square") {
    throw new Error("Square billing is not the active billing provider.");
  }

  const subscriptions = await prisma.subscription.findMany({
    where: { provider: "square", userId },
    orderBy: { updatedAt: "desc" },
  });
  const subscription = selectSquareCancellationTarget(subscriptions);

  if (!subscription?.providerSubscriptionId) {
    throw new Error("No Square subscription found for this account.");
  }

  if (subscription.cancelAtPeriodEnd || subscription.status === SubscriptionStatus.CANCELED) {
    return serializeSubscription(subscription);
  }

  return serializeSubscription(await cancelSquareSubscriptionRecord(subscription));
}

export async function cancelAllSquareSubscriptionsForAccount(userId: string) {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      provider: "square",
      userId,
    },
    orderBy: { updatedAt: "desc" },
  });
  const subscriptionIds = new Set(
    subscriptions
      .map((subscription) => subscription.providerSubscriptionId)
      .filter((value): value is string => Boolean(value)),
  );
  const remoteNeedsCancellationIds = new Set<string>();
  const remoteSubscriptionsById = new Map<string, SquareSubscriptionRecord>();
  const ownedCustomers = await prisma.billingCustomer.findMany({
    where: {
      provider: "square",
      provenance: BillingCustomerProvenance.APP_CREATED,
      userId,
    },
    select: { providerCustomerId: true },
  });
  const customerIds = new Set(ownedCustomers.map((row) => row.providerCustomerId));

  for (const customerId of customerIds) {
    const providerSubscriptions = await searchSquareSubscriptions(customerId);

    for (const subscription of providerSubscriptions) {
      if (!subscription.id || !subscriptionIds.has(subscription.id)) continue;
      remoteSubscriptionsById.set(subscription.id, subscription);
      if (squareSubscriptionNeedsCancellation(subscription)) remoteNeedsCancellationIds.add(subscription.id);
    }
  }

  let cancelled = 0;

  for (const subscriptionId of subscriptionIds) {
    const local = subscriptions.find((subscription) => subscription.providerSubscriptionId === subscriptionId);
    const remote = remoteSubscriptionsById.get(subscriptionId);

    if (remote && !squareSubscriptionNeedsCancellation(remote)) {
      if (local) await persistSquareProviderState(local, remote, false);
      continue;
    }

    if (local && !remoteNeedsCancellationIds.has(subscriptionId) && !remote && (
      local.cancelAtPeriodEnd ||
      local.status === SubscriptionStatus.CANCELED ||
      local.status === SubscriptionStatus.INCOMPLETE_EXPIRED
    )) {
      continue;
    }

    const cancelledSubscription = await cancelSquareSubscription(subscriptionId);
    if (local) await persistSquareProviderState(local, cancelledSubscription, true);
    cancelled += 1;
  }

  return { cancelled, found: subscriptionIds.size };
}

/**
 * Removes only customer profiles that Mint Binder created itself. Hosted
 * checkout may match an existing Square profile; those profiles are retained
 * and only exact subscription IDs recorded by Mint Binder are cancelled.
 */
export async function deleteSquareBillingForAccount(userId: string) {
  const subscriptions = await prisma.subscription.findMany({
    where: { provider: "square", userId },
    orderBy: { updatedAt: "desc" },
  });
  const ownedCustomers = await prisma.billingCustomer.findMany({
    where: {
      provider: "square",
      provenance: BillingCustomerProvenance.APP_CREATED,
      userId,
    },
    select: { providerCustomerId: true },
  });
  const appCreatedCustomerIds = new Set(ownedCustomers.map((row) => row.providerCustomerId));
  const deletedCustomerIds = new Set<string>();

  // Local status is only a cache of provider truth. During deletion, retrieve
  // every exact Square agreement Mint Binder recorded and cancel it when the
  // provider still considers it live. This applies equally to app-created,
  // hosted-matched, and legacy customer profiles.
  const exactReconciliation = await reconcileExactSquareSubscriptionTruth({
    subscriptions,
    retrieve: retrieveSquareSubscription,
    cancel: cancelSquareSubscription,
    persist: async (localId, remote, cancellationRequested) => {
      const local = subscriptions.find((subscription) => subscription.id === localId);
      if (local) await persistSquareProviderState(local, remote, cancellationRequested);
    },
  });

  for (const customerId of appCreatedCustomerIds) {
    const localSubscriptionIds = new Set(
      subscriptions
        .filter((subscription) => subscription.providerCustomerId === customerId)
        .map((subscription) => subscription.providerSubscriptionId)
        .filter((value): value is string => Boolean(value)),
    );
    const remoteSubscriptions = await searchSquareSubscriptions(customerId);
    const hasUnrelatedActiveAgreement = squareCustomerHasUnrelatedActiveAgreements(
      remoteSubscriptions,
      localSubscriptionIds,
    );

    if (hasUnrelatedActiveAgreement) continue;

    await deleteSquareCustomer(customerId);
    deletedCustomerIds.add(customerId);
    await prisma.subscription.updateMany({
      where: { provider: "square", providerCustomerId: customerId, userId },
      data: {
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        providerUpdatedAt: new Date(),
        status: SubscriptionStatus.CANCELED,
      },
    });
  }

  return {
    cancelledExactSubscriptions: exactReconciliation.cancelled,
    checkedExactSubscriptions: exactReconciliation.checked,
    deletedCustomers: deletedCustomerIds.size,
    preservedCustomers: appCreatedCustomerIds.size - deletedCustomerIds.size,
  };
}

export async function deleteSquareCustomerProfilesForAccount(userId: string) {
  const rows = await prisma.billingCustomer.findMany({
    where: {
      provider: "square",
      provenance: BillingCustomerProvenance.APP_CREATED,
      userId,
    },
    select: { providerCustomerId: true },
  });
  const customerIds = new Set(
    rows
      .map((row) => row.providerCustomerId)
      .filter((value): value is string => Boolean(value)),
  );
  const subscriptions = await prisma.subscription.findMany({
    where: { provider: "square", userId },
    select: { providerCustomerId: true, providerSubscriptionId: true },
  });
  let deleted = 0;

  for (const customerId of customerIds) {
    const localSubscriptionIds = new Set(
      subscriptions
        .filter((subscription) => subscription.providerCustomerId === customerId)
        .map((subscription) => subscription.providerSubscriptionId)
        .filter((value): value is string => Boolean(value)),
    );
    const remoteSubscriptions = await searchSquareSubscriptions(customerId);
    const hasUnrelatedActiveAgreement = squareCustomerHasUnrelatedActiveAgreements(
      remoteSubscriptions,
      localSubscriptionIds,
    );
    if (hasUnrelatedActiveAgreement) continue;
    await deleteSquareCustomer(customerId);
    deleted += 1;
  }

  return { deleted, preserved: customerIds.size - deleted };
}

async function cancelSquareSubscriptionRecord(
  subscription: PrismaSubscription,
) {
  if (!subscription.providerSubscriptionId) {
    throw new Error("Square subscription is missing its provider identifier.");
  }

  const squareSubscription = await cancelSquareSubscription(subscription.providerSubscriptionId);
  return persistSquareProviderState(subscription, squareSubscription, true);
}

async function persistSquareProviderState(
  subscription: PrismaSubscription,
  squareSubscription: SquareSubscriptionRecord,
  cancellationRequested: boolean,
) {
  // Cancellation/retrieval is an exact-ID provider-truth operation. An
  // unfamiliar variation must not grant a new plan, but it also must not stop
  // us persisting terminal state for the already recorded subscription.
  const plan = planFromSquarePlanVariationId(squareSubscription.plan_variation_id) ?? subscription.plan;
  const cancelAtPeriodEnd = cancellationRequested || Boolean(squareSubscription.canceled_date);
  const currentPeriodEnd = squareSubscriptionPeriodEnd({
    anchor: subscription.updatedAt,
    chargedThroughDate: squareSubscription.charged_through_date,
    estimateWhenMissing: cancelAtPeriodEnd,
    fallback: subscription.currentPeriodEnd,
    plan,
  });
  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      cancelAtPeriodEnd,
      currentPeriodEnd,
      plan,
      providerUpdatedAt: new Date(),
      status: statusFromSquareForLocalAccess({
        cancelAtPeriodEnd,
        currentPeriodEnd,
        plan,
        status: squareSubscription.status,
      }),
    },
  });

  return updated;
}

async function preferredSubscriptionForUser(userId: string) {
  const now = new Date();
  const activePlus = await prisma.subscription.findFirst({
    where: {
      userId,
      ...effectivePlusAccessWhere(now),
    },
    orderBy: { updatedAt: "desc" },
  });

  return activePlus ?? prisma.subscription.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
}

function serializeSubscription(
  subscription: Awaited<ReturnType<typeof preferredSubscriptionForUser>>,
): AppSubscription {
  if (!subscription) {
    return {
      cancelAtPeriodEnd: false,
      entitlements: {
        "billing.portal": false,
        "exports.insurance_report": false,
        "pricing.alerts": false,
      },
      plan: "free",
    };
  }

  const isPlus = hasEffectivePlusAccess(subscription);

  return {
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString(),
    entitlements: {
      "billing.portal": isPlus,
      "exports.insurance_report": isPlus,
      "pricing.alerts": isPlus,
    },
    plan: isPlus ? "plus" : "free",
    provider: subscription.provider,
    providerSubscriptionId: subscription.providerSubscriptionId ?? undefined,
    status: subscription.status,
  };
}
