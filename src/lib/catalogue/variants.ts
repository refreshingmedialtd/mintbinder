import type { CatalogueItem, CatalogueVariantOption, ItemType, PricePoint } from "../types";
import {
  effectivePriceConfidence,
  preferredLatestPricePoint,
} from "../pricing/market-context.ts";

type VariantOptionInput = {
  itemType: ItemType;
  rarity?: string;
  setName?: string;
  priceHistory?: PricePoint[];
  variantMetadata?: unknown;
};

export type CatalogueVariantPriceIdentity = {
  gradedCompany: string;
  gradedScore: number;
};

export function buildCatalogueVariantOptions({
  itemType,
  priceHistory = [],
  variantMetadata,
  rarity,
  setName,
}: VariantOptionInput): CatalogueVariantOption[] {
  const options = new Map<string, CatalogueVariantOption>();
  const pricedOptions = new Map<string, { label: string; points: PricePoint[] }>();
  const metadataLabels = variantLabelsFromMetadata(variantMetadata);
  const legacyEditionSet = itemType === "card" && isLegacyNoReverseSet(normalizeSetName(setName));
  const legacyFinish = resolvedLegacyFinish({
    itemType,
    priceHistory,
    rarity,
    setName,
    variantMetadata,
  });
  const specialLabels = inferredSpecialVariantLabels({
    itemType,
    setName,
    finish: legacyFinish,
  });
  const legacyDefaultLabel = legacyDefaultVariantLabel({
    itemType,
    setName,
    finish: legacyFinish,
  });

  for (const point of priceHistory) {
    if (!point.variantLabel) {
      continue;
    }

    const label = canonicalVariantLabelForItemType(itemType, displayVariantLabelForCatalogue({
      label: point.variantLabel,
      legacyDefaultLabel,
      legacyEditionSet,
      legacyFinish,
    })) ?? displayVariantLabel(point.variantLabel);
    const normalized = normalizeVariantLabel(label);
    const candidate = pricedOptions.get(normalized) ?? { label, points: [] };

    candidate.points.push(point);
    pricedOptions.set(normalized, candidate);
  }

  for (const [normalized, candidate] of pricedOptions) {
    const point = preferredLatestPricePoint(candidate.points);

    if (!point) {
      continue;
    }

    options.set(normalized, {
      confidence: effectivePriceConfidence(point),
      label: candidate.label,
      observedAt: point.observedAt,
      source: point.source,
      valueMinor: point.valueMinor,
    });
  }

  for (const label of metadataLabels) {
    const displayLabel = canonicalVariantLabelForItemType(itemType, displayVariantLabelForCatalogue({
      label,
      legacyDefaultLabel,
      legacyEditionSet,
      legacyFinish,
    })) ?? displayVariantLabel(label);
    const normalized = normalizeVariantLabel(displayLabel);

    if (!options.has(normalized)) {
      options.set(normalized, { label: displayLabel });
    }
  }

  if (!legacyDefaultLabel && !options.size) {
    for (const label of inferredStandardVariantLabels({ itemType, rarity, setName })) {
      const normalized = normalizeVariantLabel(label);

      if (!options.has(normalized)) {
        options.set(normalized, { label });
      }
    }
  }

  for (const label of specialLabels) {
    const normalized = normalizeVariantLabel(label);

    if (!options.has(normalized)) {
      options.set(normalized, { label });
    }
  }

  if (!options.size) {
    options.set(
      normalizeVariantLabel(defaultVariantLabel(itemType)),
      { label: defaultVariantLabel(itemType) },
    );
  }

  return [...options.values()].sort(compareVariantOptions);
}

export function catalogueVariantLabels(item: CatalogueItem, current?: string) {
  const labels = new Map<string, string>();

  for (const option of item.variantOptions ?? []) {
    const label = canonicalVariantLabelForItemType(item.type, option.label) ?? option.label;
    labels.set(normalizeVariantLabel(label), label);
  }

  const currentLabel = canonicalVariantLabelForItemType(item.type, current);

  if (currentLabel) {
    labels.set(normalizeVariantLabel(currentLabel), currentLabel);
  }

  if (!labels.size) {
    const fallback = defaultVariantLabel(item.type);
    labels.set(normalizeVariantLabel(fallback), fallback);
  }

  return [...labels.values()].sort(compareVariantLabels);
}

