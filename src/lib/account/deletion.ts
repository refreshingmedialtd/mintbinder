import type { Prisma } from "@prisma/client";
import { lockBillingCheckout } from "../billing/checkout-lock.ts";

type AccountDeletionTransaction = {
  $executeRaw: Prisma.TransactionClient["$executeRaw"];
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  billingCheckoutIntent: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  collectionItem: {
    deleteMany(args: { where: { userId: string } }): Promise<{ count: number }>;
  };
  sealedProduct: {
    deleteMany(args: {
      where: {
        createdByUserId: string;
        visibility: { in: ["PRIVATE", "PENDING_REVIEW"] };
      };
    }): Promise<{ count: number }>;
    updateMany(args: {
      where: {
        createdByUserId: string;
        visibility: "GLOBAL";
      };
      data: {
        createdByUserId: null;
        notes: null;
      };
    }): Promise<{ count: number }>;
  };
  subscription: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  user: {
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  wishlistItem: {
    deleteMany(args: { where: { userId: string } }): Promise<{ count: number }>;
  };
};

export async function deleteAccountData(
  transaction: AccountDeletionTransaction,
  userId: string,
) {
  // Billing reconciliation always acquires this user-wide lock before touching
  // a checkout or subscription. Taking the same lock before the user-row lock
  // waits for a webhook that was admitted before the deletion fence, then lets
  // the checks below observe its committed provider truth.
  await lockBillingCheckout(transaction, userId);
  const lockedUsers = await transaction.$queryRaw<Array<{
    deletionRequestedAt: Date | null;
    id: string;
  }>>`
    SELECT "id", "deletion_requested_at" AS "deletionRequestedAt"
    FROM "users"
    WHERE "id" = ${userId}::uuid
    FOR UPDATE
  `;

  if (lockedUsers.length !== 1) {
    throw new Error("Account no longer exists or could not be locked for deletion.");
  }
  if (!lockedUsers[0].deletionRequestedAt) {
    throw new Error("Account deletion billing fence is not active.");
  }

  const unresolvedCheckout = await transaction.billingCheckoutIntent.findFirst({
    where: {
      userId,
      OR: [
        {
          status: {
            in: ["creating", "recoverable", "ready", "retiring", "paid_pending_subscription"],
          },
        },
        {
          provider: "square",
          status: "retired",
          OR: [
            { checkoutUrl: { not: null } },
            { providerCheckoutId: { not: null } },
            { providerOrderId: { not: null } },
            { providerPaymentId: { not: null } },
          ],
        },
        {
          provider: "square",
          status: "failed",
          OR: [
            { checkoutUrl: { not: null } },
            { providerCheckoutId: { not: null } },
            { providerCustomerId: { not: null } },
            { providerOrderId: { not: null } },
            { providerPaymentId: { not: null } },
          ],
        },
      ],
    },
    select: { id: true },
  });
  if (unresolvedCheckout) {
    throw new Error("Provider checkout reconciliation is not complete; account data was preserved.");
  }

  const nonterminalExternalSubscription = await transaction.subscription.findFirst({
    where: {
      userId,
      provider: { not: "local" },
      plan: { not: "FREE" },
      status: { notIn: ["CANCELED", "INCOMPLETE_EXPIRED"] },
    },
    select: { id: true },
  });
  if (nonterminalExternalSubscription) {
    throw new Error("Provider subscription reconciliation is not terminal; account data was preserved.");
  }

  // These rows ultimately cascade with the user, but removing them first keeps
  // their sealed-product foreign keys from being SET NULL while the catalogue
  // reference integrity checks are active.
  await transaction.collectionItem.deleteMany({ where: { userId } });
  await transaction.wishlistItem.deleteMany({ where: { userId } });

  // Ownership remains intact while these predicates run. The user-row lock
  // blocks concurrent inserts that reference created_by_user_id until the
  // transaction commits and the user no longer exists.
  const deletedNonGlobalProducts = await transaction.sealedProduct.deleteMany({
    where: {
      createdByUserId: userId,
      visibility: { in: ["PRIVATE", "PENDING_REVIEW"] },
    },
  });
  const anonymizedGlobalProducts = await transaction.sealedProduct.updateMany({
    where: {
      createdByUserId: userId,
      visibility: "GLOBAL",
    },
    data: {
      createdByUserId: null,
      notes: null,
    },
  });

  await transaction.user.delete({ where: { id: userId } });

  return {
    anonymizedGlobalProducts: anonymizedGlobalProducts.count,
    deletedNonGlobalProducts: deletedNonGlobalProducts.count,
  };
}
