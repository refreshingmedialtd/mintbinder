import type {
  CatalogueItem,
  CollectionEvent,
  CollectionItem,
  SetProgress,
  StorageLocation,
  WishlistItem,
} from "./types";

export type HoldingInsight = {
  id: string;
  catalogueId: string;
  name: string;
  set: string;
  quantity: number;
  valueMinor: number;
  gainMinor: number | null;
  confidence: CatalogueItem["confidence"];
};

export type DuplicateInsight = {
  catalogueId: string;
  name: string;
  lots: number;
  quantity: number;
  valueMinor: number;
};

export type WishlistOpportunity = {
  id: string;
  name: string;
  currentValueMinor: number;
  targetPriceMinor: number;
  savingMinor: number;
};

export type InsightAction = {
  id: string;
  category: "Wishlist" | "Valuation" | "Grading" | "Storage" | "Duplicates" | "Momentum";
  title: string;
  detail: string;
  tone: "good" | "watch" | "action";
  impact: "High" | "Medium" | "Low";
  actionLabel: string;
};

export type CollectionIntelligence = {
  healthScore: number;
  healthLabel: string;
  valueTrend: number[];
  topHoldings: HoldingInsight[];
  bestPerformer?: HoldingInsight;
  gradingCandidates: HoldingInsight[];
  duplicates: DuplicateInsight[];
  wishlistOpportunities: WishlistOpportunity[];
  weakConfidence: {
    count: number;
    valueMinor: number;
  };
  storageConcentration?: {
    name: string;
    share: number;
    valueMinor: number;
    totalQuantity: number;
  };
  setFocus?: {
    id: string;
    name: string;
    owned: number;
    total: number;
    percent: number;
    remaining: number;
  };
  activity: {
    last30Days: number;
    added: number;
    edited: number;
    removed: number;
    sold: number;
  };
  portfolioMix: Array<{
    label: string;
    valueMinor: number;
    share: number;
  }>;
  actionQueue: InsightAction[];
};

export function buildCollectionIntelligence({
  catalogueById,
  collection,
  events,
  sets,
  storageLocations,
  wishlist,
}: {
  catalogueById: Map<string, CatalogueItem>;
  collection: CollectionItem[];
  events: CollectionEvent[];
  sets: SetProgress[];
  storageLocations: StorageLocation[];
  wishlist: WishlistItem[];
}): CollectionIntelligence {
  const holdings = collection
    .map((owned) => holdingFromItem(owned, catalogueById.get(owned.catalogueId)))
    .filter((holding): holding is HoldingInsight => Boolean(holding));
  const totalValue = holdings.reduce((total, holding) => total + holding.valueMinor, 0);
  const totalCost = collection.reduce((total, item) => total + (item.purchasePriceMinor ?? 0), 0);
  const costCoverage =
    collection.length === 0
      ? 0
      : collection.filter((item) => item.purchasePriceMinor !== undefined).length / collection.length;
  const storageCoverage =
    collection.length === 0
      ? 0
      : collection.filter((item) => item.location && item.location !== "Unassigned").length /
        collection.length;
  const topHoldings = [...holdings].sort((left, right) => right.valueMinor - left.valueMinor).slice(0, 5);
  const bestPerformer = [...holdings]
    .filter((holding) => holding.gainMinor !== null)
    .sort((left, right) => (right.gainMinor ?? 0) - (left.gainMinor ?? 0))[0];
  const gradingCandidates = holdings
    .filter((holding) => {
      const owned = collection.find((item) => item.id === holding.id);

      return Boolean(
        owned &&
          holding.valueMinor >= 10000 &&
          owned.grade === "Raw" &&
          ["Mint", "Near Mint", "Near mint"].includes(owned.condition),
      );
    })
    .slice(0, 4);
  const duplicates = duplicateInsights(collection, catalogueById);
  const wishlistOpportunities = wishlistDealInsights(wishlist, catalogueById);
  const weakConfidence = holdings
    .filter((holding) => holding.confidence === "Weak")
    .reduce(
      (total, holding) => ({
        count: total.count + 1,
        valueMinor: total.valueMinor + holding.valueMinor,
      }),
      { count: 0, valueMinor: 0 },
    );
  const storageConcentration = storageInsight(storageLocations, totalValue);
  const setFocus = setFocusInsight(sets);
  const activity = activityInsight(events);
  const portfolioMix = portfolioMixInsights(collection, catalogueById, totalValue);
  const actionQueue = buildActionQueue({
    bestPerformer,
    duplicates,
    gradingCandidates,
    storageConcentration,
    weakConfidence,
    wishlistOpportunities,
  });
  const healthScore = scoreCollection({
    costCoverage,
    storageCoverage,
    weakConfidenceShare: totalValue > 0 ? weakConfidence.valueMinor / totalValue : 0,
    storageConcentrationShare: storageConcentration?.share ?? 0,
    actionCount: actionQueue.filter((action) => action.tone === "action").length,
    totalValue,
    totalCost,
  });

  return {
    healthScore,
    healthLabel: healthLabel(healthScore),
    valueTrend: valueTrend(collection, catalogueById),
    topHoldings,
    bestPerformer,
    gradingCandidates,
    duplicates,
    wishlistOpportunities,
    weakConfidence,
    storageConcentration,
    setFocus,
    activity,
    portfolioMix,
    actionQueue,
  };
}