/**
 * Resolves a UI/persisted finish to a supported catalogue label. A previous
 * client default stored `Normal` for some premium, holo-only cards; repair
 * that impossible generic choice when the catalogue now proves there is one
 * supported finish. Other explicit choices continue to fail closed.
 */
export function catalogueVariantSelectionLabel(
  item: CatalogueItem,
  variant?: string | null,
  priceIdentity?: CatalogueVariantPriceIdentity,
) {
  const requested = variant?.trim();
  const options = item.variantOptions ?? [];

  if (requested) {
    const canonicalRequested = canonicalVariantLabelForItemType(item.type, requested) ?? requested;
    const exact = options.find(
      (option) => variantLabelsMatch(item.type, option.label, canonicalRequested),
    );

    if (item.type === "sealed") {
      return canonicalVariantLabelForItemType(item.type, exact?.label ?? canonicalRequested) ?? canonicalRequested;
    }

    const normalized = normalizeVariantLabel(requested);
    if (normalized === "normal" || normalized === "standard") {
      // A slab's persisted finish is part of its exact market identity. Never
      // rewrite a literal graded stream merely because the card's raw rarity
      // would normally repair a legacy generic default.
      if (priceIdentity && hasExactPricedVariantEvidence(item, requested, priceIdentity)) {
        return exact?.label ?? requested;
      }

      const normalEvidence = hasExactPricedVariantEvidence(item, "Normal", priceIdentity);

      if (priceIdentity) {
        if (normalized === "standard" && normalEvidence) {
          return optionLabel(item, "Normal") ?? "Normal";
        }

        if (
          isPremiumSingleFinishRarity(item.rarity.toLowerCase()) &&
          hasExactPricedVariantEvidence(item, "Holofoil", priceIdentity)
        ) {
          return optionLabel(item, "Holofoil") ?? "Holofoil";
        }

        // No exact company/score evidence means there is no safe graded
        // canonicalisation. Retain the stored label rather than borrowing a
        // finish from raw rarity metadata or another grade.
        return exact?.label ?? requested;
      }

      const legacyDefaultOption = legacyDefaultOptionLabel(item);

      if (legacyDefaultOption) {
        return legacyDefaultOption;
      }

      // `Standard` was the original generic raw-card default. Once a real
      // Normal stream exists, persist and select the concrete provider finish.
      if (normalEvidence) {
        return optionLabel(item, "Normal") ?? "Normal";
      }

      // Older clients also wrote Normal/Standard for premium cards whose only
      // valid raw finish is Holofoil. Metadata can be absent or advertise
      // unpriced generic variants, so the rarity plus the absence of actual
      // Normal evidence is the reliable repair boundary.
      if (
        !isLegacyNoReverseSet(normalizeSetName(item.set)) &&
        isPremiumSingleFinishRarity(item.rarity.toLowerCase())
      ) {
        return optionLabel(item, "Holofoil") ?? "Holofoil";
      }
    }

    if (exact) {
      return exact.label;
    }

    return requested;
  }

  const fallback = options[0]?.label ?? defaultVariantLabel(item.type);
  return canonicalVariantLabelForItemType(item.type, fallback) ?? fallback;
}

/** Canonical label persisted by collection and wishlist mutation paths. */
export function catalogueVariantWriteLabel(
  item: CatalogueItem,
  variant?: string | null,
  priceIdentity?: CatalogueVariantPriceIdentity,
) {
  return catalogueVariantSelectionLabel(
    item,
    variant?.trim() || defaultVariantLabel(item.type),
    priceIdentity,
  );
}

export function catalogueValueMinorForVariant(item: CatalogueItem, variant?: string) {
  const resolvedVariant = variant ? catalogueVariantSelectionLabel(item, variant) : variant;
  const normalizedVariant = normalizeVariantLabel(resolvedVariant);
  const priceHistory = rawPriceHistory(item.priceHistory ?? []);

  if (normalizedVariant) {
    const point = latestPricePointForCatalogueVariant(item, resolvedVariant);

    if (point) {
      return point.valueMinor;
    }

    return isGenericUnlabelledVariantSelection(item.type, resolvedVariant) &&
      !hasVariantAwarePrices(priceHistory) &&
      item.hasPrice
      ? item.valueMinor
      : undefined;
  }

  return item.hasPrice ? item.valueMinor : undefined;
}

