type CardPrintingProviderData = {
  providerIds: unknown;
  searchText: string;
  variantMetadata: unknown;
};

/**
 * A provider refresh owns the ordinary card fields, but reviewed catalogue
 * imports add exact products that the ordinary feeds do not expose. Merge the
 * two layers so a later Pokemon TCG API or TCGdex pass cannot silently remove
 * reviewed product IDs, search aliases, or finish evidence.
 */
export function mergeCardPrintingProviderUpdate<T extends CardPrintingProviderData>(
  incoming: T,
  existing: Partial<CardPrintingProviderData> | null | undefined,
): T {
  if (!existing) {
    return incoming;
  }

  const existingProviderIds = jsonObject(existing.providerIds);
  const incomingProviderIds = jsonObject(incoming.providerIds);
  const existingMetadata = jsonObject(existing.variantMetadata);
  const incomingMetadata = jsonObject(incoming.variantMetadata);
  const reviewedVariants = mergeObjectArrays(
    objectArray(existingMetadata.reviewedVariants),
    objectArray(incomingMetadata.reviewedVariants),
    reviewedVariantKey,
  );
  const reviewedSearchTerms = uniqueStrings([
    ...stringArray(existingMetadata.reviewedSearchTerms),
    ...stringArray(incomingMetadata.reviewedSearchTerms),
  ]);
  const reviewedBaseSearchText = stringValue(
    incomingMetadata.reviewedBaseSearchText ?? incoming.searchText ?? existingMetadata.reviewedBaseSearchText,
  );
  const reviewedProductIds = new Set(
    reviewedVariants
      .map((variant) => stringValue(variant.sourceRef))
      .filter((value): value is string => Boolean(value)),
  );
  const hasReviewedEnrichment = reviewedVariants.length > 0
    || reviewedSearchTerms.length > 0
    || stringArray(existingProviderIds.tcgcsv_reviewed_products).length > 0;

  if (!hasReviewedEnrichment) {
    return {
      ...incoming,
      providerIds: {
        ...existingProviderIds,
        ...incomingProviderIds,
      },
    } as T;
  }

  const reviewedDetailedVariants = objectArray(existingMetadata.variantsDetailed)
    .filter((variant) => detailedVariantBelongsToReviewedProduct(variant, reviewedProductIds));
  const variantsDetailed = mergeObjectArrays(
    reviewedDetailedVariants,
    objectArray(incomingMetadata.variantsDetailed),
    detailedVariantKey,
  );
  const availablePrices = uniqueStrings([
    ...stringArray(incomingMetadata.availablePrices),
    ...reviewedVariants
      .map((variant) => stringValue(variant.label))
      .filter((value): value is string => Boolean(value)),
  ]);
  const variantMetadata: Record<string, unknown> = {
    ...incomingMetadata,
    ...(availablePrices.length ? { availablePrices } : {}),
    ...(reviewedBaseSearchText ? { reviewedBaseSearchText } : {}),
    ...(reviewedSearchTerms.length ? { reviewedSearchTerms } : {}),
    ...(reviewedVariants.length ? { reviewedVariants } : {}),
    ...(variantsDetailed.length ? { variantsDetailed } : {}),
  };
  const durableReviewedSearchTerms = reviewedSearchTerms.length
    ? reviewedSearchTerms
    : [existing.searchText];

  const searchText = uniqueStrings([
    incoming.searchText,
    ...durableReviewedSearchTerms,
  ]).join(" ").toLowerCase();

  if (reviewedSearchTerms.length) {
    variantMetadata.reviewedSearchText = searchText;
  }

  return {
    ...incoming,
    providerIds: {
      ...existingProviderIds,
      ...incomingProviderIds,
    },
    searchText,
    variantMetadata,
  } as T;
}

function detailedVariantBelongsToReviewedProduct(
  variant: Record<string, unknown>,
  reviewedProductIds: Set<string>,
) {
  const variantId = stringValue(variant.variantId);
  const thirdParty = jsonObject(variant.thirdParty);
  const tcgplayerId = stringValue(thirdParty.tcgplayer);

  return (variantId && [...reviewedProductIds].some((productId) => variantId.endsWith(productId)))
    || (tcgplayerId && reviewedProductIds.has(tcgplayerId));
}

function reviewedVariantKey(value: Record<string, unknown>) {
  const sourceRef = stringValue(value.sourceRef);

  return sourceRef
    ? `${stringValue(value.source) ?? "reviewed"}:${sourceRef}`
    : stringValue(value.label) ?? JSON.stringify(value);
}

function detailedVariantKey(value: Record<string, unknown>) {
  return stringValue(value.variantId) ?? JSON.stringify(value);
}

function mergeObjectArrays(
  preserved: Record<string, unknown>[],
  current: Record<string, unknown>[],
  keyFor: (value: Record<string, unknown>) => string,
) {
  const values = new Map<string, Record<string, unknown>>();

  for (const value of [...preserved, ...current]) {
    values.set(keyFor(value), value);
  }

  return [...values.values()];
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values
    .map(stringValue)
    .filter((value): value is string => Boolean(value)))];
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(stringValue).filter((entry): entry is string => Boolean(entry))
    : [];
}

function objectArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(jsonObject).filter((entry) => Object.keys(entry).length > 0)
    : [];
}

function stringValue(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.trim();

    return normalized || undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
