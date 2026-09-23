import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { catalogueCollectorNumberSearchTerms } from "@/lib/catalogue/collector-number-search";
import { mergeCardPrintingProviderUpdate } from "@/lib/pricing/card-printing-enrichment";
import {
  mergeCardSetMetadata,
  preserveCardSetMetadataOnUpdate,
} from "@/lib/pricing/card-set-metadata";
import {
  catalogueDisplayNameForText,
  catalogueDisplaySetForText,
  catalogueNameAliasesForText,
} from "@/lib/catalogue/name-aliases";
import {
  CATALOGUE_LANGUAGE_OPTIONS,
  catalogueLanguageLabel,
  catalogueLanguageSearchAliases,
  catalogueRegionForLanguage,
  catalogueRegionLabel,
  supportedTcgdexLanguages,
} from "@/lib/catalogue/languages";
import { fetchWithPolicy } from "@/lib/http/fetch-with-policy";

type TcgdexCardBrief = {
  id: string;
  image?: string;
  localId?: string;
  name?: string;
};

type TcgdexCard = TcgdexCardBrief & {
  category?: string;
  dexId?: number[];
  illustrator?: string;
  legal?: Record<string, boolean>;
  regulationMark?: string;
  rarity?: string;
  set?: {
    cardCount?: {
      official?: number;
      total?: number;
    };
    id: string;
    logo?: string;
    name: string;
    symbol?: string;
  };
  stage?: string;
  suffix?: string;
  types?: string[];
  variants?: Record<string, boolean>;
  variants_detailed?: Array<{
    foil?: string;
    size?: string;
    stamp?: string[];
    thirdParty?: {
      cardmarket?: number;
      tcgplayer?: number;
    };
    type?: string;
    variantId?: string;
  }>;
};

type TcgdexSet = {
  abbreviation?: {
    official?: string;
  };
  cardCount?: {
    official?: number;
    total?: number;
  };
  cards?: TcgdexCardBrief[];
  id: string;
  legal?: Record<string, boolean>;
  logo?: string;
  name: string;
  releaseDate?: string;
  serie?: {
    id?: string;
    name?: string;
  };
  symbol?: string;
};

type SyncTcgdexCardsInput = {
  language?: string;
  maxPages?: number;
  page?: number;
  pageSize?: number;
  setId?: string;
};

const reviewedEnglishSetIds = new Set(["mep"]);

