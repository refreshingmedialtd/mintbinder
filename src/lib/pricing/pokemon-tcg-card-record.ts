export type ComparablePokemonCardRecord = {
  artist?: string | null;
  cardSetId: string;
  imageLargeUrl?: string | null;
  imageSmallUrl?: string | null;
  language: string;
  legalities: unknown;
  name: string;
  number: string;
  providerIds: unknown;
  rarity?: string | null;
  region: string;
  searchText: string;
  subtypes: string[];
  supertype?: string | null;
  variantMetadata: unknown;
};

export function pokemonCardRecordMatches(
  existing: ComparablePokemonCardRecord | undefined,
  incoming: ComparablePokemonCardRecord,
  providerId: string,
) {
  if (!existing) {
    return false;
  }

  const providerIds = jsonObject(existing.providerIds) ? existing.providerIds : {};

  return (existing.artist ?? null) === (incoming.artist ?? null) &&
    existing.cardSetId === incoming.cardSetId &&
    (existing.imageLargeUrl ?? null) === (incoming.imageLargeUrl ?? null) &&
    (existing.imageSmallUrl ?? null) === (incoming.imageSmallUrl ?? null) &&
    existing.language === incoming.language &&
    existing.name === incoming.name &&
    existing.number === incoming.number &&
    providerIds.pokemon_tcg_api === providerId &&
    (existing.rarity ?? null) === (incoming.rarity ?? null) &&
    existing.region === incoming.region &&
    existing.searchText === incoming.searchText &&
    (existing.supertype ?? null) === (incoming.supertype ?? null) &&
    jsonValuesMatch(existing.legalities, incoming.legalities) &&
    jsonValuesMatch(existing.subtypes, incoming.subtypes) &&
    jsonValuesMatch(existing.variantMetadata, incoming.variantMetadata);
}

function jsonValuesMatch(left: unknown, right: unknown) {
  return JSON.stringify(canonicalJsonValue(left)) === JSON.stringify(canonicalJsonValue(right));
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
    );
  }

  return value;
}

function jsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