function holdingFromItem(
  item: CollectionItem,
  catalogueItem?: CatalogueItem,
): HoldingInsight | undefined {
  if (!catalogueItem) {
    return undefined;
  }

  const valueMinor = ownedValueMinor(item, catalogueItem);
  const cost = item.purchasePriceMinor;

  return {
    id: item.id,
    catalogueId: item.catalogueId,
    name: catalogueItem.name,
    set: catalogueItem.set,
    quantity: item.quantity,
    valueMinor,
    gainMinor: cost === undefined ? null : valueMinor - cost,
    confidence: catalogueItem.confidence,
  };
}

function duplicateInsights(
  collection: CollectionItem[],
  catalogueById: Map<string, CatalogueItem>,
): DuplicateInsight[] {
  const groups = collection.reduce<Map<string, CollectionItem[]>>((map, item) => {
    map.set(item.catalogueId, [...(map.get(item.catalogueId) ?? []), item]);
    return map;
  }, new Map());

  return Array.from(groups.entries())
    .map(([catalogueId, items]) => {
      const catalogueItem = catalogueById.get(catalogueId);

      return {
        catalogueId,
        name: catalogueItem?.name ?? "Unknown item",
        lots: items.length,
        quantity: items.reduce((total, item) => total + item.quantity, 0),
        valueMinor: items.reduce(
          (total, item) => total + (catalogueItem ? ownedValueMinor(item, catalogueItem) : 0),
          0,
        ),
      };
    })
    .filter((group) => group.lots > 1 || group.quantity > 1)
    .sort((left, right) => right.valueMinor - left.valueMinor)
    .slice(0, 5);
}

function wishlistDealInsights(
  wishlist: WishlistItem[],
  catalogueById: Map<string, CatalogueItem>,
): WishlistOpportunity[] {
  return wishlist
    .map((item) => {
      const catalogueItem = catalogueById.get(item.catalogueId);
      const targetPriceMinor = item.targetPriceMinor ?? catalogueItem?.valueMinor;

      if (!catalogueItem || targetPriceMinor === undefined || catalogueItem.valueMinor > targetPriceMinor) {
        return undefined;
      }

      return {
        id: item.id,
        name: catalogueItem.name,
        currentValueMinor: catalogueItem.valueMinor,
        targetPriceMinor,
        savingMinor: targetPriceMinor - catalogueItem.valueMinor,
      };
    })
    .filter((item): item is WishlistOpportunity => Boolean(item))
    .sort((left, right) => right.savingMinor - left.savingMinor)
    .slice(0, 4);
}

