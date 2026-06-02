export type DuplicateProviderReviewRow = {
  collectionCount: number;
  createdAt: Date | string;
  id: string;
  imageLargeUrl: string | null;
  imageSmallUrl: string | null;
  name: string;
  number: string;
  priceSnapshotCount: number;
  providerId: string;
  rarity: string | null;
  series: string | null;
  setName: string;
  updatedAt: Date | string;
  wishlistCount: number;
};

export type DuplicateProviderReviewCard = {
  collectionCount: number;
  createdAt: string;
  id: string;
  imageLargeUrl?: string;
  imageSmallUrl?: string;
  name: string;
  number: string;
  priceSnapshotCount: number;
  rarity?: string;
  series?: string;
  setName: string;
  updatedAt: string;
  wishlistCount: number;
};

export type DuplicateProviderReviewGroup = {
  cardCount: number;
  cards: DuplicateProviderReviewCard[];
  collectionCount: number;
  priceSnapshotCount: number;
  providerId: string;
  riskLevel: "high" | "medium" | "low";
  suggestedPrimaryCardId: string;
  wishlistCount: number;
};

export type DuplicateProviderReview = {
  duplicateCardCount: number;
  duplicateGroupCount: number;
  generatedAt: string;
  groups: DuplicateProviderReviewGroup[];
  highRiskGroupCount: number;
  lowRiskGroupCount: number;
  mediumRiskGroupCount: number;
  report: "duplicate_provider_review";
};

export function buildDuplicateProviderReview(
  rows: DuplicateProviderReviewRow[],
  generatedAt = new Date(),
): DuplicateProviderReview {
  const groupsByProviderId = new Map<string, DuplicateProviderReviewCard[]>();

  for (const row of rows) {
    const cards = groupsByProviderId.get(row.providerId) ?? [];

    cards.push(mapDuplicateCard(row));
    groupsByProviderId.set(row.providerId, cards);
  }

  const groups = [...groupsByProviderId.entries()]
    .map(([providerId, cards]) => duplicateProviderGroup(providerId, cards))
    .sort(compareDuplicateGroups);

  return {
    duplicateCardCount: groups.reduce((total, group) => total + group.cardCount, 0),
    duplicateGroupCount: groups.length,
    generatedAt: generatedAt.toISOString(),
    groups,
    highRiskGroupCount: groups.filter((group) => group.riskLevel === "high").length,
    lowRiskGroupCount: groups.filter((group) => group.riskLevel === "low").length,
    mediumRiskGroupCount: groups.filter((group) => group.riskLevel === "medium").length,
    report: "duplicate_provider_review",
  };
}

function duplicateProviderGroup(providerId: string, cards: DuplicateProviderReviewCard[]): DuplicateProviderReviewGroup {
  const sortedCards = [...cards].sort(compareDuplicateCards);
  const collectionCount = sortedCards.reduce((total, card) => total + card.collectionCount, 0);
  const wishlistCount = sortedCards.reduce((total, card) => total + card.wishlistCount, 0);
  const priceSnapshotCount = sortedCards.reduce((total, card) => total + card.priceSnapshotCount, 0);
  const usedCards = sortedCards.filter((card) => card.collectionCount > 0 || card.wishlistCount > 0);

  return {
    cardCount: sortedCards.length,
    cards: sortedCards,
    collectionCount,
    priceSnapshotCount,
    providerId,
    riskLevel: usedCards.length > 1 ? "high" : collectionCount + wishlistCount + priceSnapshotCount > 0 ? "medium" : "low",
    suggestedPrimaryCardId: sortedCards[0]?.id ?? "",
    wishlistCount,
  };
}

function mapDuplicateCard(row: DuplicateProviderReviewRow): DuplicateProviderReviewCard {
  return {
    collectionCount: row.collectionCount,
    createdAt: isoDate(row.createdAt),
    id: row.id,
    imageLargeUrl: row.imageLargeUrl ?? undefined,
    imageSmallUrl: row.imageSmallUrl ?? undefined,
    name: row.name,
    number: row.number,
    priceSnapshotCount: row.priceSnapshotCount,
    rarity: row.rarity ?? undefined,
    series: row.series ?? undefined,
    setName: row.setName,
    updatedAt: isoDate(row.updatedAt),
    wishlistCount: row.wishlistCount,
  };
}

function compareDuplicateGroups(left: DuplicateProviderReviewGroup, right: DuplicateProviderReviewGroup) {
  return riskRank(right.riskLevel) - riskRank(left.riskLevel) ||
    right.cardCount - left.cardCount ||
    left.providerId.localeCompare(right.providerId);
}

function compareDuplicateCards(left: DuplicateProviderReviewCard, right: DuplicateProviderReviewCard) {
  return usageScore(right) - usageScore(left) ||
    right.priceSnapshotCount - left.priceSnapshotCount ||
    Number(Boolean(right.imageLargeUrl || right.imageSmallUrl)) - Number(Boolean(left.imageLargeUrl || left.imageSmallUrl)) ||
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
    left.name.localeCompare(right.name);
}

function usageScore(card: DuplicateProviderReviewCard) {
  return card.collectionCount * 10 + card.wishlistCount * 5;
}

function riskRank(value: DuplicateProviderReviewGroup["riskLevel"]) {
  if (value === "high") {
    return 3;
  }

  if (value === "medium") {
    return 2;
  }

  return 1;
}

function isoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
