import type { CatalogueStatus } from "@/lib/jobs/catalogue-status-summary";

export type CatalogueGapRecommendationType =
  | "card_image_refresh"
  | "card_pricing"
  | "catalogue_resume"
  | "duplicate_review"
  | "sealed_pricing"
  | "sealed_image_refresh"
  | "variant_metadata_refresh"
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

  if (status.cardMissingImageCount > 0) {
    recommendations.push({
      detail: `${status.cardMissingImageCount} Pokemon TCG card${status.cardMissingImageCount === 1 ? "" : "s"} are missing image URLs, with ${formatPercent(status.cardImageCoveragePercent)} image coverage.`,
      id: "card-image-gaps",
      priority: status.cardMissingImageCount >= 100 || (status.cardImageCoveragePercent ?? 100) < 90 ? "high" : "medium",
      title: "Fill card image gaps",
      type: "card_image_refresh",
    });
  }

  if (status.sealedMissingImageCount > 0) {
    recommendations.push({
      detail: `${status.sealedMissingImageCount} sealed product${status.sealedMissingImageCount === 1 ? "" : "s"} are missing image URLs, with ${formatPercent(status.sealedImageCoveragePercent)} image coverage.`,
      id: "sealed-image-gaps",
      priority: status.sealedMissingImageCount >= 25 || (status.sealedImageCoveragePercent ?? 100) < 70 ? "medium" : "low",
      title: "Fill sealed image gaps",
      type: "sealed_image_refresh",
    });
  }

  if (status.cardMissingVariantMetadataCount > 0) {
    recommendations.push({
      detail: `${status.cardMissingVariantMetadataCount} card${status.cardMissingVariantMetadataCount === 1 ? "" : "s"} have no detected TCGPlayer variant metadata, with ${formatPercent(status.cardVariantMetadataCoveragePercent)} variant metadata coverage.`,
      id: "card-variant-metadata-gaps",
      priority: status.cardMissingVariantMetadataCount >= 500 || (status.cardVariantMetadataCoveragePercent ?? 100) < 60 ? "medium" : "low",
      title: "Backfill variant metadata",
      type: "variant_metadata_refresh",
    });
  }

  const cardGap = status.pricingBySeries.find((row) => row.unpricedCardCount > 0);

  if (cardGap) {
    recommendations.push({
      detail: `${cardGap.series} has ${cardGap.unpricedCardCount} catalogue card printing${cardGap.unpricedCardCount === 1 ? "" : "s"} without an imported price snapshot, with ${formatPercent(cardGap.pricingCoveragePercent)} coverage.`,
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

  return recommendations.slice(0, 5);
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