export async function syncTcgdexCardPages({
  language = "ja",
  maxPages = 1,
  page = 1,
  pageSize = 50,
  setId,
}: SyncTcgdexCardsInput = {}) {
  const resolvedLanguage = resolveTcgdexLanguage(language);
  const safePage = positiveInteger(page) ?? 1;
  const safePageSize = Math.min(positiveInteger(pageSize) ?? 50, 250);
  const safeMaxPages = Math.min(positiveInteger(maxPages) ?? 1, 20);
  const requestedSetId = setId?.trim();
  const targetedSet = requestedSetId
    ? await fetchTargetedTcgdexSet(resolvedLanguage.code, resolvedLanguage.tcgdexCode, requestedSetId)
    : undefined;
  const briefs = targetedSet?.cards ?? await fetchTcgdexCardList(resolvedLanguage.tcgdexCode);
  const startIndex = targetedSet ? 0 : (safePage - 1) * safePageSize;
  const requested = targetedSet
    ? briefs
    : briefs.slice(startIndex, startIndex + safePageSize * safeMaxPages);

  if (targetedSet) {
    if (!requested.length) {
      throw new Error(
        `TCGdex set ${targetedSet.id} does not expose any importable cards.`,
      );
    }
  }

  // Fetch and validate the complete reviewed set before the first database
  // mutation. Provider identity drift must not leave a half-imported set.
  const targetedCards = targetedSet
    ? await mapWithConcurrency(requested, 8, async (brief) => {
      const detail = await fetchTcgdexCard(resolvedLanguage.tcgdexCode, brief.id);
      const card = { ...brief, ...detail };

      if (
        card.id !== brief.id ||
        !card.name ||
        !card.set?.id ||
        card.set.id.toLowerCase() !== targetedSet.id.toLowerCase() ||
        !card.set.name
      ) {
        throw new Error(`TCGdex card ${brief.id} no longer matches reviewed set ${targetedSet.id}.`);
      }

      return card;
    })
    : undefined;
  const targetedCardsById = targetedCards
    ? new Map(targetedCards.map((card) => [card.id, card]))
    : undefined;

  const existingCards = await prisma.cardPrinting.findMany({
    select: {
      id: true,
      providerIds: true,
      searchText: true,
      variantMetadata: true,
    },
    where: {
      id: {
        in: requested.map((card) => cardPrintingId(resolvedLanguage.code, card.id)),
      },
    },
  });
  const existingCardsById = new Map(existingCards.map((card) => [card.id, card]));
  const setIds = new Set<string>();
  let cardsSkipped = 0;
  let cardsUpserted = 0;

  if (targetedSet) {
    const setId = cardSetId(resolvedLanguage.code, targetedSet.id);
    const setData = tcgdexSetData(targetedSet, resolvedLanguage, {
      availableCardCount: requested.length,
    });
    const existingSet = await prisma.cardSet.findUnique({
      select: { metadata: true, providerIds: true },
      where: { id: setId },
    });

    setIds.add(setId);
    await prisma.cardSet.upsert({
      where: { id: setId },
      update: {
        ...preserveCardSetMetadataOnUpdate(setData),
        metadata: mergeCardSetMetadata(existingSet?.metadata, setData.metadata) as Prisma.InputJsonObject,
        providerIds: mergeProviderIds(existingSet?.providerIds, setData.providerIds),
      },
      create: {
        id: setId,
        ...setData,
      },
    });
  }

  await mapWithConcurrency(requested, 8, async (brief) => {
    const preloadedCard = targetedCardsById?.get(brief.id);
    const card = preloadedCard ?? {
      ...brief,
      ...await fetchTcgdexCard(resolvedLanguage.tcgdexCode, brief.id),
    };

    if (!card.image && !["en", "ja"].includes(resolvedLanguage.code)) {
      const japaneseCard = await fetchTcgdexCardFallback("ja", brief.id);
      card.image = japaneseCard?.image;
      card.dexId = card.dexId ?? japaneseCard?.dexId;
    }

    if (!card.name || !card.set?.id || !card.set.name) {
      cardsSkipped += 1;
      return;
    }

    const setId = cardSetId(resolvedLanguage.code, card.set.id);
    const cardId = cardPrintingId(resolvedLanguage.code, card.id);

    setIds.add(setId);

    if (!targetedSet) {
      const setData = tcgdexSetData({
        cardCount: card.set.cardCount,
        id: card.set.id,
        logo: card.set.logo,
        name: card.set.name,
        symbol: card.set.symbol,
      }, resolvedLanguage);

      await prisma.cardSet.upsert({
        where: { id: setId },
        update: preserveCardSetMetadataOnUpdate(setData),
        create: {
          id: setId,
          ...setData,
        },
      });
    }

    const cardData = {
      artist: card.illustrator,
      cardSetId: setId,
      imageLargeUrl: tcgdexImageUrl(card.image, "high"),
      imageSmallUrl: tcgdexImageUrl(card.image, "low"),
      language: resolvedLanguage.code,
      legalities: card.legal ?? {},
      name: card.name,
      number: card.localId ?? "",
      providerIds: providerIds(resolvedLanguage.code, card.id),
      rarity: card.rarity,
      region: resolvedLanguage.region,
      searchText: searchText(card, resolvedLanguage.code),
      subtypes: cardSubtypes(card),
      supertype: card.category,
      variantMetadata: variantMetadata(card, resolvedLanguage.code),
    } satisfies Prisma.CardPrintingUncheckedCreateInput;

    await prisma.cardPrinting.upsert({
      where: { id: cardId },
      update: mergeCardPrintingProviderUpdate(cardData, existingCardsById.get(cardId)),
      create: {
        id: cardId,
        ...cardData,
      },
    });

    cardsUpserted += 1;
  });

  const catalogueCardsExpected = targetedSet
    ? requested.length
    : undefined;
  const catalogueCardsAvailable = targetedSet
    ? await prisma.cardPrinting.count({
      where: { cardSetId: cardSetId(resolvedLanguage.code, targetedSet.id) },
    })
    : undefined;
  const catalogueComplete = targetedSet
    ? cardsSkipped === 0 && (catalogueCardsAvailable ?? 0) >= (catalogueCardsExpected ?? 0)
    : undefined;

  if (targetedSet && !catalogueComplete) {
    throw new Error(
      `TCGdex set ${targetedSet.id} catalogue is incomplete after refresh: ` +
      `${catalogueCardsAvailable ?? 0}/${catalogueCardsExpected ?? 0} cards available, ${cardsSkipped} skipped.`,
    );
  }

  return {
    cardsFetched: requested.length,
    cardsSkipped,
    cardsUpserted,
    catalogueCardsAvailable,
    catalogueCardsExpected,
    catalogueComplete,
    language: resolvedLanguage.code,
    languageLabel: resolvedLanguage.label,
    page: targetedSet ? 1 : safePage,
    pageSize: targetedSet ? requested.length : safePageSize,
    provider: "tcgdex",
    requestedSetId: targetedSet?.id,
    sourceCardsDeclared: targetedSet?.cardCount?.total,
    setIds: [...setIds],
    setsUpserted: setIds.size,
    supportedLanguages: supportedTcgdexLanguages(),
    totalCount: briefs.length,
  };
}

