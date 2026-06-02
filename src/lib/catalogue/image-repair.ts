export type CardImageRepairCandidate = {
  id: string;
  imageLargeUrl?: string | null;
  imageSmallUrl?: string | null;
  providerIds: unknown;
};

export type CardImageRepairPlanItem = {
  id: string;
  imageLargeUrl?: string;
  imageSmallUrl?: string;
  providerId: string;
};

export function buildCardImageRepairPlan(cards: CardImageRepairCandidate[]): CardImageRepairPlanItem[] {
  const plan: CardImageRepairPlanItem[] = [];

  for (const card of cards) {
    const urls = pokemonTcgImageUrlsFromProviderIds(card.providerIds);

    if (!urls) {
      continue;
    }

    const update: CardImageRepairPlanItem = {
      id: card.id,
      providerId: urls.providerId,
    };

    if (!hasImageUrl(card.imageLargeUrl)) {
      update.imageLargeUrl = urls.large;
    }

    if (!hasImageUrl(card.imageSmallUrl)) {
      update.imageSmallUrl = urls.small;
    }

    if (update.imageLargeUrl || update.imageSmallUrl) {
      plan.push(update);
    }
  }

  return plan;
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

function providerIdValue(providerIds: unknown, key: string) {
  if (!providerIds || typeof providerIds !== "object" || Array.isArray(providerIds)) {
    return undefined;
  }

  const value = (providerIds as Record<string, unknown>)[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hasImageUrl(value?: string | null) {
  return Boolean(value?.trim());
}
