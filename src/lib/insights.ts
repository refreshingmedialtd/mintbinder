import type {
  CatalogueItem,
  CollectionEvent,
  CollectionItem,
  PricePoint,
  SetProgress,
  StorageLocation,
  WishlistItem,
} from "./types";
import { catalogueValueMinorForVariant } from "./catalogue/variants.ts";
import { preferredPriceSeries, priceSourceLabel } from "./pricing/market-context.ts";

export type HoldingInsight = {
  id: string;
  catalogueId: string;
  name: string;
  set: string;
  quantity: number;
  valueMinor: number;
  gainMinor: number | null;
  confidence: CatalogueItem["confidence"];
  priceObservedAt?: string;
  priceSource?: string;
  valuationSource: "market" | "manual";
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

export type PriceAlertInsight = {
  id: string;
  itemName: string;
  category: "Wishlist" | "Price confidence";
  status: "Hit" | "Watch" | "Refresh";
  detail: string;
  explanation: string;
  currentValueMinor: number;
  deltaMinor?: number;
  priceObservedAt?: string;
  priceSource?: string;
  targetValueMinor?: number;
  watchBandMinor?: number;
  actionLabel: string;
};

export type SaleInsight = {
  id: string;
  itemName: string;
  quantity?: number;
  amountMinor?: number;
  basisMinor?: number;
  gainMinor: number | null;
  occurredAt: string;
};

export type PortfolioHistoryPoint = {
  observedAt: string;
  valueMinor: number;
  manualLots: number;
  manualValueMinor: number;
  marketLots: number;
  marketValueMinor: number;
  valuedLots: number;
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
  portfolioHistory: PortfolioHistoryPoint[];
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
  valuationCoverage: {
    coveragePercent: number;
    knownLots: number;
    knownValueMinor: number;
    manualLots: number;
    manualNotesMissing: number;
    manualValueMinor: number;
    marketLots: number;
    totalLots: number;
    unvaluedLots: number;
    unvaluedQuantity: number;
  };
  priceAlerts: PriceAlertInsight[];
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
  realizedSales: {
    count: number;
    proceedsMinor: number;
    basisMinor: number;
    gainMinor: number;
    knownBasisCount: number;
    sales: SaleInsight[];
  };
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
  const valuationCoverage = valuationCoverageInsight(collection, catalogueById);
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
    .filter((holding) => holding.valuationSource === "market" && holding.confidence === "Weak")
    .reduce(
      (total, holding) => ({
        count: total.count + 1,
        valueMinor: total.valueMinor + holding.valueMinor,
      }),
      { count: 0, valueMinor: 0 },
    );
  const priceAlerts = priceAlertInsights({
    holdings,
    wishlist,
    catalogueById,
  });
  const storageConcentration = storageInsight(storageLocations, totalValue);
  const setFocus = setFocusInsight(sets);
  const activity = activityInsight(events);
  const portfolioHistory = portfolioValueHistory(collection, catalogueById);
  const portfolioMix = portfolioMixInsights(collection, catalogueById, totalValue);
  const realizedSales = realizedSalesInsight(events);
  const actionQueue = buildActionQueue({
    bestPerformer,
    duplicates,
    gradingCandidates,
    storageConcentration,
    valuationCoverage,
    weakConfidence,
    wishlistOpportunities,
  });
  const healthScore = scoreCollection({
    costCoverage,
    storageCoverage,
    manualValueShare: totalValue > 0 ? valuationCoverage.manualValueMinor / totalValue : 0,
    unvaluedShare:
      valuationCoverage.totalLots > 0
        ? valuationCoverage.unvaluedLots / valuationCoverage.totalLots
        : 0,
    weakConfidenceShare: totalValue > 0 ? weakConfidence.valueMinor / totalValue : 0,
    storageConcentrationShare: storageConcentration?.share ?? 0,
    actionCount: actionQueue.filter((action) => action.tone === "action").length,
    totalValue,
    totalCost,
  });

  return {
    healthScore,
    healthLabel: healthLabel(healthScore),
    portfolioHistory,
    valueTrend: valueTrend(portfolioHistory),
    topHoldings,
    bestPerformer,
    gradingCandidates,
    duplicates,
    wishlistOpportunities,
    weakConfidence,
    valuationCoverage,
    priceAlerts,
    storageConcentration,
    setFocus,
    activity,
    portfolioMix,
    realizedSales,
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

  if (valueMinor === undefined) {
    return undefined;
  }

  return {
    id: item.id,
    catalogueId: item.catalogueId,
    name: catalogueItem.name,
    set: catalogueItem.set,
    quantity: item.quantity,
    valueMinor,
    gainMinor: cost === undefined ? null : valueMinor - cost,
    confidence: catalogueItem.confidence,
    priceObservedAt: catalogueItem.priceObservedAt,
    priceSource: catalogueItem.priceSource,
    valuationSource: item.overrideValueMinor === undefined ? "market" : "manual",
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
          (total, item) => total + (catalogueItem ? ownedValueMinor(item, catalogueItem) ?? 0 : 0),
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
      const currentValueMinor = catalogueItem ? catalogueMarketValueMinor(catalogueItem) : undefined;
      const targetPriceMinor = item.targetPriceMinor ?? currentValueMinor;

      if (!catalogueItem || currentValueMinor === undefined || targetPriceMinor === undefined || currentValueMinor > targetPriceMinor) {
        return undefined;
      }

      return {
        id: item.id,
        name: catalogueItem.name,
        currentValueMinor,
        targetPriceMinor,
        savingMinor: targetPriceMinor - currentValueMinor,
      };
    })
    .filter((item): item is WishlistOpportunity => Boolean(item))
    .sort((left, right) => right.savingMinor - left.savingMinor)
    .slice(0, 4);
}

function priceAlertInsights({
  catalogueById,
  holdings,
  wishlist,
}: {
  catalogueById: Map<string, CatalogueItem>;
  holdings: HoldingInsight[];
  wishlist: WishlistItem[];
}): PriceAlertInsight[] {
  const wishlistAlerts = wishlist
    .map<PriceAlertInsight | undefined>((item) => {
      const catalogueItem = catalogueById.get(item.catalogueId);
      const targetValueMinor = item.targetPriceMinor;
      const currentValueMinor = catalogueItem ? catalogueMarketValueMinor(catalogueItem) : undefined;

      if (!catalogueItem || currentValueMinor === undefined || targetValueMinor === undefined) {
        return undefined;
      }

      const deltaMinor = currentValueMinor - targetValueMinor;
      const watchBandMinor = Math.round(targetValueMinor * 1.1);
      const withinWatchBand = currentValueMinor <= watchBandMinor;

      if (deltaMinor > 0 && !withinWatchBand) {
        return undefined;
      }

      return {
        id: `wishlist-${item.id}`,
        itemName: catalogueItem.name,
        category: "Wishlist" as const,
        status: deltaMinor <= 0 ? "Hit" as const : "Watch" as const,
        detail:
          deltaMinor <= 0
            ? `${catalogueItem.name} is at or below your target.`
            : `${catalogueItem.name} is within 10% of your target.`,
        explanation: wishlistAlertExplanation(deltaMinor),
        currentValueMinor,
        deltaMinor,
        priceObservedAt: catalogueItem.priceObservedAt,
        priceSource: catalogueItem.priceSource,
        targetValueMinor,
        watchBandMinor,
        actionLabel: "Open wishlist",
      };
    })
    .filter(isPriceAlertInsight);
  const confidenceAlerts = holdings
    .filter((holding) => holding.valuationSource === "market" && holding.confidence === "Weak")
    .map((holding) => ({
      id: `confidence-${holding.id}`,
      itemName: holding.name,
      category: "Price confidence" as const,
      status: "Refresh" as const,
      detail: `${holding.name} is using weak price confidence.`,
      explanation: weakConfidenceAlertExplanation(holding),
      currentValueMinor: holding.valueMinor,
      priceObservedAt: holding.priceObservedAt,
      priceSource: holding.priceSource,
      actionLabel: "Review value",
    }));

  return [...wishlistAlerts, ...confidenceAlerts]
    .sort((left, right) => {
      const statusRank = { Hit: 0, Watch: 1, Refresh: 2 };

      return statusRank[left.status] - statusRank[right.status] || right.currentValueMinor - left.currentValueMinor;
    })
    .slice(0, 8);
}

function isPriceAlertInsight(value: PriceAlertInsight | undefined): value is PriceAlertInsight {
  return Boolean(value);
}

function wishlistAlertExplanation(deltaMinor: number) {
  if (deltaMinor === 0) {
    return "Current price exactly matches your target.";
  }

  if (deltaMinor < 0) {
    return `${formatInsightMoney(Math.abs(deltaMinor))} below your target.`;
  }

  return `${formatInsightMoney(deltaMinor)} above target, inside the 10% watch band.`;
}

function weakConfidenceAlertExplanation(holding: HoldingInsight) {
  const source = holding.priceSource ? ` from ${priceSourceLabel(holding.priceSource)}` : "";
  const observed = holding.priceObservedAt ? ` observed ${formatInsightDate(holding.priceObservedAt)}` : "";

  return `Weak confidence${source}${observed}; refresh pricing or add a manual estimate.`;
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

function valuationCoverageInsight(
  collection: CollectionItem[],
  catalogueById: Map<string, CatalogueItem>,
): CollectionIntelligence["valuationCoverage"] {
  const coverage = collection.reduce(
    (total, item) => {
      const catalogueItem = catalogueById.get(item.catalogueId);
      const valueMinor = catalogueItem ? ownedValueMinor(item, catalogueItem) : undefined;

      total.totalLots += 1;

      if (valueMinor === undefined) {
        total.unvaluedLots += 1;
        total.unvaluedQuantity += item.quantity;
        return total;
      }

      total.knownLots += 1;
      total.knownValueMinor += valueMinor;

      if (item.overrideValueMinor === undefined) {
        total.marketLots += 1;
      } else {
        total.manualLots += 1;
        total.manualValueMinor += valueMinor;
        if (!item.valuationNote?.trim()) {
          total.manualNotesMissing += 1;
        }
      }

      return total;
    },
    {
      knownLots: 0,
      knownValueMinor: 0,
      manualLots: 0,
      manualNotesMissing: 0,
      manualValueMinor: 0,
      marketLots: 0,
      totalLots: 0,
      unvaluedLots: 0,
      unvaluedQuantity: 0,
    },
  );

  return {
    ...coverage,
    coveragePercent: share(coverage.knownLots, coverage.totalLots),
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
      const value = catalogueItem ? ownedValueMinor(item, catalogueItem) ?? 0 : 0;

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

function portfolioValueHistory(
  collection: CollectionItem[],
  catalogueById: Map<string, CatalogueItem>,
): PortfolioHistoryPoint[] {
  const entries = collection
    .map((item) => portfolioHistoryEntry(item, catalogueById.get(item.catalogueId)))
    .filter((entry): entry is PortfolioHistoryEntry => Boolean(entry));
  const marketDateKeys = uniqueSortedDateKeys(
    entries.flatMap((entry) => entry.kind === "market" ? entry.series.map((point) => point.dateKey) : []),
  );
  const manualDateKeys = uniqueSortedDateKeys(
    entries.flatMap((entry) => entry.kind === "manual" && entry.observedAt ? [entry.observedAt] : []),
  );
  const dateKeys = marketDateKeys.length ? marketDateKeys : manualDateKeys;

  if (!dateKeys.length) {
    return [];
  }

  return dateKeys
    .map((dateKey) => portfolioHistoryPoint(dateKey, entries))
    .filter((point) => point.valuedLots > 0);
}

type PortfolioHistoryEntry =
  | {
      kind: "manual";
      observedAt?: string;
      valueMinor: number;
    }
  | {
      kind: "market";
      quantity: number;
      series: PortfolioPricePoint[];
    };

type PortfolioPricePoint = {
  dateKey: string;
  timestamp: number;
  valueMinor: number;
};

function portfolioHistoryEntry(
  item: CollectionItem,
  catalogueItem?: CatalogueItem,
): PortfolioHistoryEntry | undefined {
  if (item.overrideValueMinor !== undefined) {
    return {
      kind: "manual",
      observedAt: item.purchaseDate ? dateKey(item.purchaseDate) : undefined,
      valueMinor: item.overrideValueMinor,
    };
  }

  if (!catalogueItem?.hasPrice) {
    return undefined;
  }

  const series = portfolioMarketSeries(catalogueItem, item.variant);

  if (!series.length) {
    return undefined;
  }

  return {
    kind: "market",
    quantity: item.quantity,
    series,
  };
}

function portfolioMarketSeries(item: CatalogueItem, variant: string) {
  const history = item.priceHistory ?? [];
  const normalizedVariant = normalizeVariantLabel(variant);
  const variantHistory = normalizedVariant
    ? history.filter((point) => normalizeVariantLabel(point.variantLabel) === normalizedVariant)
    : [];
  const candidateHistory = normalizedVariant && hasVariantAwarePrices(history) ? variantHistory : history;
  const preferredHistory = preferredPriceSeries(candidateHistory);
  const sourceHistory = preferredHistory.length ? preferredHistory : candidateHistory;
  const points = new Map<string, PortfolioPricePoint>();

  for (const point of sourceHistory) {
    const normalized = portfolioPricePoint(point);

    if (normalized) {
      points.set(normalized.dateKey, normalized);
    }
  }

  const currentObservedAt = item.priceObservedAt ? dateKey(item.priceObservedAt) : undefined;

  if (currentObservedAt) {
    const timestamp = Date.parse(`${currentObservedAt}T00:00:00.000Z`);
    const currentValueMinor = catalogueValueMinorForVariant(item, variant) ?? item.valueMinor;

    if (currentValueMinor !== undefined) {
      points.set(currentObservedAt, {
        dateKey: currentObservedAt,
        timestamp,
        valueMinor: currentValueMinor,
      });
    }
  }

  return [...points.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function portfolioPricePoint(point: PricePoint): PortfolioPricePoint | undefined {
  const normalizedDate = dateKey(point.observedAt);
  const timestamp = normalizedDate ? Date.parse(`${normalizedDate}T00:00:00.000Z`) : Number.NaN;
  const valueMinor = Number(point.valueMinor);

  if (!normalizedDate || !Number.isFinite(timestamp) || !Number.isFinite(valueMinor) || valueMinor < 0) {
    return undefined;
  }

  return {
    dateKey: normalizedDate,
    timestamp,
    valueMinor: Math.round(valueMinor),
  };
}

function portfolioHistoryPoint(
  dateKeyValue: string,
  entries: PortfolioHistoryEntry[],
): PortfolioHistoryPoint {
  const timestamp = Date.parse(`${dateKeyValue}T00:00:00.000Z`);
  const total = entries.reduce(
    (current, entry) => {
      if (entry.kind === "manual") {
        current.manualLots += 1;
        current.manualValueMinor += entry.valueMinor;
        current.valuedLots += 1;
        current.valueMinor += entry.valueMinor;
        return current;
      }

      const price = latestPriceOnOrBefore(entry.series, timestamp);

      if (!price) {
        return current;
      }

      const valueMinor = price.valueMinor * entry.quantity;
      current.marketLots += 1;
      current.marketValueMinor += valueMinor;
      current.valuedLots += 1;
      current.valueMinor += valueMinor;
      return current;
    },
    {
      manualLots: 0,
      manualValueMinor: 0,
      marketLots: 0,
      marketValueMinor: 0,
      valueMinor: 0,
      valuedLots: 0,
    },
  );

  return {
    observedAt: `${dateKeyValue}T00:00:00.000Z`,
    ...total,
  };
}

function latestPriceOnOrBefore(series: PortfolioPricePoint[], timestamp: number) {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    if (series[index].timestamp <= timestamp) {
      return series[index];
    }
  }

  return undefined;
}

function realizedSalesInsight(events: CollectionEvent[]) {
  const sales = events
    .filter((event) => event.type === "Sold")
    .map((event) => {
      const gainMinor =
        event.amountMinor === undefined || event.basisMinor === undefined
          ? null
          : event.amountMinor - event.basisMinor;

      return {
        id: event.id,
        itemName: event.itemName,
        quantity: event.quantity,
        amountMinor: event.amountMinor,
        basisMinor: event.basisMinor,
        gainMinor,
        occurredAt: event.occurredAt,
      };
    })
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
  const proceedsMinor = sales.reduce((total, sale) => total + (sale.amountMinor ?? 0), 0);
  const knownBasisSales = sales.filter((sale) => sale.basisMinor !== undefined);
  const basisMinor = knownBasisSales.reduce((total, sale) => total + (sale.basisMinor ?? 0), 0);
  const gainMinor = knownBasisSales.reduce((total, sale) => total + (sale.gainMinor ?? 0), 0);

  return {
    count: sales.length,
    proceedsMinor,
    basisMinor,
    gainMinor,
    knownBasisCount: knownBasisSales.length,
    sales: sales.slice(0, 6),
  };
}

function buildActionQueue({
  bestPerformer,
  duplicates,
  gradingCandidates,
  storageConcentration,
  valuationCoverage,
  weakConfidence,
  wishlistOpportunities,
}: {
  bestPerformer?: HoldingInsight;
  duplicates: DuplicateInsight[];
  gradingCandidates: HoldingInsight[];
  storageConcentration?: { name: string; share: number };
  valuationCoverage: CollectionIntelligence["valuationCoverage"];
  weakConfidence: { count: number; valueMinor: number };
  wishlistOpportunities: WishlistOpportunity[];
}): InsightAction[] {
  const actions: InsightAction[] = [];

  if (valuationCoverage.unvaluedLots) {
    actions.push({
      id: "unvalued-lots",
      category: "Valuation",
      title: "Add missing estimates",
      detail: `${valuationCoverage.unvaluedLots} lot${valuationCoverage.unvaluedLots === 1 ? "" : "s"} need a market price or manual estimate.`,
      tone: "action",
      impact: valuationCoverage.unvaluedLots >= 3 ? "High" : "Medium",
      actionLabel: "Open unvalued",
    });
  }

  if (valuationCoverage.manualLots) {
    actions.push({
      id: "manual-valuations",
      category: "Valuation",
      title: "Review manual estimates",
      detail:
        valuationCoverage.manualNotesMissing > 0
          ? `${valuationCoverage.manualNotesMissing} manual estimate${valuationCoverage.manualNotesMissing === 1 ? "" : "s"} need valuation notes.`
          : `${valuationCoverage.manualLots} lot${valuationCoverage.manualLots === 1 ? "" : "s"} use manual valuation for ${formatInsightMoney(valuationCoverage.manualValueMinor)}.`,
      tone: "watch",
      impact: valuationCoverage.manualValueMinor >= 10000 ? "High" : "Medium",
      actionLabel: "Review estimates",
    });
  }

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
  manualValueShare,
  totalCost,
  totalValue,
  unvaluedShare,
  weakConfidenceShare,
}: {
  actionCount: number;
  costCoverage: number;
  storageConcentrationShare: number;
  storageCoverage: number;
  manualValueShare: number;
  totalCost: number;
  totalValue: number;
  unvaluedShare: number;
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
    unvaluedShare * 20 -
    manualValueShare * 5 -
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

function valueTrend(history: PortfolioHistoryPoint[]) {
  const points = history.map((point) => point.valueMinor).filter((value) => value > 0);

  if (!points.length) {
    return [];
  }

  return sampleTrend(points, 7);
}

function ownedValueMinor(item: CollectionItem, catalogueItem: CatalogueItem) {
  const marketValueMinor = catalogueMarketValueMinor(catalogueItem, item.variant);

  return item.overrideValueMinor ?? (marketValueMinor === undefined ? undefined : marketValueMinor * item.quantity);
}

function catalogueMarketValueMinor(catalogueItem: CatalogueItem, variant?: string) {
  return catalogueItem.hasPrice ? catalogueValueMinorForVariant(catalogueItem, variant) ?? catalogueItem.valueMinor : undefined;
}

function hasVariantAwarePrices(history: PricePoint[]) {
  return history.some((point) => normalizeVariantLabel(point.variantLabel));
}

function share(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function formatInsightMoney(valueMinor: number) {
  return `£${(valueMinor / 100).toLocaleString("en-GB", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function sampleTrend(points: number[], count: number) {
  if (points.length <= count) {
    return points;
  }

  return Array.from({ length: count }, (_unused, index) => {
    const sourceIndex = Math.round((index / (count - 1)) * (points.length - 1));
    return points[sourceIndex] ?? points[points.length - 1] ?? 0;
  });
}

function formatInsightDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function dateKey(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString().slice(0, 10);
}

function uniqueSortedDateKeys(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
    .sort((left, right) => Date.parse(`${left}T00:00:00.000Z`) - Date.parse(`${right}T00:00:00.000Z`));
}

function normalizeVariantLabel(value?: string | null) {
  return String(value ?? "")
    .trim()
    .replace(/foil/i, "foil")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
