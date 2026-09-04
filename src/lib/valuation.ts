import {
  catalogueVariantSelectionLabel,
  catalogueValueMinorForVariant,
  priceHistoryForCatalogueVariant,
} from "./catalogue/variants.ts";
import { preferredLatestPricePoint } from "./pricing/market-context.ts";
import type { CatalogueItem, CollectionItem, PricePoint } from "./types.ts";

export type CollectionGradeIdentity = {
  company: string;
  score: number;
};

export type CollectionItemValuation = {
  conditionMultiplier: number;
  kind: "manual" | "market" | "unvalued";
  pricePoint?: PricePoint;
  reason?: "catalogue-missing" | "exact-price-missing";
  unitValueMinor?: number;
  valueMinor?: number;
};

/** Returns the catalogue-supported finish used for valuation and evidence exports. */
export function effectiveCollectionVariant(
  item: Pick<CollectionItem, "variant"> & Partial<Pick<CollectionItem, "grade">>,
  catalogueItem?: CatalogueItem,
) {
  if (!catalogueItem) {
    return item.variant;
  }

  const grade = item.grade === undefined
    ? undefined
    : collectionGradeIdentity({ grade: item.grade });

  // An incomplete custom grade has no safe market identity. Preserve its
  // explicit finish; valuation will continue to fail closed below.
  if (grade === null) {
    return item.variant;
  }

  return catalogueVariantSelectionLabel(
    catalogueItem,
    item.variant,
    grade ? { gradedCompany: grade.company, gradedScore: grade.score } : undefined,
  );
}

/**
 * The single collection condition policy. Manual values are total-lot values,
 * sealed items and slabs are never condition-adjusted, and raw-card estimates
 * are adjusted per copy before quantity is applied.
 */
export function collectionConditionMultiplier(
  condition: string,
  itemType?: CatalogueItem["type"],
  graded = false,
) {
  if (itemType === "sealed" || graded) {
    return 1;
  }

  const normalized = condition.trim().toLowerCase();
  const multipliers: Record<string, number> = {
    mint: 1.05,
    "near mint": 1,
    "near mint / mint": 1,
    excellent: 0.85,
    "light played": 0.7,
    "lightly played": 0.7,
    played: 0.55,
    poor: 0.35,
    sealed: 1,
    unknown: 1,
  };

  return multipliers[normalized] ?? 1;
}

export function collectionGradeIdentity(item: Pick<CollectionItem, "grade">) {
  const grade = item.grade.trim();

  if (!grade || /^(?:raw|n\/a)$/i.test(grade)) {
    return undefined;
  }

  const match = grade.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);

  if (!match) {
    return null;
  }

  const score = Number(match[2]);
  const company = normalizeGradeCompany(match[1]);

  return company && Number.isFinite(score) ? { company, score } : null;
}

/** Returns only the exact raw/grade and variant stream for an owned lot. */
export function collectionItemPriceHistory(
  item: CollectionItem,
  catalogueItem?: CatalogueItem,
) {
  if (!catalogueItem) {
    return [];
  }

  const grade = catalogueItem.type === "card" ? collectionGradeIdentity(item) : undefined;

  if (grade === null) {
    return [];
  }

  const identityHistory = (catalogueItem.priceHistory ?? []).filter((point) => {
    if (!grade) {
      return !point.gradedCompany;
    }

    return normalizeGradeCompany(point.gradedCompany) === grade.company &&
      normalizeGradeScore(point.gradedScore) === grade.score;
  });

  return priceHistoryForCatalogueVariant(
    catalogueItem,
    identityHistory,
    effectiveCollectionVariant(item, catalogueItem),
  );
}

export function collectionItemMarketPricePoint(
  item: CollectionItem,
  catalogueItem?: CatalogueItem,
) {
  return preferredLatestPricePoint(collectionItemPriceHistory(item, catalogueItem));
}

export function collectionItemValuation(
  item: CollectionItem,
  catalogueItem?: CatalogueItem,
): CollectionItemValuation {
  if (item.overrideValueMinor !== undefined) {
    return {
      conditionMultiplier: 1,
      kind: "manual",
      valueMinor: item.overrideValueMinor,
    };
  }

  if (!catalogueItem) {
    return {
      conditionMultiplier: 1,
      kind: "unvalued",
      reason: "catalogue-missing",
    };
  }

  const grade = catalogueItem.type === "card" ? collectionGradeIdentity(item) : undefined;
  const pricePoint = collectionItemMarketPricePoint(item, catalogueItem);
  const unitValueMinor = pricePoint?.valueMinor ?? (
    grade === undefined
      ? catalogueValueMinorForVariant(catalogueItem, item.variant)
      : undefined
  );

  if (unitValueMinor === undefined) {
    return {
      conditionMultiplier: collectionConditionMultiplier(
        item.condition,
        catalogueItem.type,
        Boolean(grade),
      ),
      kind: "unvalued",
      reason: "exact-price-missing",
    };
  }

  const conditionMultiplier = collectionConditionMultiplier(
    item.condition,
    catalogueItem.type,
    Boolean(grade),
  );
  const quantity = normalizedQuantity(item.quantity);

  return {
    conditionMultiplier,
    kind: "market",
    pricePoint,
    unitValueMinor,
    valueMinor: Math.round(unitValueMinor * conditionMultiplier) * quantity,
  };
}

export function collectionItemValueMinor(
  item: CollectionItem,
  catalogueItem?: CatalogueItem,
) {
  return collectionItemValuation(item, catalogueItem).valueMinor;
}

function normalizeGradeCompany(value?: string | null) {
  const normalized = String(value ?? "").trim().toUpperCase();
  const aliases: Record<string, string> = {
    OTHER: "OTHER",
  };

  return aliases[normalized] ?? normalized;
}

function normalizeGradeScore(value?: number | null) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const score = Number(value);

  return Number.isFinite(score) ? score : undefined;
}

function normalizedQuantity(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