export function latestPricePointForCatalogueVariant(item: CatalogueItem, variant?: string | null) {
  const resolvedVariant = variant ? catalogueVariantSelectionLabel(item, variant) : variant;

  return preferredLatestPricePoint(
    priceHistoryForCatalogueVariant(item, rawPriceHistory(item.priceHistory ?? []), resolvedVariant),
  );
}

/**
 * Selects the catalogue headline from the first canonically ordered variant
 * that has an exact price. This keeps a premium parallel printing (for
 * example, a Pokemon Center stamp) from becoming the generic card value just
 * because its snapshot is newer than the regular printing's snapshot.
 */
export function preferredCatalogueHeadlinePricePoint(
  item: Pick<CatalogueItem, "rarity" | "set" | "type" | "variantOptions">,
  priceHistory: PricePoint[],
) {
  const headlineVariant = item.variantOptions?.find(
    (option) => option.valueMinor !== undefined,
  );

  return preferredLatestPricePoint(
    headlineVariant
      ? priceHistoryForCatalogueVariant(item, priceHistory, headlineVariant.label)
      : priceHistory,
  );
}

/**
 * Narrows an already identity-filtered price history to the selected catalogue
 * variant. Explicit variants fail closed: an unlabelled headline price is only
 * eligible for the generic legacy defaults (`Standard` and `Factory sealed`).
 */
export function priceHistoryForCatalogueVariant(
  item: Pick<CatalogueItem, "rarity" | "set" | "type" | "variantOptions">,
  priceHistory: PricePoint[],
  variant?: string | null,
) {
  const normalizedVariant = normalizedVariantLabelForItemType(item.type, variant);

  if (!normalizedVariant) {
    return priceHistory;
  }

  const exact = priceHistory.filter(
    (point) => normalizedVariantLabelForItemType(item.type, point.variantLabel) === normalizedVariant,
  );

  if (exact.length) {
    return exact;
  }

  const genericLegacyLabels = legacyGenericVariantLabelsForSelection(item, variant);

  if (genericLegacyLabels.length) {
    const legacy = priceHistory.filter(
      (point) => genericLegacyLabels.some(
        (label) => normalizeVariantLabel(point.variantLabel) === normalizeVariantLabel(label),
      ),
    );

    if (legacy.length) {
      return legacy;
    }
  }

  return isGenericUnlabelledVariantSelection(item.type, variant) && !hasVariantAwarePrices(priceHistory)
    ? priceHistory
    : [];
}

/**
 * Presents synonymous sealed marketplace labels as one exact finish without
 * changing the meaning of Normal/Standard on raw cards.
 */
export function canonicalCataloguePriceHistory(itemType: ItemType, history: PricePoint[]) {
  if (itemType !== "sealed") {
    return history;
  }

  return history.map((point) => {
    const variantLabel = canonicalVariantLabelForItemType(itemType, point.variantLabel);

    return variantLabel && variantLabel !== point.variantLabel
      ? { ...point, variantLabel }
      : point;
  });
}

export function canonicalVariantLabelForItemType(
  itemType: ItemType,
  variant?: string | null,
) {
  const requested = variant?.trim();

  if (!requested) {
    return undefined;
  }

  return itemType === "sealed" && isSealedVariantAlias(requested)
    ? "Factory sealed"
    : requested;
}

export function latestPricePointForVariant(history: PricePoint[], variant?: string | null) {
  const normalizedVariant = normalizeVariantLabel(variant);

  if (!normalizedVariant) {
    return undefined;
  }

  return preferredLatestPricePoint(
    history.filter((point) => normalizeVariantLabel(point.variantLabel) === normalizedVariant),
  );
}

export function pokemonTcgImageUrlsFromProviderIds(providerIds: unknown) {
  const providerId = providerIdValue(providerIds, "pokemon_tcg_api");

  if (!providerId) {
    return undefined;
  }

  const separatorIndex = providerId.lastIndexOf("-");

  if (separatorIndex <= 0 || separatorIndex === providerId.length - 1) {
    return undefined;
  }

  const setId = providerId.slice(0, separatorIndex);
  const cardNumber = providerId.slice(separatorIndex + 1);
  const small = `https://images.pokemontcg.io/${setId}/${cardNumber}.png`;
  const large = `https://images.pokemontcg.io/${setId}/${cardNumber}_hires.png`;

  if (!hasUsableCardImageUrl(small) || !hasUsableCardImageUrl(large)) {
    return undefined;
  }

  return {
    large,
    providerId,
    small,
  };
}

