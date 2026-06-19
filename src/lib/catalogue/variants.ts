import type { CatalogueItem, CatalogueVariantOption, ItemType, PricePoint } from "../types";

type VariantOptionInput = {
  itemType: ItemType;
  rarity?: string;
  setName?: string;
  priceHistory?: PricePoint[];
  variantMetadata?: unknown;
};

export function buildCatalogueVariantOptions({
  itemType,
  priceHistory = [],
  variantMetadata,
  rarity,
  setName,
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

  for (const label of inferredStandardVariantLabels({ itemType, rarity, setName })) {
    const normalized = normalizeVariantLabel(label);

    if (!options.has(normalized)) {
      options.set(normalized, { label });
    }
  }

  for (const label of inferredSpecialVariantLabels({ itemType, rarity, setName })) {
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

function inferredSpecialVariantLabels({
  itemType,
  rarity,
  setName,
}: Pick<VariantOptionInput, "itemType" | "rarity" | "setName">) {
  if (itemType !== "card") {
    return [];
  }

  const setKey = normalizeSetName(setName);
  const finish = finishLabelFromRarity(rarity);
  const labels: string[] = [];

  if (isBaseSet(setKey)) {
    labels.push(
      editionVariantLabel("1st Edition", finish),
      editionVariantLabel("Shadowless", finish),
      editionVariantLabel("Unlimited", finish),
    );
  } else if (isWotcFirstEditionSet(setKey)) {
    labels.push(
      editionVariantLabel("1st Edition", finish),
      editionVariantLabel("Unlimited", finish),
    );
  }

  if (isPromoSet(setKey)) {
    labels.push("Stamped promo");
  }

  return uniqueLabels(labels);
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

  if (normalized.includes("holo")) {
    return "Holofoil";
  }

  if (normalized.includes("reverse")) {
    return "Reverse Holofoil";
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

function isPromoSet(setKey: string) {
  return setKey.includes("blackstarpromos") || setKey.includes("promo");
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
    "1steditionholofoil": 40,
    "1stedition": 40,
    firsteditionholofoil: 40,
    firstedition: 40,
    shadowlessholofoil: 45,
    shadowless: 45,
    unlimitedholofoil: 50,
    unlimited: 50,
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

function hasVariantAwarePrices(history: PricePoint[]) {
  return history.some((point) => normalizeVariantLabel(point.variantLabel));
}

function startCase(value: string) {
  return value
    .toLowerCase()
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}
