import { createHash } from "node:crypto";
import { ItemCondition, ItemType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  normalizePokemonTcgPaging,
  type PokemonTcgPageResult,
  shouldContinuePokemonTcgPaging,
  summarizePokemonTcgPageResults,
} from "@/lib/pricing/pokemon-tcg-pagination";

type PokemonTcgSearchResponse = {
  count: number;
  data: PokemonTcgCard[];
  page: number;
  pageSize: number;
  totalCount: number;
};

type PokemonTcgCard = {
  artist?: string;
  cardmarket?: {
    prices?: Record<string, number | null | undefined>;
    updatedAt?: string;
    url?: string;
  };
  id: string;
  images?: {
    large?: string;
    small?: string;
  };
  legalities?: Record<string, string>;
  name: string;
  number?: string;
  rarity?: string;
  set: {
    id: string;
    images?: {
      logo?: string;
      symbol?: string;
    };
    name: string;
    printedTotal?: number;
    releaseDate?: string;
    series?: string;
    total?: number;
  };
  subtypes?: string[];
  supertype?: string;
  tcgplayer?: {
    prices?: Record<string, {
      directLow?: number | null;
      high?: number | null;
      low?: number | null;
      market?: number | null;
      mid?: number | null;
    }>;
    updatedAt?: string;
    url?: string;
  };
};

type SyncPokemonCardsInput = {
  page?: number;
  pageSize?: number;
  q?: string;
  writePrices?: boolean;
};

type SyncPokemonCardPagesInput = SyncPokemonCardsInput & {
  maxPages?: number;
};

export class PricingProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingProviderConfigError";
  }
}

export async function syncPokemonTcgCardPages({
  maxPages = 1,
  page = 1,
  pageSize = 50,
  q = process.env.POKEMON_TCG_QUERY ?? "",
  writePrices = true,
}: SyncPokemonCardPagesInput = {}) {
  const paging = normalizePokemonTcgPaging({ maxPages, page, pageSize });
  const pages: PokemonTcgPageResult[] = [];

  for (let offset = 0; offset < paging.maxPages; offset += 1) {
    const currentPage = paging.page + offset;
    const result = await syncPokemonTcgCards({
      page: currentPage,
      pageSize: paging.pageSize,
      q,
      writePrices,
    });

    pages.push(result);

    if (!shouldContinuePokemonTcgPaging({ page: currentPage, pageSize: paging.pageSize, result })) {
      break;
    }
  }

  return summarizePokemonTcgPageResults({ ...paging, pages, query: q });
}

export async function syncPokemonTcgCards({
  page = 1,
  pageSize = 50,
  q = process.env.POKEMON_TCG_QUERY ?? "",
  writePrices = true,
}: SyncPokemonCardsInput = {}) {
  const paging = normalizePokemonTcgPaging({ page, pageSize });
  const response = await fetchPokemonCards({
    page: paging.page,
    pageSize: paging.pageSize,
    q,
  });
  const gbpRate = writePrices ? pokemonUsdToGbpRate() : null;
  const setIds = new Set<string>();
  let snapshotsCreated = 0;

  for (const card of response.data) {
    const setId = cardSetId(card.set.id);
    const cardId = cardPrintingId(card.id);

    setIds.add(setId);

    await prisma.cardSet.upsert({
      where: { id: setId },
      update: {
        logoImageUrl: card.set.images?.logo,
        metadata: { provider: "pokemon-tcg-api", providerUpdatedAt: new Date().toISOString() },
        name: card.set.name,
        printedTotal: card.set.printedTotal,
        providerIds: { pokemon_tcg_api: card.set.id },
        releaseDate: parsePokemonDate(card.set.releaseDate),
        series: card.set.series,
        symbolImageUrl: card.set.images?.symbol,
        total: card.set.total,
      },
      create: {
        id: setId,
        logoImageUrl: card.set.images?.logo,
        metadata: { provider: "pokemon-tcg-api", providerUpdatedAt: new Date().toISOString() },
        name: card.set.name,
        printedTotal: card.set.printedTotal,
        providerIds: { pokemon_tcg_api: card.set.id },
        releaseDate: parsePokemonDate(card.set.releaseDate),
        series: card.set.series,
        symbolImageUrl: card.set.images?.symbol,
        total: card.set.total,
      },
    });

    await prisma.cardPrinting.upsert({
      where: { id: cardId },
      update: {
        artist: card.artist,
        cardSetId: setId,
        imageLargeUrl: card.images?.large,
        imageSmallUrl: card.images?.small,
        legalities: card.legalities ?? {},
        name: card.name,
        number: card.number ?? "",
        providerIds: { pokemon_tcg_api: card.id },
        rarity: card.rarity,
        searchText: searchText(card),
        subtypes: card.subtypes ?? [],
        supertype: card.supertype,
        variantMetadata: variantMetadata(card),
      },
      create: {
        id: cardId,
        artist: card.artist,
        cardSetId: setId,
        imageLargeUrl: card.images?.large,
        imageSmallUrl: card.images?.small,
        legalities: card.legalities ?? {},
        name: card.name,
        number: card.number ?? "",
        providerIds: { pokemon_tcg_api: card.id },
        rarity: card.rarity,
        searchText: searchText(card),
        subtypes: card.subtypes ?? [],
        supertype: card.supertype,
        variantMetadata: variantMetadata(card),
      },
    });

    if (writePrices && gbpRate) {
      const price = bestTcgPlayerPrice(card);

      if (price) {
        await prisma.priceSnapshot.create({
          data: {
            cardPrintingId: cardId,
            condition: ItemCondition.NEAR_MINT,
            confidenceScore: price.confidenceScore,
            currency: "GBP",
            itemType: ItemType.CARD,
            language: "en",
            metadata: compactJson({
              originalCurrency: "USD",
              originalPrice: price.usd,
              providerUpdatedAt: card.tcgplayer?.updatedAt,
              usdToGbpRate: gbpRate,
            }),
            observedAt: new Date(),
            priceMinor: Math.round(price.usd * gbpRate * 100),
            source: "pokemon-tcg-api",
            sourceRef: card.id,
            variantLabel: price.variantLabel,
          },
        });
        snapshotsCreated += 1;
      }
    }
  }

  return {
    cardsFetched: response.count,
    cardsUpserted: response.data.length,
    page: response.page,
    pageSize: response.pageSize,
    pricingSnapshotsCreated: snapshotsCreated,
    query: q,
    setIds: [...setIds],
    setsUpserted: setIds.size,
    totalCount: response.totalCount,
  };
}