export function pokemonTcgImageUrlFromProviderIds(providerIds: unknown) {
  return pokemonTcgImageUrlsFromProviderIds(providerIds)?.large;
}

export function displayVariantLabel(value: string) {
  const spaced = value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();

  return startCase(spaced);
}

export function normalizeVariantLabel(value?: string | null) {
  const normalized = compactVariantLabel(value);
  const aliases: Record<string, string> = {
    "1steditionnormal": "1stedition",
    firsteditionnormal: "1stedition",
    shadowlessnormal: "shadowless",
    unlimitednormal: "unlimited",
  };

  return aliases[normalized] ?? normalized;
}

function compactVariantLabel(value?: string | null) {
  return String(value ?? "")
    .trim()
    .replace(/foil/i, "foil")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function variantLabelsFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }

  const source = metadata as Record<string, unknown>;
  const labels: string[] = [];

  if (Array.isArray(source.availablePrices)) {
    labels.push(
      ...source.availablePrices
        .filter((value): value is string => typeof value === "string")
        .map(displayVariantLabel),
    );
  }

  if (typeof source.finish === "string") {
    labels.push(displayVariantLabel(source.finish));
  }

  const reviewedLabels = reviewedVariantLabels(source);

  // A reviewed list is an authoritative correction for provider metadata that
  // cannot express the commercial identity precisely (for example, a generic
  // `set-logo` stamp that is sold as a named expansion stamp). Keep any
  // source-backed price keys above, but do not also expose contradictory
  // provider-derived variants.
  labels.push(...(
    reviewedLabels.length
      ? reviewedLabels
      : tcgdexVariantLabels(source)
  ));

  return uniqueLabels(labels);
}

function reviewedVariantLabels(source: Record<string, unknown>) {
  if (!Array.isArray(source.reviewedVariants)) {
    return [];
  }

  return source.reviewedVariants
    .map((variant) => {
      if (typeof variant === "string") {
        return variant.trim();
      }

      if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
        return "";
      }

      const label = (variant as Record<string, unknown>).label;

      return typeof label === "string" ? label.trim() : "";
    })
    .filter(Boolean);
}

function tcgdexVariantLabels(source: Record<string, unknown>) {
  const finishLabels: string[] = [];
  const otherLabels: string[] = [];
  const variants = source.variants;
  let firstEdition = false;

  if (variants && typeof variants === "object" && !Array.isArray(variants)) {
    for (const [key, enabled] of Object.entries(variants)) {
      if (enabled !== true) {
        continue;
      }

      const normalized = normalizeVariantLabel(key);

      if (normalized === "1stedition" || normalized === "firstedition") {
        firstEdition = true;
        continue;
      }

      const label = tcgdexVariantLabel(key);
      if (["Normal", "Holofoil", "Reverse Holofoil"].includes(label)) {
        finishLabels.push(label);
      } else {
        otherLabels.push(label);
      }
    }
  }

  if (Array.isArray(source.variantsDetailed)) {
    for (const variant of source.variantsDetailed) {
      if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
        continue;
      }

      const detail = variant as Record<string, unknown>;
      const label = tcgdexDetailedVariantLabel(detail);

      if (!label) {
        continue;
      }

      if (tcgdexDetailedVariantHasQualifier(detail)) {
        otherLabels.push(label);
      } else {
        finishLabels.push(label);
      }
    }
  }

  const uniqueFinishes = uniqueLabels(finishLabels);

  if (firstEdition) {
    otherLabels.push(
      uniqueFinishes.length === 1
        ? editionVariantLabel("1st Edition", uniqueFinishes[0])
        : "1st Edition",
    );
  }

  return [...uniqueFinishes, ...otherLabels];
}

/**
 * TCGdex describes parallel physical variants in `variants_detailed`. The
 * type alone is not a complete identity: a regular holo and a Pokemon Center
 * stamped holo deliberately share the same type. Preserve every explicit
 * foil/stamp/size qualifier so one variant cannot inherit another's price.
 */
