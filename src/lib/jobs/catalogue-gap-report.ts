import type { CatalogueStatus } from "@/lib/jobs/catalogue-status-summary";

export type CatalogueGapRecommendationType =
  | "card_pricing"
  | "catalogue_resume"
  | "duplicate_review"
  | "sealed_pricing"
  | "healthy";

export type CatalogueGapRecommendation = {
  detail: string;
  id: string;
  priority: "high" | "medium" | "low";
  title: string;
  type: CatalogueGapRecommendationType;
};

export type CatalogueGapReport = {
  generatedAt: string;
  recommendations: CatalogueGapRecommendation[];
  status: CatalogueStatus;
};

export function buildCatalogueGapReport(status: CatalogueStatus, generatedAt = new Date()): CatalogueGapReport {
  return {
    generatedAt: generatedAt.toISOString(),
    recommendations: catalogueGapRecommendations(status),
    status,
  };
}

export function catalogueGapRecommendations(status: CatalogueStatus): CatalogueGapRecommendation[] {
  const recommendations: CatalogueGapRecommendation[] = [];

  if (status.duplicateProviderIdCount > 0) {
    recommendations.push({
      detail: `${status.duplicateProviderIdCount} duplicate Pokemon TCG provider ID group${status.duplicateProviderIdCount === 1 ? "" : "s"} need review before broad imports continue.`,
      id: "duplicate-provider-ids",
      priority: "high",
      title: "Review duplicate provider IDs",
      type: "duplicate_review",
    });
  }

  if (status.nextCataloguePage) {
    recommendations.push({
      detail: `Broad catalogue import can resume from page ${status.nextCataloguePage}.`,
      id: "resume-catalogue",
      priority: status.coveragePercent !== null && status.coveragePercent < 95 ? "high" : "medium",
      title: "Resume catalogue backfill",
      type: "catalogue_resume",
    });
  }

  const cardGap = status.pricingBySeries.find((row) => row.unpricedCardCount > 0);

  if (cardGap) {
    recommendations.push({
      detail: `${cardGap.series} has ${cardGap.unpricedCardCount} unpriced card${cardGap.unpricedCardCount === 1 ? "" : "s"} with ${formatPercent(cardGap.pricingCoveragePercent)} coverage.`,
      id: `card-pricing-${slug(cardGap.series)}`,
      priority: cardGap.unpricedCardCount >= 100 || (cardGap.pricingCoveragePercent ?? 100) < 80 ? "high" : "medium",
      title: `Price ${cardGap.series}`,
      type: "card_pricing",
    });
  }

  const sealedGap = status.sealedPricingByProductType.find((row) => row.unpricedSealedProductCount > 0);

  if (sealedGap) {
    recommendations.push({
      detail: `${productTypeLabel(sealedGap.productType)} has ${sealedGap.unpricedSealedProductCount} unpriced sealed product${sealedGap.unpricedSealedProductCount === 1 ? "" : "s"} with ${formatPercent(sealedGap.sealedPricingCoveragePercent)} coverage.`,
      id: `sealed-pricing-${sealedGap.productType}`,
      priority: sealedGap.unpricedSealedProductCount >= 25 || (sealedGap.sealedPricingCoveragePercent ?? 100) < 80 ? "high" : "medium",
      title: `Run sealed pricing for ${productTypeLabel(sealedGap.productType)}`,
      type: "sealed_pricing",
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      detail: "No material catalogue or pricing gaps are showing in the current status snapshot.",
      id: "catalogue-healthy",
      priority: "low",
      title: "Catalogue health looks good",
      type: "healthy",
    });
  }

  return recommendations.slice(0, 4);
}

function formatPercent(value: number | null) {
  if (typeof value !== "number") {
    return "unknown";
  }

  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

function productTypeLabel(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
