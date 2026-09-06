import {
  importedTcgcsvSealedImageState,
  isPermanentSealedImageFailureStatus,
  sealedImageMetadataWithQuarantine,
  sealedImageQuarantine,
  sealedImageUrlIsQuarantined,
  upgradedTcgcsvSealedImageUrl,
} from "./sealed-image-quarantine.mjs";

export {
  importedTcgcsvSealedImageState,
  isPermanentSealedImageFailureStatus,
  sealedImageMetadataWithQuarantine,
  sealedImageQuarantine,
  sealedImageUrlIsQuarantined,
  upgradedTcgcsvSealedImageUrl,
};
export type { SealedImageQuarantine } from "./sealed-image-quarantine.mjs";

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
  metadata?: Record<string, unknown>;
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
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

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

      if (!imageUrl) {
        return null;
      }

      const candidate = candidateById.get(target.id);
      const imageState = importedTcgcsvSealedImageState(candidate?.metadata, imageUrl, candidate?.imageUrl);

      if (imageState.imageUrl !== imageUrl) {
        return null;
      }

      const metadata = sealedImageQuarantine(candidate?.metadata) ? imageState.metadata : undefined;

      return metadata ? { ...target, imageUrl, metadata } : { ...target, imageUrl };
    })
    .filter((item): item is SealedImageRepairPlanItem => Boolean(item));
}

function tcgcsvGroupId(metadata: unknown) {
  return stringValue(objectValue(metadata)?.groupId);
}

function tcgcsvProductId(providerIds: unknown) {
  const source = objectValue(providerIds);

  if (!source) {
    return undefined;
  }

  return stringValue(source.tcgcsv) ?? stringValue(source.tcgplayer);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
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