async function fetchTargetedTcgdexSet(language: string, tcgdexLanguage: string, setId: string) {
  const exactSetId = setId.trim();
  const normalizedSetId = exactSetId.toLowerCase();

  // English TCGdex IDs overlap the primary Pokemon TCG API catalogue, so only
  // explicitly approved supplemental English sets may use this path. Other
  // supported languages are already TCGdex-owned and can safely repair any
  // provider-backed incomplete set by its exact ID.
  if (language === "en" && !reviewedEnglishSetIds.has(normalizedSetId)) {
    throw new Error(`Targeted TCGdex set refresh is not approved for ${language}:${setId}.`);
  }

  const set = await fetchTcgdexJson<TcgdexSet>(
    `/${tcgdexLanguage}/sets/${encodeURIComponent(exactSetId)}`,
  );

  if (set.id.toLowerCase() !== normalizedSetId || !set.name || !Array.isArray(set.cards)) {
    throw new Error(`TCGdex returned an invalid identity for reviewed set ${language}:${setId}.`);
  }

  return set;
}

async function fetchTcgdexCardList(language: string) {
  const data = await fetchTcgdexJson<TcgdexCardBrief[]>(`/${language}/cards`);

  return data.filter((card) => card.id);
}

async function fetchTcgdexCard(language: string, id: string) {
  return fetchTcgdexJson<TcgdexCard>(`/${language}/cards/${encodeURIComponent(id)}`);
}

async function fetchTcgdexCardFallback(language: string, id: string) {
  try {
    return await fetchTcgdexCard(language, id);
  } catch {
    return undefined;
  }
}

async function fetchTcgdexJson<T>(path: string): Promise<T> {
  const response = await fetchWithPolicy(`https://api.tcgdex.net/v2${path}`, {
    headers: { accept: "application/json" },
  }, {
    maxResponseBytes: 16 * 1024 * 1024,
    provider: "TCGdex",
    retryAttempts: 2,
    timeoutMs: 12_000,
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(data.error ?? `TCGdex request failed with ${response.status}.`);
  }

  return data as T;
}

function resolveTcgdexLanguage(value: string) {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  const option = CATALOGUE_LANGUAGE_OPTIONS.find((entry) =>
    entry.code === normalized || entry.tcgdexCode === normalized || entry.label.toLowerCase() === normalized,
  );

  if (!option?.tcgdexCode) {
    const supported = supportedTcgdexLanguages().map((entry) => `${entry.code} (${entry.label})`).join(", ");

    throw new Error(`Unsupported TCGdex language "${value}". Supported: ${supported}.`);
  }

  return {
    code: option.code,
    label: catalogueLanguageLabel(option.code),
    region: catalogueRegionForLanguage(option.code),
    regionLabel: catalogueRegionLabel(option.region),
    tcgdexCode: option.tcgdexCode,
  };
}

function providerIds(language: string, providerId: string): Prisma.InputJsonObject {
  return {
    tcgdex: providerId,
    [`tcgdex_${language.replaceAll("-", "_")}`]: providerId,
  };
}

function mergeProviderIds(existing: unknown, incoming: unknown): Prisma.InputJsonObject {
  return {
    ...jsonObject(existing),
    ...jsonObject(incoming),
  } as Prisma.InputJsonObject;
}

function jsonObject(value: unknown): Record<string, Prisma.InputJsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.InputJsonValue>
    : {};
}

