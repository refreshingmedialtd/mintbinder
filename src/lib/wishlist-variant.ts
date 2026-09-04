import {
  catalogueVariantSelectionLabel,
  normalizeVariantLabel,
} from "./catalogue/variants.ts";
import type { CatalogueItem, WishlistItem } from "./types.ts";

export function wishlistMatchesOwnedVariant(
  item: Pick<WishlistItem, "catalogueId" | "variant">,
  catalogueId: string,
  ownedVariant: string,
  catalogueItem?: CatalogueItem,
) {
  if (item.catalogueId !== catalogueId) return false;

  const wantedVariant = wishlistVariantSelectionLabel(item, catalogueItem);
  const resolvedOwnedVariant = catalogueItem
    ? catalogueVariantSelectionLabel(catalogueItem, ownedVariant)
    : ownedVariant;

  // Legacy targets without a saved finish represent the whole catalogue item.
  return !wantedVariant || normalizeVariantLabel(wantedVariant) === normalizeVariantLabel(resolvedOwnedVariant);
}

export function wishlistVariantSelectionLabel(
  item: Pick<WishlistItem, "variant">,
  catalogueItem?: CatalogueItem,
) {
  const variant = item.variant?.trim();

  if (!variant || !catalogueItem) {
    return variant;
  }

  return catalogueVariantSelectionLabel(catalogueItem, variant);
}