function tcgdexDetailedVariantLabel(
  variant: Record<string, unknown>,
) {
  const type = typeof variant.type === "string" ? variant.type : undefined;
  const size = typeof variant.size === "string" ? variant.size : undefined;
  const foil = typeof variant.foil === "string" ? variant.foil : undefined;
  const stamps = Array.isArray(variant.stamp)
    ? variant.stamp.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  const finish = type ? tcgdexVariantLabel(type) : undefined;
  const normalizedFoil = normalizeVariantLabel(foil);

  if (normalizedFoil === "pokeball") {
    return "Poke Ball Reverse Holofoil";
  }

  if (normalizedFoil === "masterball") {
    return "Master Ball Reverse Holofoil";
  }

  const nonStandardSize = size && normalizeVariantLabel(size) !== "standard"
    ? displayVariantLabel(size)
    : undefined;
  const stampLabels = stamps.map(tcgdexStampLabel);

  if (stampLabels.length) {
    return uniqueLabels([
      nonStandardSize,
      ...stampLabels,
      foil ? displayVariantLabel(foil) : undefined,
      finish,
    ].filter((value): value is string => Boolean(value))).join(" ");
  }

  if (foil) {
    return [
      nonStandardSize,
      displayVariantLabel(foil),
      finish,
    ].filter(Boolean).join(" ");
  }

  // Retain the established concise label for oversize cards while still
  // treating size as an exact variant identity.
  return nonStandardSize ?? finish;
}

function tcgdexDetailedVariantHasQualifier(variant: Record<string, unknown>) {
  const size = typeof variant.size === "string" ? variant.size : undefined;

  return Boolean(
    (size && normalizeVariantLabel(size) !== "standard") ||
    (typeof variant.foil === "string" && variant.foil.trim()) ||
    (Array.isArray(variant.stamp) && variant.stamp.some(
      (value) => typeof value === "string" && Boolean(value.trim()),
    )),
  );
}

function tcgdexStampLabel(value: string) {
  const normalized = normalizeVariantLabel(value);

  if (normalized === "pokemoncenter") {
    return "Pokémon Center Stamp";
  }

  if (normalized === "setlogo") {
    return "Set Logo Stamp";
  }

  const display = displayVariantLabel(value);

  return normalizeVariantLabel(display).endsWith("stamp") ? display : `${display} Stamp`;
}

function tcgdexVariantLabel(value: string) {
  const normalized = normalizeVariantLabel(value);
  const labels: Record<string, string> = {
    firstedition: "1st Edition",
    holo: "Holofoil",
    normal: "Normal",
    reverse: "Reverse Holofoil",
    wpromo: "Promo Stamp",
  };

  return labels[normalized] ?? displayVariantLabel(value);
}

function displayVariantLabelForCatalogue({
  label,
  legacyDefaultLabel,
  legacyEditionSet,
  legacyFinish,
}: {
  label: string;
  legacyDefaultLabel?: string;
  legacyEditionSet?: boolean;
  legacyFinish?: string;
}) {
  const displayLabel = displayVariantLabel(label);
  const explicitNormalEdition = legacyEditionSet
    ? legacyNormalEditionLabel(compactVariantLabel(displayLabel))
    : undefined;

  if (explicitNormalEdition) {
    return explicitNormalEdition;
  }

  if (!legacyDefaultLabel) {
    return displayLabel;
  }

  const normalized = normalizeVariantLabel(displayLabel);

  if (
    normalized === normalizeVariantLabel(legacyFinish) ||
    normalized === normalizeVariantLabel(defaultVariantLabel("card"))
  ) {
    return legacyDefaultLabel;
  }

  return displayLabel;
}

function legacyNormalEditionLabel(normalized: string) {
  const labels: Record<string, string> = {
    "1steditionnormal": "1st Edition",
    firsteditionnormal: "1st Edition",
    shadowlessnormal: "Shadowless",
    unlimitednormal: "Unlimited",
  };

  return labels[normalized];
}

function legacyDefaultVariantLabel({
  finish,
  itemType,
  setName,
}: Pick<VariantOptionInput, "itemType" | "setName"> & { finish?: string }) {
  if (itemType !== "card" || !finish) {
    return undefined;
  }

  return isLegacyNoReverseSet(normalizeSetName(setName))
    ? editionVariantLabel("Unlimited", finish)
    : undefined;
}

