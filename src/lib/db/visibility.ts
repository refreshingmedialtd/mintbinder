import { CatalogueVisibility, type Prisma } from "@prisma/client";

export function visibleSealedProductWhere(
  userId: string,
  id: string,
): Prisma.SealedProductWhereInput {
  return {
    id,
    ...sealedProductVisibilityWhere(userId),
  };
}

export function visibleSealedProductsWhere(
  userId: string,
  ids?: string[],
): Prisma.SealedProductWhereInput {
  return {
    id: ids === undefined ? undefined : { in: ids },
    ...sealedProductVisibilityWhere(userId),
  };
}

function sealedProductVisibilityWhere(userId: string): Prisma.SealedProductWhereInput {
  return {
    OR: [
      { visibility: CatalogueVisibility.GLOBAL },
      { createdByUserId: userId },
    ],
  };
}
