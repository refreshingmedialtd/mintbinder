import type { CatalogueItem, CatalogueVariantOption } from "../types";

export type CatalogueVariantPriceRow = CatalogueVariantOption;

/**
 * Returns display rows without assigning an item's generic headline value to a
 * specific finish. A generic estimate is only safe when no variant catalogue
 * exists at all.
 */
export function catalogueVariantPriceRows(item: CatalogueItem): CatalogueVariantPriceRow[] {
  if (item.variantOptions?.length) {
    return item.variantOptions.map((option) => ({ ...option }));
  }

  return [{
    confidence: item.hasPrice ? item.confidence : undefined,
    label: item.type === "sealed" ? "Factory sealed" : "Market estimate",
    observedAt: item.hasPrice ? item.priceObservedAt : undefined,
    source: item.hasPrice ? item.priceSource : undefined,
    valueMinor: item.hasPrice ? item.valueMinor : undefined,
  }];
}
