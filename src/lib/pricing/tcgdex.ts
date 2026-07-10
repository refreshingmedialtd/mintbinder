import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { catalogueNameAliasesForText } from "@/lib/catalogue/name-aliases";
import {
  CATALOGUE_LANGUAGE_OPTIONS,
  catalogueLanguageLabel,
  catalogueLanguageSearchAliases,
  catalogueRegionForLanguage,
  catalogueRegionLabel,
  supportedTcgdexLanguages,
} from "@/lib/catalogue/languages";

type TcgdexCardBrief = {
  id: string;
  image?: string;
  localId?: string;
  name?: string;
};

type TcgdexCard = TcgdexCardBrief & {
  category?: string;
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
};

type SyncTcgdexCardsInput = {
  language?: string;
  maxPages?: number;
  page?: number;
  pageSize?: number;
};

export async function syncTcgdexCardPages({
  language = "ja",
  maxPages = 1,
  page = 1,
  pageSize = 50,
}: SyncTcgdexCardsInput = {}) {
  const resolvedLanguage = resolveTcgdexLanguage(language);
  const safePage = positiveInteger(page) ?? 1;
  const safePageSize = Math.min(positiveInteger(pageSize) ?? 50, 250);
  const safeMaxPages = Math.min(positiveInteger(maxPages) ?? 1, 20);
  const briefs = await fetchTcgdexCardList(resolvedLanguage.tcgdexCode);
  const startIndex = (safePage - 1) * safePageSize;
  const requested = briefs.slice(startIndex, startIndex + safePageSize * safeMaxPages);
  const setIds = new Set<string>();
  let cardsSkipped = 0;
  let cardsUpserted = 0;

  for (const brief of requested) {
    const detail = await fetchTcgdexCard(resolvedLanguage.tcgdexCode, brief.id);
    const card = { ...brief, ...detail };

    if (!card.name || !card.set?.id || !card.set.name) {
      cardsSkipped += 1;
      continue;
    }

    const setId = cardSetId(resolvedLanguage.code, card.set.id);
    const cardId = cardPrintingId(resolvedLanguage.code, card.id);
    const now = new Date().toISOString();

    setIds.add(setId);

    await prisma.cardSet.upsert({
      where: { id: setId },
      update: {
        language: resolvedLanguage.code,
        logoImageUrl: card.set.logo,
        metadata: compactJson({
          provider: "tcgdex",
          providerUpdatedAt: now,
          regionLabel: resolvedLanguage.regionLabel,
          tcgdexLanguage: resolvedLanguage.tcgdexCode,
        }),
        name: card.set.name,
        printedTotal: card.set.cardCount?.official,
        providerIds: providerIds(resolvedLanguage.code, card.set.id),
        region: resolvedLanguage.region,
        symbolImageUrl: card.set.symbol,
        total: card.set.cardCount?.total,
      },
      create: {
        id: setId,
        language: resolvedLanguage.code,
        logoImageUrl: card.set.logo,
        metadata: compactJson({
          provider: "tcgdex",
          providerUpdatedAt: now,
          regionLabel: resolvedLanguage.regionLabel,
          tcgdexLanguage: resolvedLanguage.tcgdexCode,
        }),
        name: card.set.name,
        printedTotal: card.set.cardCount?.official,
        providerIds: providerIds(resolvedLanguage.code, card.set.id),
        region: resolvedLanguage.region,
        symbolImageUrl: card.set.symbol,
        total: card.set.cardCount?.total,
      },
    });

    await prisma.cardPrinting.upsert({
      where: { id: cardId },
      update: {
        artist: card.illustrator,
        cardSetId: setId,
        imageLargeUrl: card.image,
        imageSmallUrl: card.image,
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
      },
      create: {
        id: cardId,
        artist: card.illustrator,
        cardSetId: setId,
        imageLargeUrl: card.image,
        imageSmallUrl: card.image,
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
      },
    });

    cardsUpserted += 1;
  }

  return {
    cardsFetched: requested.length,
    cardsSkipped,
    cardsUpserted,
    language: resolvedLanguage.code,
    languageLabel: resolvedLanguage.label,
    page: safePage,
    pageSize: safePageSize,
    provider: "tcgdex",
    setIds: [...setIds],
    setsUpserted: setIds.size,
    supportedLanguages: supportedTcgdexLanguages(),
    totalCount: briefs.length,
  };
}

async function fetchTcgdexCardList(language: string) {
  const data = await fetchTcgdexJson<TcgdexCardBrief[]>(`/${language}/cards`);

  return data.filter((card) => card.id);
}

async function fetchTcgdexCard(language: string, id: string) {
  return fetchTcgdexJson<TcgdexCard>(`/${language}/cards/${encodeURIComponent(id)}`);
}

async function fetchTcgdexJson<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.tcgdex.net/v2${path}`, {
    headers: { accept: "application/json" },
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
    card.set?.name,
    card.localId,
    card.rarity,
    card.category,
    card.stage,
    card.suffix,
    ...(card.types ?? []),
    ...catalogueNameAliasesForText(card.name),
    ...catalogueLanguageSearchAliases(language),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function cardSubtypes(card: TcgdexCard) {
  return [card.stage, card.suffix, ...(card.types ?? [])].filter(Boolean) as string[];
}

function variantMetadata(card: TcgdexCard, language: string) {
  return compactJson({
    category: card.category,
    legal: card.legal,
    provider: "tcgdex",
    regulationMark: card.regulationMark,
    tcgdexLanguage: language,
    variants: card.variants,
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
