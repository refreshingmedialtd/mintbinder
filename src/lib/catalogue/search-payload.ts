import type { CatalogueItem } from "../types.ts";
import { preferredLatestPricePoint } from "../pricing/market-context.ts";
import { normalizeVariantLabel } from "./variants.ts";

export function compactCatalogueSearchHistory(item: CatalogueItem): CatalogueItem {
  const history = item.priceHistory;

  if (!history || history.length <= 1) {
    return item;
  }

  const selected = new Set<(typeof history)[number]>();
  const byVariant = new Map<string, typeof history>();
  const preferred = preferredLatestPricePoint(history);

  if (preferred) {
    selected.add(preferred);
  }

  for (const point of history) {
    const key = normalizeVariantLabel(point.variantLabel);
    const points = byVariant.get(key) ?? [];

    points.push(point);
    byVariant.set(key, points);
  }

  for (const points of byVariant.values()) {
    const latest = preferredLatestPricePoint(points);

    if (latest) {
      selected.add(latest);
    }
  }

  return {
    ...item,
    priceHistory: [...selected].sort(
      (left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt),
    ),
  };
}
