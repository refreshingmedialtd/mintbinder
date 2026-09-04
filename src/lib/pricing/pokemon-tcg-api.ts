import { createHash } from "node:crypto";
import { ItemCondition, ItemType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { preserveCardSetMetadataOnUpdate } from "@/lib/pricing/card-set-metadata";
import { catalogueLanguageSearchAliases } from "@/lib/catalogue/languages";
import { ExchangeRateConfigError, resolvePokemonPricingRates } from "@/lib/pricing/exchange-rates";
import {
  normalizePokemonTcgPaging,
  pokemonTcgCardsOrderBy,
  type PokemonTcgPageResult,
  shouldContinuePokemonTcgPaging,
  summarizePokemonTcgPageResults,
} from "@/lib/pricing/pokemon-tcg-pagination";
import {
  bestPokemonTcgCardPrice,
  pokemonProviderObservedAt,
  type PokemonPricingRates,
} from "@/lib/pricing/pokemon-tcg-card-prices";
import { retryAfterMilliseconds, retryDelayMilliseconds } from "../../../scripts/provider-fetch.mjs";
import { fetchWithPolicy, ProviderRequestError } from "@/lib/http/fetch-with-policy";

type PokemonTcgSearchResponse = {
  count: number;
  data: PokemonTcgCard[];
  page: number;
  pageSize: number;
  totalCount: number;
};

type PokemonTcgSetSearchResponse = {
  count: number;
  data: PokemonTcgSet[];
  page: number;
  pageSize: number;
  totalCount: number;
};

type PokemonTcgSet = {
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
  priceOnlyUnpriced?: boolean;
  pricingRates?: PokemonPricingRates;
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

export class PokemonTcgApiRequestError extends Error {
  retryAfterMs?: number;
  status: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = "PokemonTcgApiRequestError";
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

export class PokemonTcgPartialSyncError extends Error {
  originalError: unknown;
  resultPayload: ReturnType<typeof summarizePokemonTcgPageResults> & {
    error: string;
    failedPage: number;
  };

  constructor({
    failedPage,
    originalError,
    resultPayload,
  }: {
    failedPage: number;
    originalError: unknown;
    resultPayload: ReturnType<typeof summarizePokemonTcgPageResults>;
  }) {
    super(originalError instanceof Error ? originalError.message : "Pokemon TCG sync failed.");
    this.name = "PokemonTcgPartialSyncError";
    this.originalError = originalError;
    this.resultPayload = {
      ...resultPayload,
      complete: false,
      error: this.message,
      failedPage,
      nextPage: failedPage,
    };
  }
}

export async function syncPokemonTcgCardPages({
  maxPages = 1,
  page = 1,
  pageSize = 50,
  priceOnlyUnpriced = false,
  q = process.env.POKEMON_TCG_QUERY ?? "",
  writePrices = true,
}: SyncPokemonCardPagesInput = {}) {
  const paging = normalizePokemonTcgPaging({ maxPages, page, pageSize });
  const pages: PokemonTcgPageResult[] = [];
  const pricingRates = writePrices ? await pokemonPricingRates() : undefined;

  for (let offset = 0; offset < paging.maxPages; offset += 1) {
    const currentPage = paging.page + offset;
    let result: PokemonTcgPageResult;

    try {
      result = await syncPokemonTcgCards({
        page: currentPage,
        pageSize: paging.pageSize,
        priceOnlyUnpriced,
        pricingRates,
        q,
        writePrices,
      });
    } catch (error) {
      if (pages.length === 0) {
        throw error;
      }

      throw new PokemonTcgPartialSyncError({
        failedPage: currentPage,
        originalError: error,
        resultPayload: summarizePokemonTcgPageResults({ ...paging, pages, query: q }),
      });
    }

    pages.push(result);

    if (!shouldContinuePokemonTcgPaging({ page: currentPage, pageSize: paging.pageSize, result })) {
      break;
    }
  }

  return summarizePokemonTcgPageResults({ ...paging, pages, query: q });
}

export async function syncPokemonTcgSets({
  page = 1,
  pageSize = 25,
}: {
  page?: number;
  pageSize?: number;
} = {}) {
  const normalizedPage = Math.max(1, Math.floor(Number(page) || 1));
  const normalizedPageSize = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 25)));
  const response = await fetchPokemonSets({ page: normalizedPage, pageSize: normalizedPageSize });
  const existingSets = await prisma.cardSet.findMany({
    select: {
      id: true,
      language: true,
      logoImageUrl: true,
      name: true,
      printedTotal: true,
      providerIds: true,
      region: true,
      releaseDate: true,
      series: true,
      symbolImageUrl: true,
      total: true,
      _count: { select: { cardPrintings: true } },
    },
    where: { id: { in: response.data.map((set) => cardSetId(set.id)) } },
  });
  const existingById = new Map(existingSets.map((set) => [set.id, set]));
  let setsUpserted = 0;

  for (const set of response.data) {
    const id = cardSetId(set.id);
    const data = {
      language: "en",
      logoImageUrl: set.images?.logo,
      metadata: { provider: "pokemon-tcg-api" },
      name: set.name,
      printedTotal: set.printedTotal,
      providerIds: { pokemon_tcg_api: set.id },
      region: "international",
      releaseDate: parsePokemonDate(set.releaseDate),
      series: set.series,
      symbolImageUrl: set.images?.symbol,
      total: set.total,
    } satisfies Prisma.CardSetUncheckedCreateInput;
    const existing = existingById.get(id);

    if (existing && pokemonSetRecordMatches(existing, set)) {
      continue;
    }

    await prisma.cardSet.upsert({
      where: { id },
      update: preserveCardSetMetadataOnUpdate(data),
      create: { id, ...data },
    });
    setsUpserted += 1;
  }

  const catalogueBackfillSet = response.data
    .map((set) => {
      const releaseDate = parsePokemonDate(set.releaseDate);
      const cardCount = existingById.get(cardSetId(set.id))?._count.cardPrintings ?? 0;
      const expectedTotal = Math.max(set.total ?? 0, set.printedTotal ?? 0);

      if (!releaseDate || releaseDate.getTime() > Date.now() || expectedTotal <= cardCount) {
        return null;
      }

      return {
        cardCount,
        name: set.name,
        nextPage: Math.floor(cardCount / 250) + 1,
        providerId: set.id,
        total: expectedTotal,
      };
    })
    .find((set) => set !== null) ?? null;

  return {
    cardsFetched: 0,
    cardsUpserted: 0,
    catalogueBackfillSet,
    complete: true,
    latestSet: response.data[0]
      ? {
          id: response.data[0].id,
          name: response.data[0].name,
          releaseDate: response.data[0].releaseDate ?? null,
        }
      : null,
    maxPages: 1,
    nextPage: null,
    page: response.page,
    pageSize: response.pageSize,
    pages: [],
    pagesProcessed: 1,
    pricingSnapshotsCreated: 0,
    provider: "pokemon-tcg-api",
    query: "set-discovery",
    setsFetched: response.count,
    setsUpserted,
    totalCount: response.totalCount,
  };
}

