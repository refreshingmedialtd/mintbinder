import type { CatalogueItem } from "../types.ts";
import {
  hasUsableCardImageUrl,
  pokemonTcgImageUrlsFromProviderIds,
} from "./image-repair.ts";
import { tcgdexJapaneseImageUrlFromProviderIds } from "./tcgdex-images.ts";

type CardImagePrice = {
  source?: string | null;
  sourceRef?: string | null;
};

type CardImageInput = {
  imageLargeUrl?: string | null;
  imageSmallUrl?: string | null;
  providerIds: unknown;
  prices?: CardImagePrice[];
};

/**
 * Builds an ordered failover chain instead of trusting a single remote image.
 * Older promotional sets are especially prone to a provider returning a card
 * back or a dead URL while another reviewed catalogue host has the real scan.
 */
export function cardImageCandidates({
  imageLargeUrl,
  imageSmallUrl,
  prices = [],
  providerIds,
}: CardImageInput) {
  const pokemonTcg = pokemonTcgImageUrlsFromProviderIds(providerIds);
  const tcgplayer = tcgplayerCardImageUrlFromPrices(prices);

  return uniqueUsableImageUrls([
    imageLargeUrl,
    imageSmallUrl,
    pokemonTcg?.large,
    pokemonTcg?.small,
    scrydexCardImageUrlFromProviderIds(providerIds),
    tcgdexJapaneseImageUrlFromProviderIds(providerIds),
    tcgplayer,
  ]);
}

export function catalogueItemImageCandidates(item: CatalogueItem) {
  return uniqueUsableImageUrls([item.image, ...(item.imageFallbacks ?? [])]);
}

export function scrydexCardImageUrlFromProviderIds(providerIds: unknown) {
  if (!providerIds || typeof providerIds !== "object" || Array.isArray(providerIds)) {
    return undefined;
  }

  const value = (providerIds as Record<string, unknown>).pokemon_tcg_api;
  const providerId = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (!providerId || !/^[a-z0-9][a-z0-9.-]*-[a-z0-9][a-z0-9.-]*$/i.test(providerId)) {
    return undefined;
  }

  return `https://images.scrydex.com/pokemon/${encodeURIComponent(providerId)}/medium`;
}

function tcgplayerCardImageUrlFromPrices(prices: CardImagePrice[]) {
  const snapshot = prices.find((price) =>
    price.source?.toLowerCase().startsWith("tcgcsv") && /^\d+$/.test(price.sourceRef?.trim() ?? ""),
  );

  return snapshot?.sourceRef
    ? `https://tcgplayer-cdn.tcgplayer.com/product/${snapshot.sourceRef.trim()}_in_1000x1000.jpg`
    : undefined;
}

function uniqueUsableImageUrls(values: Array<string | null | undefined>) {
  return [...new Set(values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value) && hasUsableCardImageUrl(value)))];
}