function storageInsight(locations: StorageLocation[], totalValue: number) {
  if (!locations.length || totalValue <= 0) {
    return undefined;
  }

  const location = [...locations].sort((left, right) => right.valueMinor - left.valueMinor)[0];

  if (!location || location.valueMinor <= 0) {
    return undefined;
  }

  return {
    name: location.name,
    share: Math.round((location.valueMinor / totalValue) * 100),
    valueMinor: location.valueMinor,
    totalQuantity: location.totalQuantity,
  };
}

function setFocusInsight(sets: SetProgress[]) {
  return [...sets]
    .filter((set) => set.total > 0 && set.owned < set.total)
    .map((set) => ({
      ...set,
      percent: Math.round((set.owned / set.total) * 100),
      remaining: Math.max(0, set.total - set.owned),
    }))
    .sort((left, right) => right.percent - left.percent)[0];
}

function activityInsight(events: CollectionEvent[]) {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  return events.reduce(
    (total, event) => {
      const occurredAt = new Date(event.occurredAt).getTime();

      if (Number.isFinite(occurredAt) && occurredAt >= thirtyDaysAgo) {
        total.last30Days += 1;
      }

      if (event.type === "Added") {
        total.added += 1;
      } else if (event.type === "Edited" || event.type === "Moved" || event.type === "Graded") {
        total.edited += 1;
      } else if (event.type === "Removed") {
        total.removed += 1;
      } else if (event.type === "Sold") {
        total.sold += 1;
      }

      return total;
    },
    { last30Days: 0, added: 0, edited: 0, removed: 0, sold: 0 },
  );
}

function portfolioMixInsights(
  collection: CollectionItem[],
  catalogueById: Map<string, CatalogueItem>,
  totalValue: number,
) {
  const mix = collection.reduce(
    (total, item) => {
      const catalogueItem = catalogueById.get(item.catalogueId);
      const value = catalogueItem ? ownedValueMinor(item, catalogueItem) : 0;

      if (catalogueItem?.type === "sealed") {
        total.sealed += value;
      } else {
        total.cards += value;
      }

      return total;
    },
    { cards: 0, sealed: 0 },
  );

  return [
    { label: "Cards", valueMinor: mix.cards, share: share(mix.cards, totalValue) },
    { label: "Sealed", valueMinor: mix.sealed, share: share(mix.sealed, totalValue) },
  ].filter((item) => item.valueMinor > 0);
}