function legacyGenericVariantLabelsForSelection(
  item: Pick<CatalogueItem, "rarity" | "set" | "type" | "variantOptions">,
  variant?: string | null,
) {
  if (item.type !== "card" || !isLegacyNoReverseSet(normalizeSetName(item.set))) {
    return [];
  }

  const normalized = normalizeVariantLabel(variant);
  const genericFinish = normalized === "unlimited"
    ? "Normal"
    : normalized === "unlimitedholofoil"
      ? "Holofoil"
      : undefined;

  if (!genericFinish) {
    return [];
  }

  const optionLabels = item.variantOptions?.map((option) => option.label) ?? [];
  const selectedOptionSupported = optionLabels.some(
    (label) => normalizeVariantLabel(label) === normalized,
  );

  if (!selectedOptionSupported) {
    return [];
  }

  const standardWasCanonicalized = !optionLabels.some(
    (label) => normalizeVariantLabel(label) === "standard",
  );

  return standardWasCanonicalized ? [genericFinish, "Standard"] : [genericFinish];
}

function inferredSpecialVariantLabels({
  finish,
  itemType,
  setName,
}: Pick<VariantOptionInput, "itemType" | "setName"> & { finish?: string }) {
  if (itemType !== "card") {
    return [];
  }

  const setKey = normalizeSetName(setName);
  const labels: string[] = [];

  if (finish && isBaseSet(setKey)) {
    labels.push(
      editionVariantLabel("1st Edition", finish),
      editionVariantLabel("Shadowless", finish),
      editionVariantLabel("Unlimited", finish),
    );
  } else if (finish && isWotcFirstEditionSet(setKey)) {
    labels.push(
      editionVariantLabel("1st Edition", finish),
      editionVariantLabel("Unlimited", finish),
    );
  }

  return uniqueLabels(labels);
}

function resolvedLegacyFinish(input: VariantOptionInput) {
  if (input.itemType !== "card" || !isLegacyNoReverseSet(normalizeSetName(input.setName))) {
    return undefined;
  }

  const evidence = evidencedLegacyFinish(input);
  const candidate = evidence.finish ?? finishLabelFromRarity(input.rarity);

  return evidence.rejected || candidate === "Reverse Holofoil" ? undefined : candidate;
}

/**
 * Vintage edition labels are composite identities: `1st Edition Holofoil`
 * and `1st Edition` are different physical printings. Consider the provider's
 * explicit finish metadata together with exact priced history before inferring
 * other editions in the same set. This prevents unusual holo-only rarities
 * such as Dark Raichu's `Rare Secret` and the Neo Shining cards from gaining
 * impossible non-holo options.
 *
 * If those evidence sources conflict, or either one describes a reverse holo
 * in a set that never had reverse-holo editions, inference is rejected. Exact
 * provider labels remain available; we simply do not manufacture companions.
 */
function evidencedLegacyFinish({
  priceHistory = [],
  variantMetadata,
}: Pick<VariantOptionInput, "priceHistory" | "variantMetadata">) {
  return finishEvidence(
    [
      ...variantFinishLabelsFromMetadata(variantMetadata),
      ...priceHistory
        .map((point) => point.variantLabel)
        .filter((label): label is string => Boolean(label?.trim())),
    ],
  );
}

function variantFinishLabelsFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }

  const source = metadata as Record<string, unknown>;
  const labels: string[] = [];

  if (Array.isArray(source.availablePrices)) {
    labels.push(
      ...source.availablePrices.filter(
        (value): value is string => typeof value === "string" && Boolean(value.trim()),
      ),
    );
  }

  if (typeof source.finish === "string" && source.finish.trim()) {
    labels.push(source.finish);
  }

  const variants = source.variants;
  if (variants && typeof variants === "object" && !Array.isArray(variants)) {
    for (const [key, enabled] of Object.entries(variants)) {
      if (enabled === true && ["normal", "holo", "reverse"].includes(normalizeVariantLabel(key))) {
        labels.push(key);
      }
    }
  }

  if (Array.isArray(source.variantsDetailed)) {
    for (const variant of source.variantsDetailed) {
      if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
        continue;
      }

      const type = (variant as Record<string, unknown>).type;
      if (typeof type === "string" && type.trim()) {
        labels.push(type);
      }
    }
  }

  return labels;
}