function tcgdexSetData(
  set: TcgdexSet,
  language: ReturnType<typeof resolveTcgdexLanguage>,
  options: { availableCardCount?: number } = {},
) {
  const now = new Date().toISOString();
  const declaredCardCount = positiveInteger(set.cardCount?.total);
  const availableCardCount = positiveInteger(options.availableCardCount);

  return {
    language: language.code,
    logoImageUrl: set.logo,
    metadata: compactJson({
      ...(language.code === "en" && reviewedEnglishSetIds.has(set.id.toLowerCase())
        ? { catalogueScope: "reviewed-supplement" }
        : {}),
      abbreviation: set.abbreviation?.official,
      legal: set.legal,
      provider: "tcgdex",
      providerUpdatedAt: now,
      regionLabel: language.regionLabel,
      ...(availableCardCount ? { providerAvailableCardCount: availableCardCount } : {}),
      ...(declaredCardCount ? { sourceCardCount: declaredCardCount } : {}),
      tcgdexLanguage: language.tcgdexCode,
    }),
    name: set.name,
    printedTotal: set.cardCount?.official,
    providerIds: providerIds(language.code, set.id),
    region: language.region,
    releaseDate: set.releaseDate ? new Date(`${set.releaseDate}T00:00:00.000Z`) : undefined,
    series: set.serie?.name,
    symbolImageUrl: set.symbol,
    total: availableCardCount ?? set.cardCount?.total,
  } satisfies Prisma.CardSetUncheckedCreateInput;
}

function cardSetId(language: string, providerId: string) {
  return uuidFromString(`tcgdex-set:${language}:${providerId}`);
}

function cardPrintingId(language: string, providerId: string) {
  return uuidFromString(`tcgdex-card:${language}:${providerId}`);
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

function searchText(card: TcgdexCard, language: string) {
  return [
    card.name,
    catalogueDisplayNameForText(card.name),
    card.set?.name,
    catalogueDisplaySetForText(card.set?.name),
    ...tcgdexCollectorNumberSearchTerms(card),
    card.rarity,
    card.category,
    card.stage,
    card.suffix,
    ...(card.types ?? []),
    ...tcgdexVariantSearchTerms(card),
    ...catalogueNameAliasesForText(card.name),
    ...catalogueLanguageSearchAliases(language),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function tcgdexVariantSearchTerms(card: TcgdexCard) {
  const terms: string[] = [];

  for (const [key, enabled] of Object.entries(card.variants ?? {})) {
    if (enabled) {
      terms.push(key);
    }
  }

  for (const variant of card.variants_detailed ?? []) {
    if (variant.type) {
      terms.push(variant.type);
    }

    if (variant.size) {
      terms.push(variant.size);
    }

    if (variant.foil) {
      terms.push(variant.foil, tcgdexFoilSearchLabel(variant.foil));
    }

    for (const stamp of variant.stamp ?? []) {
      terms.push(stamp, tcgdexStampSearchLabel(stamp));
    }
  }

  return terms;
}

/**
 * TCGdex stores only the local numerator on a card record. Index the set's
 * official and total counts too so collector references such as `061/078`
 * remain searchable after punctuation is tokenized into `061` and `078`.
 */
export function tcgdexCollectorNumberSearchTerms(card: TcgdexCard) {
  return catalogueCollectorNumberSearchTerms(
    card.localId,
    card.set?.cardCount?.official,
    card.set?.cardCount?.total,
  );
}

function tcgdexFoilSearchLabel(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

  if (normalized === "pokeball") {
    return "Poke Ball Reverse Holofoil";
  }

  if (normalized === "masterball") {
    return "Master Ball Reverse Holofoil";
  }

  return value;
}

function tcgdexStampSearchLabel(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

  if (normalized === "pokemoncenter") {
    return "Pokémon Center Stamp";
  }

  if (normalized === "setlogo") {
    return "Set Logo Stamp";
  }

  return `${value} Stamp`;
}

function tcgdexImageUrl(value: string | undefined, size: "high" | "low") {
  if (!value) {
    return undefined;
  }

  return value.endsWith(".png") ? value : `${value}/${size}.png`;
}

function cardSubtypes(card: TcgdexCard) {
  return [card.stage, card.suffix, ...(card.types ?? [])].filter(Boolean) as string[];
}

function variantMetadata(card: TcgdexCard, language: string) {
  return compactJson({
    category: card.category,
    dexId: card.dexId,
    legal: card.legal,
    provider: "tcgdex",
    regulationMark: card.regulationMark,
    tcgdexLanguage: language,
    variants: card.variants,
    variantsDetailed: card.variants_detailed,
  });
}

function compactJson(value: Record<string, Prisma.InputJsonValue | undefined>): Prisma.InputJsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Prisma.InputJsonObject;
}

function positiveInteger(value: unknown) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return undefined;
  }

  return Math.floor(number);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
) {
  let index = 0;
  const results = new Array<R>(values.length);

  async function worker() {
    while (index < values.length) {
      const currentIndex = index;
      const value = values[currentIndex];

      index += 1;
      results[currentIndex] = await task(value);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );

  return results;
}
