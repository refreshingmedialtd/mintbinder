export type SealedImageRepairCandidate = {
  id: string;
  imageUrl?: string | null;
  metadata: unknown;
  providerIds: unknown;
};

export type TcgcsvProductImage = {
  groupId: number | string;
  imageUrl?: string | null;
  productId: number | string;
};

export type SealedImageRepairTarget = {
  groupId: string;
  id: string;
  productId: string;
};

export type SealedImageRepairPlanItem = SealedImageRepairTarget & {
  imageUrl: string;
};

export function sealedImageRepairTargets(products: SealedImageRepairCandidate[]): SealedImageRepairTarget[] {
  return products
    .filter((product) => !hasImageUrl(product.imageUrl))
    .map((product) => {
      const groupId = tcgcsvGroupId(product.metadata);
      const productId = tcgcsvProductId(product.providerIds);

      return groupId && productId
        ? {
          groupId,
          id: product.id,
          productId,
        }
        : null;
    })
    .filter((target): target is SealedImageRepairTarget => Boolean(target));
}

export function buildSealedImageRepairPlan(
  candidates: SealedImageRepairCandidate[],
  products: TcgcsvProductImage[],
): SealedImageRepairPlanItem[] {
  const imageByProduct = new Map<string, string>();

  for (const product of products) {
    const groupId = stringValue(product.groupId);
    const productId = stringValue(product.productId);
    const imageUrl = upgradedTcgcsvSealedImageUrl(product.imageUrl);

    if (groupId && productId && imageUrl) {
      imageByProduct.set(targetKey(groupId, productId), imageUrl);
    }
  }

  return sealedImageRepairTargets(candidates)
    .map((target) => {
      const imageUrl = imageByProduct.get(targetKey(target.groupId, target.productId));

      return imageUrl ? { ...target, imageUrl } : null;
    })
    .filter((item): item is SealedImageRepairPlanItem => Boolean(item));
}

export function upgradedTcgcsvSealedImageUrl(value: unknown) {
  const imageUrl = typeof value === "string" ? value.trim() : "";

  return imageUrl ? imageUrl.replace("_200w.", "_in_1000x1000.") : undefined;
}

function tcgcsvGroupId(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }

  return stringValue((metadata as Record<string, unknown>).groupId);
}

function tcgcsvProductId(providerIds: unknown) {
  if (!providerIds || typeof providerIds !== "object" || Array.isArray(providerIds)) {
    return undefined;
  }

  const source = providerIds as Record<string, unknown>;

  return stringValue(source.tcgcsv) ?? stringValue(source.tcgplayer);
}

function stringValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed || undefined;
}

function hasImageUrl(value?: string | null) {
  return Boolean(value?.trim());
}

function targetKey(groupId: string, productId: string) {
  return `${groupId}:${productId}`;
}
