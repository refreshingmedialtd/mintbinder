import { normalizeVariantLabel } from "./catalogue/variants.ts";
import type { WishlistItem } from "./types.ts";

export function wishlistMatchesOwnedVariant(
  item: Pick<WishlistItem, "catalogueId" | "variant">,
  catalogueId: string,
  ownedVariant: string,
) {
  if (item.catalogueId !== catalogueId) return false;

  const wantedVariant = item.variant?.trim();

  // Legacy targets without a saved finish represent the whole catalogue item.
  return !wantedVariant || normalizeVariantLabel(wantedVariant) === normalizeVariantLabel(ownedVariant);
}
