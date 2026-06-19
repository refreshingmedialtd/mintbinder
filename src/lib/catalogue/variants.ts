import type { CatalogueItem, CatalogueVariantOption, ItemType, PricePoint } from "../types";

type VariantOptionInput = {
  itemType: ItemType;
  priceHistory?: PricePoint[];
  variantMetadata?: unknown;
};

export function buildCatalogueVariantOptions({
  itemType,
  priceHistory = [],
  variantMetadata,
}: VariantOptionInput): CatalogueVariantOption[] {
  const options = new Map<string, CatalogueVariantOption>();

  for (const point of priceHistory) {
    if (!point.variantLabel) {
      continue;
    }

    const label = displayVariantLabel(point.variantLabel);
    options.set(normalizeVariantLabel(label), {
      confidence: point.confidence,
      label,
      observedAt: point.observedAt,
      source: point.source,
      valueMinor: point.valueMinor,
    });
  }

  for (const label of variantLabelsFromMetadata(variantMetadata)) {
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
    labels.set(normalizeVariantLabel(option.label), option.label);
  }

  const currentLabel = current?.trim();

  if (currentLabel) {
    labels.set(normalizeVariantLabel(currentLabel), currentLabel);
  }

  if (!labels.size) {
    const fallback = defaultVariantLabel(item.type);
    labels.set(normalizeVariantLabel(fallback), fallback);
  }

  return [...labels.values()].sort(compareVariantLabels);
}

export function catalogueValueMinorForVariant(item: CatalogueItem, variant?: string) {
  const normalizedVariant = normalizeVariantLabel(variant);
  const priceHistory = item.priceHistory ?? [];

  if (normalizedVariant) {
    return latestPricePointForVariant(priceHistory, variant)?.valueMinor ??
      (hasVariantAwarePrices(priceHistory) ? undefined : item.valueMinor);
  }

  return item.valueMinor;
}

export function latestPricePointForVariant(history: PricePoint[], variant?: string | null) {
  const normalizedVariant = normalizeVariantLabel(variant);

  if (!normalizedVariant) {
    return undefined;
  }

  return [...history]
    .reverse()
    .find((point) => normalizeVariantLabel(point.variantLabel) === normalizedVariant);
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

  return {
    large: `https://images.pokemontcg.io/${setId}/${cardNumber}_hires.png`,
    providerId,
    small: `https://images.pokemontcg.io/${setId}/${cardNumber}.png`,
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

  return uniqueLabels(labels);
}

function providerIdValue(providerIds: unknown, key: string) {
  if (!providerIds || typeof providerIds !== "object" || Array.isArray(providerIds)) {
    return undefined;
  }

  const value = (providerIds as Record<string, unknown>)[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
    holofoil: 20,
    reverseholo: 30,
    reverseholofoil: 30,
    firsteditionholofoil: 40,
    unlimitedholofoil: 50,
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

function hasVariantAwarePrices(history: PricePoint[]) {
  return history.some((point) => normalizeVariantLabel(point.variantLabel));
}

function startCase(value: string) {
  return value
    .toLowerCase()
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}