async function fetchPokemonCards({
  page,
  pageSize,
  q,
}: {
  page: number;
  pageSize: number;
  q: string;
}) {
  const url = new URL("https://api.pokemontcg.io/v2/cards");
  const apiKey = process.env.POKEMON_TCG_API_KEY;

  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("orderBy", "-set.releaseDate,number");

  if (q) {
    url.searchParams.set("q", q);
  }

  const headers: Record<string, string> = {
    accept: "application/json",
  };

  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const response = await fetch(url, { headers });
  const data = (await response.json().catch(() => ({}))) as Partial<PokemonTcgSearchResponse> & {
    error?: { message?: string };
  };

  if (!response.ok || !Array.isArray(data.data)) {
    throw new Error(data.error?.message ?? `Pokemon TCG API request failed with ${response.status}.`);
  }

  return data as PokemonTcgSearchResponse;
}

function bestTcgPlayerPrice(card: PokemonTcgCard) {
  const prices = card.tcgplayer?.prices;

  if (!prices) {
    return null;
  }

  const variantOrder = [
    "holofoil",
    "reverseHolofoil",
    "normal",
    "1stEditionHolofoil",
    "unlimitedHolofoil",
  ];

  for (const variant of variantOrder) {
    const price = prices[variant];
    const usd = price?.market ?? price?.mid ?? price?.low ?? null;

    if (usd && usd > 0) {
      return {
        confidenceScore: price.market ? 78 : price.mid ? 68 : 58,
        usd,
        variantLabel: labelFromCamelCase(variant),
      };
    }
  }

  return null;
}

function pokemonUsdToGbpRate() {
  const rate = Number(process.env.POKEMON_TCG_USD_TO_GBP_RATE);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new PricingProviderConfigError("POKEMON_TCG_USD_TO_GBP_RATE must be configured for pricing refreshes.");
  }

  return rate;
}

function cardSetId(providerId: string) {
  return uuidFromString(`pokemon-tcg-set:${providerId}`);
}

function cardPrintingId(providerId: string) {
  return uuidFromString(`pokemon-tcg-card:${providerId}`);
}

function uuidFromString(value: string) {
  const bytes = createHash("sha1").update(value).digest().subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

function parsePokemonDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(`${value.replaceAll("/", "-")}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function searchText(card: PokemonTcgCard) {
  return [
    card.name,
    card.set.name,
    card.number,
    card.rarity,
    card.supertype,
    ...(card.subtypes ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function variantMetadata(card: PokemonTcgCard) {
  return compactJson({
    availablePrices: Object.keys(card.tcgplayer?.prices ?? {}),
    cardmarketUpdatedAt: card.cardmarket?.updatedAt,
    cardmarketUrl: card.cardmarket?.url,
    provider: "pokemon-tcg-api",
    tcgplayerUpdatedAt: card.tcgplayer?.updatedAt,
    tcgplayerUrl: card.tcgplayer?.url,
  });
}

function compactJson(value: Record<string, Prisma.InputJsonValue | undefined>): Prisma.InputJsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Prisma.InputJsonObject;
}

function labelFromCamelCase(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());
}
