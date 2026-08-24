import type { CatalogueItem } from "../types.ts";

export function sortCatalogueSearchResults(items: CatalogueItem[], sort: string) {
  return [...items].sort((left, right) => {
    if (sort === "value-asc") {
      return compareCatalogueValues(left, right, "asc") || compareCatalogueNames(left, right);
    }

    if (sort === "name-asc") {
      return compareCatalogueNames(left, right);
    }

    if (sort === "name-desc") {
      return compareCatalogueNames(right, left);
    }

    if (sort === "set-number-asc") {
      return compareCatalogueSetNumbers(left, right);
    }

    if (sort === "set-number-desc") {
      return compareCatalogueSetNumbers(right, left);
    }

    if (sort === "rarity") {
      return left.rarity.localeCompare(right.rarity) || compareCatalogueNames(left, right);
    }

    return compareCatalogueValues(right, left, "desc") || compareCatalogueNames(left, right);
  });
}

function compareCatalogueValues(
  left: CatalogueItem,
  right: CatalogueItem,
  direction: "asc" | "desc",
) {
  const leftValue = left.hasPrice ? left.valueMinor : null;
  const rightValue = right.hasPrice ? right.valueMinor : null;

  if (leftValue === null && rightValue === null) {
    return 0;
  }

  if (leftValue === null) {
    return direction === "asc" ? 1 : -1;
  }

  if (rightValue === null) {
    return direction === "asc" ? -1 : 1;
  }

  return leftValue - rightValue;
}

function compareCatalogueNames(left: CatalogueItem, right: CatalogueItem) {
  return left.name.localeCompare(right.name, undefined, { numeric: true }) ||
    left.id.localeCompare(right.id);
}

function compareCatalogueSetNumbers(left: CatalogueItem, right: CatalogueItem) {
  return `${left.set} ${left.number}`.localeCompare(`${right.set} ${right.number}`, undefined, {
    numeric: true,
  }) || compareCatalogueNames(left, right);
}