function pokemonSetRecordMatches(
  existing: {
    language: string;
    logoImageUrl: string | null;
    name: string;
    printedTotal: number | null;
    providerIds: Prisma.JsonValue;
    region: string;
    releaseDate: Date | null;
    series: string | null;
    symbolImageUrl: string | null;
    total: number | null;
  },
  incoming: PokemonTcgSet,
) {
  const providerIds = isJsonObject(existing.providerIds) ? existing.providerIds : {};
  const incomingReleaseDate = parsePokemonDate(incoming.releaseDate);

  return existing.language === "en"
    && existing.region === "international"
    && existing.name === incoming.name
    && existing.printedTotal === (incoming.printedTotal ?? null)
    && existing.total === (incoming.total ?? null)
    && existing.series === (incoming.series ?? null)
    && existing.logoImageUrl === (incoming.images?.logo ?? null)
    && existing.symbolImageUrl === (incoming.images?.symbol ?? null)
    && existing.releaseDate?.getTime() === incomingReleaseDate?.getTime()
    && providerIds.pokemon_tcg_api === incoming.id;
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function syncPokemonTcgCards({
  page = 1,
  pageSize = 50,
  priceOnlyUnpriced = false,
  pricingRates,
  q = process.env.POKEMON_TCG_QUERY ?? "",
  writePrices = true,
}: SyncPokemonCardsInput = {}) {
  const paging = normalizePokemonTcgPaging({ page, pageSize });
  const response = await fetchPokemonCards({
    page: paging.page,
    pageSize: paging.pageSize,
    q,
  });
  const resolvedPricingRates = writePrices ? pricingRates ?? await pokemonPricingRates() : null;
  const cards = response.data;
  const setIds = new Set<string>();
  const pricedCardIds = writePrices && priceOnlyUnpriced
    ? await existingPriceSnapshotCardIds(cards.map((card) => cardPrintingId(card.id)))
    : new Set<string>();
  const priceSnapshots: Prisma.PriceSnapshotCreateManyInput[] = [];
  const importedAt = new Date();
  let snapshotsCreated = 0;

  for (const card of uniqueCardsBySet(cards)) {
    const setId = cardSetId(card.set.id);

    setIds.add(setId);

    const setData = {
      language: "en",
      logoImageUrl: card.set.images?.logo,
      metadata: { provider: "pokemon-tcg-api", providerUpdatedAt: new Date().toISOString() },
      name: card.set.name,
      printedTotal: card.set.printedTotal,
      providerIds: { pokemon_tcg_api: card.set.id },
      region: "international",
      releaseDate: parsePokemonDate(card.set.releaseDate),
      series: card.set.series,
      symbolImageUrl: card.set.images?.symbol,
      total: card.set.total,
    } satisfies Prisma.CardSetUncheckedCreateInput;

    await prisma.cardSet.upsert({
      where: { id: setId },
      update: preserveCardSetMetadataOnUpdate(setData),
      create: {
        id: setId,
        ...setData,
      },
    });
  }

  for (const card of cards) {
    const setId = cardSetId(card.set.id);
    const cardId = cardPrintingId(card.id);

    setIds.add(setId);

    await prisma.cardPrinting.upsert({
      where: { id: cardId },
      update: {
        artist: card.artist,
        cardSetId: setId,
        imageLargeUrl: card.images?.large,
        imageSmallUrl: card.images?.small,
        legalities: card.legalities ?? {},
        language: "en",
        name: card.name,
        number: card.number ?? "",
        providerIds: { pokemon_tcg_api: card.id },
        rarity: card.rarity,
        region: "international",
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
        language: "en",
        name: card.name,
        number: card.number ?? "",
        providerIds: { pokemon_tcg_api: card.id },
        rarity: card.rarity,
        region: "international",
        searchText: searchText(card),
        subtypes: card.subtypes ?? [],
        supertype: card.supertype,
        variantMetadata: variantMetadata(card),
      },
    });

    if (writePrices && resolvedPricingRates && (!priceOnlyUnpriced || !pricedCardIds.has(cardId))) {
      const price = bestPokemonTcgCardPrice(card, resolvedPricingRates);

      if (price) {
        priceSnapshots.push({
          cardPrintingId: cardId,
          condition: ItemCondition.NEAR_MINT,
          confidenceScore: price.confidenceScore,
          currency: "GBP",
          itemType: ItemType.CARD,
          language: "en",
          metadata: compactJson({
            originalCurrency: price.originalCurrency,
            originalPrice: price.originalPrice,
            providerUpdatedAt: price.providerUpdatedAt,
            conversionRate: price.conversionRate,
            exchangeRateObservedAt: resolvedPricingRates.metadata?.[price.originalCurrency]?.observedAt,
            exchangeRateProvider: resolvedPricingRates.metadata?.[price.originalCurrency]?.provider,
            exchangeRateSourceDate: resolvedPricingRates.metadata?.[price.originalCurrency]?.sourceDate,
            priceSource: price.sourceLabel,
          }),
          observedAt: pokemonProviderObservedAt(price.providerUpdatedAt, importedAt),
          priceMinor: Math.round(price.originalPrice * price.conversionRate * 100),
          source: price.source,
          sourceRef: card.id,
          variantLabel: price.variantLabel,
        });
        snapshotsCreated += 1;
      }
    }
  }

  if (priceSnapshots.length) {
    await prisma.priceSnapshot.createMany({
      data: priceSnapshots,
    });
  }

  return {
    cardsFetched: response.count,
    cardsUpserted: cards.length,
    page: response.page,
    pageSize: response.pageSize,
    pricingSnapshotsCreated: snapshotsCreated,
    provider: "pokemon-tcg-api",
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
  const retryAttempts = optionalPositiveInteger(process.env.POKEMON_TCG_API_RETRY_ATTEMPTS) ?? 3;
  const retryWaitMs = optionalNonNegativeInteger(process.env.POKEMON_TCG_API_RETRY_WAIT_MS) ?? 1500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      return await fetchPokemonCardsOnce({ page, pageSize, q });
    } catch (error) {
      lastError = error;

      if (!isRetryablePokemonTcgError(error) || attempt >= retryAttempts) {
        throw error;
      }

      await wait(retryDelayMilliseconds({
        attempt,
        retryAfterMs: error instanceof PokemonTcgApiRequestError ? error.retryAfterMs : undefined,
        retryWaitMs,
      }));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Pokemon TCG API request failed.");
}

async function fetchPokemonSets({ page, pageSize }: { page: number; pageSize: number }) {
  const retryAttempts = optionalPositiveInteger(process.env.POKEMON_TCG_API_RETRY_ATTEMPTS) ?? 3;
  const retryWaitMs = optionalNonNegativeInteger(process.env.POKEMON_TCG_API_RETRY_WAIT_MS) ?? 1500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      const url = new URL("https://api.pokemontcg.io/v2/sets");
      const apiKey = process.env.POKEMON_TCG_API_KEY;
      const headers: Record<string, string> = { accept: "application/json" };

      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(pageSize));
      url.searchParams.set("orderBy", "-releaseDate,id");

      if (apiKey) {
        headers["x-api-key"] = apiKey;
      }

      const response = await fetchWithPolicy(
        url,
        { headers, signal: pokemonTcgFetchSignal() },
        {
          maxResponseBytes: 16 * 1024 * 1024,
          provider: "Pokemon TCG sets",
          retryAttempts: 0,
          timeoutMs: pokemonTcgApiTimeoutMs(),
        },
      );
      const data = (await response.json().catch(() => ({}))) as Partial<PokemonTcgSetSearchResponse> & {
        error?: { message?: string };
      };

      if (!response.ok || !Array.isArray(data.data)) {
        throw new PokemonTcgApiRequestError(
          data.error?.message ?? `Pokemon TCG sets request failed with ${response.status}.`,
          response.status,
          retryAfterMilliseconds(response.headers.get("retry-after")),
        );
      }

      return data as PokemonTcgSetSearchResponse;
    } catch (error) {
      lastError = error;

      if (!isRetryablePokemonTcgError(error) || attempt >= retryAttempts) {
        throw error;
      }

      await wait(retryDelayMilliseconds({
        attempt,
        retryAfterMs: error instanceof PokemonTcgApiRequestError ? error.retryAfterMs : undefined,
        retryWaitMs,
      }));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Pokemon TCG sets request failed.");
}

async function fetchPokemonCardsOnce({
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
  url.searchParams.set("orderBy", pokemonTcgCardsOrderBy);

  if (q) {
    url.searchParams.set("q", q);
  }

  const headers: Record<string, string> = {
    accept: "application/json",
  };

  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const response = await fetchWithPolicy(
    url,
    { headers, signal: pokemonTcgFetchSignal() },
    {
      maxResponseBytes: 32 * 1024 * 1024,
      provider: "Pokemon TCG cards",
      retryAttempts: 0,
      timeoutMs: pokemonTcgApiTimeoutMs(),
    },
  );
  const data = (await response.json().catch(() => ({}))) as Partial<PokemonTcgSearchResponse> & {
    error?: { message?: string };
  };

  if (!response.ok || !Array.isArray(data.data)) {
    throw new PokemonTcgApiRequestError(
      data.error?.message ?? `Pokemon TCG API request failed with ${response.status}.`,
      response.status,
      retryAfterMilliseconds(response.headers.get("retry-after")),
    );
  }

  return data as PokemonTcgSearchResponse;
}

function isRetryablePokemonTcgError(error: unknown) {
  if (error instanceof PokemonTcgApiRequestError) {
    return error.status === 429 || error.status >= 500;
  }

  return isFetchNetworkError(error);
}

function isFetchNetworkError(error: unknown) {
  if (error instanceof ProviderRequestError) return true;
  if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) {
    return true;
  }

  return error instanceof TypeError && /fetch|network/i.test(error.message);
}

function pokemonTcgFetchSignal() {
  return AbortSignal.timeout(pokemonTcgApiTimeoutMs());
}

function pokemonTcgApiTimeoutMs() {
  return optionalPositiveInteger(process.env.POKEMON_TCG_API_TIMEOUT_MS) ?? 8000;
}

function optionalPositiveInteger(value: unknown) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return undefined;
  }

  return Math.floor(number);
}

function optionalNonNegativeInteger(value: unknown) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return undefined;
  }

  return Math.floor(number);
}

async function wait(ms: number) {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function pokemonPricingRates(): Promise<PokemonPricingRates> {
  try {
    return await resolvePokemonPricingRates();
  } catch (error) {
    if (error instanceof ExchangeRateConfigError) {
      throw new PricingProviderConfigError(error.message);
    }

    throw error;
  }
}

async function existingPriceSnapshotCardIds(cardIds: string[]) {
  if (!cardIds.length) {
    return new Set<string>();
  }

  const snapshots = await prisma.priceSnapshot.findMany({
    distinct: ["cardPrintingId"],
    select: { cardPrintingId: true },
    where: {
      cardPrintingId: { in: cardIds },
      itemType: ItemType.CARD,
    },
  });

  return new Set(snapshots.map((snapshot) => snapshot.cardPrintingId).filter(Boolean) as string[]);
}

function uniqueCardsBySet(cards: PokemonTcgCard[]) {
  const unique = new Map<string, PokemonTcgCard>();

  for (const card of cards) {
    if (!unique.has(card.set.id)) {
      unique.set(card.set.id, card);
    }
  }

  return [...unique.values()];
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
    ...catalogueLanguageSearchAliases("en"),
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