function buildActionQueue({
  bestPerformer,
  duplicates,
  gradingCandidates,
  storageConcentration,
  weakConfidence,
  wishlistOpportunities,
}: {
  bestPerformer?: HoldingInsight;
  duplicates: DuplicateInsight[];
  gradingCandidates: HoldingInsight[];
  storageConcentration?: { name: string; share: number };
  weakConfidence: { count: number; valueMinor: number };
  wishlistOpportunities: WishlistOpportunity[];
}): InsightAction[] {
  const actions: InsightAction[] = [];

  if (gradingCandidates.length) {
    actions.push({
      id: "grading-candidates",
      category: "Grading",
      title: "Review grading candidates",
      detail:
        gradingCandidates.length === 1
          ? `${gradingCandidates[0].name} is raw and high value.`
          : `${gradingCandidates[0].name} and ${gradingCandidates.length - 1} more raw high-value item${gradingCandidates.length === 2 ? "" : "s"}.`,
      tone: "action",
      impact: "High",
      actionLabel: "Open collection",
    });
  }

  if (duplicates.length) {
    actions.push({
      id: "duplicate-lots",
      category: "Duplicates",
      title: "Check duplicate lots",
      detail: `${duplicates[0].name} has ${duplicates[0].quantity} tracked copies across ${duplicates[0].lots} lot${duplicates[0].lots === 1 ? "" : "s"}.`,
      tone: "watch",
      impact: duplicates[0].valueMinor >= 10000 ? "High" : "Medium",
      actionLabel: "Review lots",
    });
  }

  if (weakConfidence.count) {
    actions.push({
      id: "weak-price-confidence",
      category: "Valuation",
      title: "Refresh weak prices",
      detail: `${weakConfidence.count} holding${weakConfidence.count === 1 ? "" : "s"} rely on weak price confidence.`,
      tone: "watch",
      impact: weakConfidence.valueMinor >= 10000 ? "High" : "Medium",
      actionLabel: "Check values",
    });
  }

  if (storageConcentration && storageConcentration.share >= 60) {
    actions.push({
      id: "storage-concentration",
      category: "Storage",
      title: "Storage concentration",
      detail: `${storageConcentration.name} holds ${storageConcentration.share}% of tracked value.`,
      tone: "watch",
      impact: storageConcentration.share >= 80 ? "High" : "Medium",
      actionLabel: "Open storage",
    });
  }

  if (wishlistOpportunities.length) {
    actions.push({
      id: "wishlist-target-hit",
      category: "Wishlist",
      title: "Wishlist target hit",
      detail: `${wishlistOpportunities[0].name} is at or below target.`,
      tone: "action",
      impact: "High",
      actionLabel: "Open wishlist",
    });
  }

  if (!actions.length && bestPerformer) {
    actions.push({
      id: "collection-tidy",
      category: "Momentum",
      title: "Collection is tidy",
      detail: `${bestPerformer.name} is currently your strongest performer.`,
      tone: "good",
      impact: "Low",
      actionLabel: "View analytics",
    });
  }

  return actions.slice(0, 5);
}

function scoreCollection({
  actionCount,
  costCoverage,
  storageConcentrationShare,
  storageCoverage,
  totalCost,
  totalValue,
  weakConfidenceShare,
}: {
  actionCount: number;
  costCoverage: number;
  storageConcentrationShare: number;
  storageCoverage: number;
  totalCost: number;
  totalValue: number;
  weakConfidenceShare: number;
}) {
  if (totalValue <= 0) {
    return 0;
  }

  const gainScore = totalCost > 0 ? Math.max(-8, Math.min(12, ((totalValue - totalCost) / totalCost) * 20)) : 0;
  const score =
    58 +
    costCoverage * 14 +
    storageCoverage * 12 +
    gainScore -
    weakConfidenceShare * 18 -
    Math.max(0, storageConcentrationShare - 65) * 0.25 -
    actionCount * 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function healthLabel(score: number) {
  if (score >= 82) {
    return "Excellent";
  }

  if (score >= 68) {
    return "Healthy";
  }

  if (score >= 45) {
    return "Needs review";
  }

  return "Needs setup";
}

function valueTrend(collection: CollectionItem[], catalogueById: Map<string, CatalogueItem>) {
  const points = collection
    .map((item) => {
      const catalogueItem = catalogueById.get(item.catalogueId);

      return {
        date: item.purchaseDate ? new Date(item.purchaseDate).getTime() : Date.now(),
        valueMinor: catalogueItem ? ownedValueMinor(item, catalogueItem) : 0,
      };
    })
    .filter((point) => point.valueMinor > 0)
    .sort((left, right) => left.date - right.date)
    .reduce<number[]>((totals, point) => {
      totals.push((totals[totals.length - 1] ?? 0) + point.valueMinor);
      return totals;
    }, []);

  if (!points.length) {
    return [0, 0, 0, 0, 0, 0, 0];
  }

  return Array.from({ length: 7 }, (_unused, index) => {
    const sourceIndex = Math.round((index / 6) * (points.length - 1));
    return points[sourceIndex] ?? points[points.length - 1] ?? 0;
  });
}

function ownedValueMinor(item: CollectionItem, catalogueItem: CatalogueItem) {
  return item.overrideValueMinor ?? catalogueItem.valueMinor * item.quantity;
}

function share(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}
