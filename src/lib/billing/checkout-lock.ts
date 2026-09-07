import { Prisma, SubscriptionPlan, SubscriptionStatus } from "@prisma/client";

type BillingLockClient = Pick<Prisma.TransactionClient, "$executeRaw" | "billingCheckoutIntent" | "user">;
type BillingAgreementLockClient = Pick<Prisma.TransactionClient, "$executeRaw" | "subscription">;

export class BillingAccountDeletionError extends Error {
  constructor(message = "Billing is unavailable while account deletion is in progress.") {
    super(message);
    this.name = "BillingAccountDeletionError";
  }
}

export class BillingExternalAgreementConflictError extends Error {
  constructor(incomingProvider: string, existingProvider: string) {
    super(
      `A second ${incomingProvider} paid agreement was received after an existing ${existingProvider} ` +
      "agreement had already won for this account. Mint Binder did not change Plus access. " +
      "Cancel and refund the later provider agreement manually, then retry reconciliation.",
    );
    this.name = "BillingExternalAgreementConflictError";
  }
}

/**
 * Serializes checkout/customer ownership transitions with the account-deletion
 * fence. The lock is transaction-scoped, so callers must keep all related
 * database changes inside the same transaction.
 */
export function lockBillingCheckout(
  transaction: Pick<Prisma.TransactionClient, "$executeRaw">,
  userId: string,
) {
  return transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`mintbinder-billing:${userId}`}))
  `;
}

export async function assertBillingAccountAvailable(
  transaction: BillingLockClient,
  userId: string,
  provider: string,
  options: { allowDuringDeletion?: boolean } = {},
) {
  await lockBillingCheckout(transaction, userId);
  const user = await transaction.user.findUnique({
    where: { id: userId },
    select: { deletionRequestedAt: true },
  });

  if (!user) {
    throw new BillingAccountDeletionError();
  }

  if (user.deletionRequestedAt) {
    if (!options.allowDuringDeletion) throw new BillingAccountDeletionError();

    // Provider-truth reconciliation remains possible only while a checkout
    // that predated the fence is visibly unresolved. Once that attempt is
    // terminal, account deletion owns the billing state and late webhooks may
    // not recreate customer/subscription rows behind it.
    const unresolvedCheckout = await transaction.billingCheckoutIntent.findFirst({
      where: {
        provider,
        status: {
          in: ["creating", "recoverable", "ready", "retiring", "paid_pending_subscription"],
        },
        userId,
      },
      select: { id: true },
    });
    if (!unresolvedCheckout) throw new BillingAccountDeletionError();
  }
}

/**
 * Enforces the one-external-paid-agreement invariant while holding the same
 * user-wide advisory lock as checkout creation and provider reconciliation.
 * A provider webhook represents money already taken, so a losing agreement is
 * deliberately left untouched and failed for operator-led cancellation/refund.
 */
export async function assertNoConflictingExternalPaidAgreement(
  transaction: BillingAgreementLockClient,
  {
    allowedSubscriptionIds = [],
    incomingProvider,
    now = new Date(),
    userId,
  }: {
    allowedSubscriptionIds?: readonly string[];
    incomingProvider: string;
    now?: Date;
    userId: string;
  },
) {
  await lockBillingCheckout(transaction, userId);
  const allowedIds = [...new Set(allowedSubscriptionIds.map((id) => id.trim()).filter(Boolean))];
  const candidates = await transaction.subscription.findMany({
    where: {
      userId,
      ...(allowedIds.length ? { id: { notIn: allowedIds } } : {}),
    },
    select: {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: true,
      plan: true,
      provider: true,
      providerSubscriptionId: true,
      status: true,
    },
  });
  const conflicting = candidates.find((candidate) =>
    externalPaidAgreementBlocksReconciliation(candidate, now));

  if (conflicting) {
    throw new BillingExternalAgreementConflictError(incomingProvider, conflicting.provider);
  }
}

export function externalPaidAgreementBlocksReconciliation(
  subscription: {
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date | null;
    plan: SubscriptionPlan;
    provider: string;
    providerSubscriptionId: string | null;
    status: SubscriptionStatus;
  },
  now = new Date(),
) {
  if (
    subscription.provider === "local" ||
    subscription.plan === SubscriptionPlan.FREE ||
    subscription.status === SubscriptionStatus.CANCELED ||
    subscription.status === SubscriptionStatus.INCOMPLETE_EXPIRED
  ) {
    return false;
  }

  if (
    subscription.providerSubscriptionId
  ) {
    // Local access expiry and a scheduled cancellation are not provider proof
    // that an external agreement is over. Its exact provider ID remains a
    // replacement-checkout blocker until terminal provider truth is stored.
    return true;
  }

  return (
    subscription.status === SubscriptionStatus.ACTIVE ||
    subscription.status === SubscriptionStatus.TRIALING
  ) && (
    !subscription.cancelAtPeriodEnd ||
    !subscription.currentPeriodEnd ||
    subscription.currentPeriodEnd > now
  );
}

export function externalPaidAgreementBlocksCheckoutWhere(
  now = new Date(),
): Prisma.SubscriptionWhereInput {
  return {
    provider: { not: "local" },
    plan: { not: SubscriptionPlan.FREE },
    OR: [
      {
        status: {
          notIn: [SubscriptionStatus.CANCELED, SubscriptionStatus.INCOMPLETE_EXPIRED],
        },
        providerSubscriptionId: { not: null },
      },
      {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        OR: [
          { cancelAtPeriodEnd: false },
          { currentPeriodEnd: null },
          { currentPeriodEnd: { gt: now } },
        ],
      },
    ],
  };
}