function finishEvidence(labels: string[]) {
  const finishes = new Set<string>();
  let hasReverseHolo = false;

  for (const label of labels) {
    const normalized = normalizeVariantLabel(label);

    if (normalized.includes("reverseholo") || normalized === "reverse") {
      hasReverseHolo = true;
    } else if (normalized.includes("holo")) {
      finishes.add("Holofoil");
    } else if ([
      "1stedition",
      "1steditionnormal",
      "firstedition",
      "firsteditionnormal",
      "normal",
      "shadowless",
      "shadowlessnormal",
      "unlimited",
      "unlimitednormal",
    ].includes(normalized)) {
      finishes.add("Normal");
    }
  }

  return {
    finish: !hasReverseHolo && finishes.size === 1 ? [...finishes][0] : undefined,
    rejected: hasReverseHolo || finishes.size > 1,
  };
}

function inferredStandardVariantLabels({
  itemType,
  rarity,
  setName,
}: Pick<VariantOptionInput, "itemType" | "rarity" | "setName">) {
  if (itemType !== "card") {
    return [];
  }

  const normalized = String(rarity ?? "").toLowerCase();
  const setKey = normalizeSetName(setName);

  if (isPremiumSingleFinishRarity(normalized)) {
    return ["Holofoil"];
  }

  if (isLegacyNoReverseSet(setKey)) {
    return [finishLabelFromRarity(rarity)];
  }

  if (normalized.includes("holo")) {
    return ["Holofoil", "Reverse Holofoil"];
  }

  if (["common", "uncommon", "rare"].includes(normalized.trim())) {
    return ["Normal", "Reverse Holofoil"];
  }

  return ["Normal"];
}

function isPremiumSingleFinishRarity(normalizedRarity: string) {
  return [
    "amazing rare",
    "ace spec rare",
    "double rare",
    "hyper rare",
    "illustration rare",
    "rare ace",
    "rare holo ex",
    "rare holo gx",
    "rare holo lv.x",
    "rare holo star",
    "rare holo v",
    "rare holo vmax",
    "rare holo vstar",
    "rare prime",
    "rare rainbow",
    "rare secret",
    "rare shining",
    "rare ultra",
    "secret rare",
    "shiny rare",
    "shiny ultra rare",
    "special illustration rare",
    "trainer gallery rare holo",
    "ultra rare",
  ].some((needle) => normalizedRarity.includes(needle));
}

function finishLabelFromRarity(rarity?: string) {
  const normalized = String(rarity ?? "").toLowerCase();

  if (normalized.includes("reverse")) {
    return "Reverse Holofoil";
  }

  if (normalized.includes("holo") || isPremiumSingleFinishRarity(normalized)) {
    return "Holofoil";
  }

  return "Normal";
}

function editionVariantLabel(edition: string, finish: string) {
  return finish === "Normal" ? edition : `${edition} ${finish}`;
}

