export type CardImageRepairCandidate = {
  id: string;
  imageLargeUrl?: string | null;
  imageSmallUrl?: string | null;
  name?: string | null;
  number?: string | null;
  providerIds: unknown;
};

export type CardImageRepairPlanItem = {
  id: string;
  imageLargeUrl?: string;
  imageSmallUrl?: string;
  providerId: string;
};

export type TcgcsvCardImageProduct = {
  extendedData?: Array<{ name?: string; value?: string }> | null;
  imageUrl?: string | null;
  name?: string | null;
  productId?: number | string | null;
};

export function buildCardImageRepairPlan(
  cards: CardImageRepairCandidate[],
  tcgcsvProductsByProviderCode: Map<string, TcgcsvCardImageProduct[]> = new Map(),
): CardImageRepairPlanItem[] {
  const plan: CardImageRepairPlanItem[] = [];

  for (const card of cards) {
    const providerId = pokemonTcgProviderIdFromProviderIds(card.providerIds);
    const providerUrls = pokemonTcgImageUrlsFromProviderIds(card.providerIds);
    const tcgcsvUrls = tcgcsvCardImageUrlsForCandidate(card, tcgcsvProductsByProviderCode);
    const urls = tcgcsvUrls ?? providerUrls;

    if (!providerId || !urls) {
      continue;
    }

    const update: CardImageRepairPlanItem = {
      id: card.id,
      providerId,
    };

    if (!hasUsableCardImageUrl(card.imageLargeUrl)) {
      update.imageLargeUrl = urls.large;
    }

    if (!hasUsableCardImageUrl(card.imageSmallUrl)) {
      update.imageSmallUrl = urls.small;
    }

    if (update.imageLargeUrl || update.imageSmallUrl) {
      plan.push(update);
    }
  }

  return plan;
}

export function knownBadPokemonTcgImageProviderCodes(providerIds: unknown[]) {
  const codes = new Set<string>();

  for (const providerIdSource of providerIds) {
    const providerId = pokemonTcgProviderIdFromProviderIds(providerIdSource);

    if (!providerId) {
      continue;
    }

    const separatorIndex = providerId.lastIndexOf("-");

    if (separatorIndex <= 0) {
      continue;
    }

    const providerCode = providerId.slice(0, separatorIndex);

    if (providerCode === "mcd18") {
      codes.add(providerCode);
    }
  }

  return Array.from(codes);
}

export function pokemonTcgImageUrlsFromProviderIds(providerIds: unknown) {
  const providerId = pokemonTcgProviderIdFromProviderIds(providerIds);

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

function pokemonTcgProviderIdFromProviderIds(providerIds: unknown) {
  return providerIdValue(providerIds, "pokemon_tcg_api");
}

function tcgcsvCardImageUrlsForCandidate(
  card: CardImageRepairCandidate,
  productsByProviderCode: Map<string, TcgcsvCardImageProduct[]>,
) {
  const providerId = pokemonTcgProviderIdFromProviderIds(card.providerIds);

  if (!providerId) {
    return undefined;
  }

  const separatorIndex = providerId.lastIndexOf("-");

  if (separatorIndex <= 0 || separatorIndex === providerId.length - 1) {
    return undefined;
  }

  const providerCode = providerId.slice(0, separatorIndex);
  const providerNumber = providerId.slice(separatorIndex + 1);
  const products = productsByProviderCode.get(providerCode);
  const product = products?.find((candidate) => tcgcsvProductMatchesCard(candidate, card, providerNumber));
  const small = product?.imageUrl?.trim();

  if (!small) {
    return undefined;
  }

  return {
    large: upgradedTcgplayerCardImageUrl(small),
    providerId,
    small,
  };
}

function tcgcsvProductMatchesCard(
  product: TcgcsvCardImageProduct,
  card: CardImageRepairCandidate,
  providerNumber: string,
) {
  const productNumber = tcgcsvCardNumber(product);

  if (productNumber && normalizeCardNumber(productNumber) === normalizeCardNumber(card.number ?? providerNumber)) {
    return true;
  }

  const normalizedCardName = normalizeCardName(card.name);
  const normalizedProductName = normalizeCardName(product.name);

  return Boolean(normalizedCardName && normalizedProductName && normalizedProductName.includes(normalizedCardName));
}

function tcgcsvCardNumber(product: TcgcsvCardImageProduct) {
  const extendedData = product.extendedData;

  if (!Array.isArray(extendedData)) {
    return undefined;
  }

  return extendedData.find((item) => item.name?.toLowerCase() === "number")?.value;
}

function upgradedTcgplayerCardImageUrl(value: string) {
  return value.replace(/_(?:200w|400w)(\.[a-z0-9]+)$/i, "_in_1000x1000$1");
}

function normalizeCardNumber(value?: string | null) {
  return String(value ?? "")
    .trim()
    .replace(/^0+/, "")
    .replace(/\/.*$/, "");
}

function normalizeCardName(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s*-\s*\d+\/\d+.*$/, "")
    .replace(/[^a-z0-9]+/g, " ");
}

export function hasUsableCardImageUrl(value?: string | null) {
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

function providerIdValue(providerIds: unknown, key: string) {
  if (!providerIds || typeof providerIds !== "object" || Array.isArray(providerIds)) {
    return undefined;
  }

  const value = (providerIds as Record<string, unknown>)[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
