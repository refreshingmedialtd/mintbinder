import { Prisma } from "@prisma/client";

type BillingLockClient = Pick<Prisma.TransactionClient, "$executeRaw" | "billingCheckoutIntent" | "user">;

export class BillingAccountDeletionError extends Error {
  constructor(message = "Billing is unavailable while account deletion is in progress.") {
    super(message);
    this.name = "BillingAccountDeletionError";
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
  provider: string,
) {
  return transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`mintbinder-checkout:${userId}:${provider}`}))
  `;
}

export async function assertBillingAccountAvailable(
  transaction: BillingLockClient,
  userId: string,
  provider: string,
  options: { allowDuringDeletion?: boolean } = {},
) {
  await lockBillingCheckout(transaction, userId, provider);
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