function normalizeSetName(value?: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/pokemon|tcg|set/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function isBaseSet(setKey: string) {
  return setKey === "base";
}

function isWotcFirstEditionSet(setKey: string) {
  return new Set([
    "jungle",
    "fossil",
    "teamrocket",
    "gymheroes",
    "gymchallenge",
    "neogenesis",
    "neodiscovery",
    "neorevelation",
    "neodestiny",
  ]).has(setKey);
}

function isLegacyNoReverseSet(setKey: string) {
  return isBaseSet(setKey) || isWotcFirstEditionSet(setKey);
}

function providerIdValue(providerIds: unknown, key: string) {
  if (!providerIds || typeof providerIds !== "object" || Array.isArray(providerIds)) {
    return undefined;
  }

  const value = (providerIds as Record<string, unknown>)[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hasUsableCardImageUrl(value?: string | null) {
  const url = value?.trim();

  return Boolean(url) && !isKnownBadCardImageUrl(url);
}

function isKnownBadCardImageUrl(value?: string | null) {
  const url = value?.trim().toLowerCase();

  if (!url) {
    return false;
  }

  return [
    "/mcd18/",
    "cardback",
    "card-back",
    "/back.png",
    "/back_hires.png",
  ].some((pattern) => url.includes(pattern));
}

function defaultVariantLabel(itemType: ItemType) {
  return itemType === "sealed" ? "Factory sealed" : "Standard";
}

function compareVariantOptions(left: CatalogueVariantOption, right: CatalogueVariantOption) {
  return compareVariantLabels(left.label, right.label);
}

function compareVariantLabels(left: string, right: string) {
  return variantRank(left) - variantRank(right) ||
    left.localeCompare(right, undefined, { sensitivity: "base" });
}

function variantRank(value: string) {
  const normalized = normalizeVariantLabel(value);
  const ranks: Record<string, number> = {
    normal: 10,
    standard: 10,
    unlimitedholofoil: 10,
    unlimited: 10,
    holofoil: 20,
    reverseholo: 30,
    reverseholofoil: 30,
    "1steditionholofoil": 40,
    "1stedition": 40,
    firsteditionholofoil: 40,
    firstedition: 40,
    shadowlessholofoil: 45,
    shadowless: 45,
    stampedpromo: 55,
    prereleasestamp: 56,
    staffprereleasestamp: 57,
    factorysealed: 10,
  };

  return ranks[normalized] ?? 60;
}

function uniqueLabels(labels: string[]) {
  const unique = new Map<string, string>();

  for (const label of labels) {
    unique.set(normalizeVariantLabel(label), label);
  }

  return [...unique.values()];
}

function optionLabel(item: CatalogueItem, variant: string) {
  return item.variantOptions?.find((option) =>
    variantLabelsMatch(item.type, option.label, variant)
  )?.label;
}

function legacyDefaultOptionLabel(item: CatalogueItem) {
  const evidence = finishEvidence((item.variantOptions ?? []).map((option) => option.label));

  if (evidence.rejected || !evidence.finish) {
    return undefined;
  }

  const label = legacyDefaultVariantLabel({
    finish: evidence.finish,
    itemType: item.type,
    setName: item.set,
  });

  return label ? optionLabel(item, label) : undefined;
}

function hasExactPricedVariantEvidence(
  item: CatalogueItem,
  variant: string,
  priceIdentity?: CatalogueVariantPriceIdentity,
) {
  const normalized = normalizedVariantLabelForItemType(item.type, variant);
  const identityHistory = priceIdentity ? item.priceHistory ?? [] : rawPriceHistory(item.priceHistory ?? []);
  const historyEvidence = identityHistory.some(
    (point) =>
      normalizedVariantLabelForItemType(item.type, point.variantLabel) === normalized &&
      pricePointMatchesIdentity(point, priceIdentity),
  );

  if (historyEvidence) {
    return true;
  }

  // Catalogue options describe raw prices. They are not evidence for a slab's
  // exact company/score stream.
  if (priceIdentity) {
    return false;
  }

  return item.variantOptions?.some((option) =>
    option.valueMinor !== undefined &&
    normalizedVariantLabelForItemType(item.type, option.label) === normalized
  ) ?? false;
}

function pricePointMatchesIdentity(
  point: PricePoint,
  priceIdentity?: CatalogueVariantPriceIdentity,
) {
  if (!priceIdentity) {
    return !point.gradedCompany;
  }

  return normalizeGradeCompany(point.gradedCompany) === normalizeGradeCompany(priceIdentity.gradedCompany) &&
    normalizeGradeScore(point.gradedScore) === normalizeGradeScore(priceIdentity.gradedScore);
}

function normalizeGradeCompany(value?: string | null) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeGradeScore(value?: number | null) {
  const score = Number(value);

  return Number.isFinite(score) ? score : undefined;
}

function variantLabelsMatch(itemType: ItemType, left?: string | null, right?: string | null) {
  return normalizedVariantLabelForItemType(itemType, left) ===
    normalizedVariantLabelForItemType(itemType, right);
}

function normalizedVariantLabelForItemType(itemType: ItemType, variant?: string | null) {
  return normalizeVariantLabel(canonicalVariantLabelForItemType(itemType, variant));
}

function isSealedVariantAlias(variant?: string | null) {
  return new Set([
    "factorysealed",
    "newsealed",
    "normal",
    "sealed",
    "standard",
    "unopenedsealed",
  ]).has(normalizeVariantLabel(variant));
}

function hasVariantAwarePrices(history: PricePoint[]) {
  return history.some((point) => normalizeVariantLabel(point.variantLabel));
}

function rawPriceHistory(history: PricePoint[]) {
  return history.filter((point) => !point.gradedCompany);
}

function isGenericUnlabelledVariantSelection(itemType: ItemType, variant?: string | null) {
  const normalized = normalizedVariantLabelForItemType(itemType, variant);

  return itemType === "sealed"
    ? normalized === "factorysealed"
    : normalized === "standard";
}

function startCase(value: string) {
  return value
    .toLowerCase()
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}
