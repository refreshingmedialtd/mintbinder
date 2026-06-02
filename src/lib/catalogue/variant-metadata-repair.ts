export type VariantMetadataRepairCandidate = {
  id: string;
  providerIds: unknown;
  variantMetadata: unknown;
};

export type PokemonTcgVariantMetadataSource = {
  cardmarket?: {
    updatedAt?: string;
    url?: string;
  };
  id: string;
  tcgplayer?: {
    prices?: Record<string, unknown>;
    updatedAt?: string;
    url?: string;
  };
};

export type VariantMetadataRepairPlanItem = {
  id: string;
  providerId: string;
  variantMetadata: Record<string, unknown>;
};

export function variantMetadataRepairTargets(cards: VariantMetadataRepairCandidate[]) {
  return cards
    .filter((card) => !hasAvailablePrices(card.variantMetadata))
    .map((card) => {
      const providerId = pokemonTcgProviderId(card.providerIds);

      return providerId ? { id: card.id, providerId } : null;
    })
    .filter((target): target is { id: string; providerId: string } => Boolean(target));
}

export function buildVariantMetadataRepairPlan(
  candidates: VariantMetadataRepairCandidate[],
  sources: PokemonTcgVariantMetadataSource[],
): VariantMetadataRepairPlanItem[] {
  const sourceByProviderId = new Map(sources.map((source) => [source.id, source]));

  return variantMetadataRepairTargets(candidates)
    .map((target) => {
      const source = sourceByProviderId.get(target.providerId);
      const metadata = source ? repairedVariantMetadata(source, candidates.find((card) => card.id === target.id)?.variantMetadata) : null;

      return metadata
        ? {
          ...target,
          variantMetadata: metadata,
        }
        : null;
    })
    .filter((item): item is VariantMetadataRepairPlanItem => Boolean(item));
}

export function repairedVariantMetadata(
  source: PokemonTcgVariantMetadataSource,
  currentMetadata: unknown = {},
) {
  const availablePrices = Object.keys(source.tcgplayer?.prices ?? {}).filter(Boolean);

  if (!availablePrices.length) {
    return null;
  }

  return compactObject({
    ...(isObject(currentMetadata) ? currentMetadata : {}),
    availablePrices,
    cardmarketUpdatedAt: source.cardmarket?.updatedAt,
    cardmarketUrl: source.cardmarket?.url,
    provider: "pokemon-tcg-api",
    tcgplayerUpdatedAt: source.tcgplayer?.updatedAt,
    tcgplayerUrl: source.tcgplayer?.url,
  });
}

export function hasAvailablePrices(metadata: unknown) {
  if (!isObject(metadata)) {
    return false;
  }

  const availablePrices = metadata.availablePrices;

  return Array.isArray(availablePrices) && availablePrices.some((entry) => typeof entry === "string" && entry.trim());
}

export function pokemonTcgProviderId(providerIds: unknown) {
  if (!isObject(providerIds)) {
    return undefined;
  }

  const value = providerIds.pokemon_tcg_api;

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactObject(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
