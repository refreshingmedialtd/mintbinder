type AccountDeletionTransaction = {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
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
  const lockedUsers = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "users"
    WHERE "id" = ${userId}::uuid
    FOR UPDATE
  `;

  if (lockedUsers.length !== 1) {
    throw new Error("Account no longer exists or could not be locked for deletion.");
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
