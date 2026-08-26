import {
  CatalogueVisibility,
  CollectionEventType,
  GradingCompany,
  ItemCondition,
  ItemType as PrismaItemType,
  Prisma,
  SealedProductType,
  StorageLocationType,
  WishlistPriority,
} from "@prisma/client";
import { sampleAppData } from "../sample-data.ts";
import {
  buildCatalogueVariantOptions,
  catalogueValueMinorForVariant,
  pokemonTcgImageUrlFromProviderIds,
} from "../catalogue/variants.ts";
import { tcgdexJapaneseImageUrlFromProviderIds } from "../catalogue/tcgdex-images.ts";
import {
  catalogueDisplayCardForText,
  catalogueNameAliasesForText,
  catalogueDisplaySetForText,
  catalogueSearchTermsForQuery,
} from "../catalogue/name-aliases.ts";
import {
  catalogueLanguageCodesForSearch,
  catalogueLanguageLabel,
  catalogueRegionLabel,
  languageLabelToCode,
  normalizeCatalogueLanguageFilter,
} from "../catalogue/languages.ts";
import {
  catalogueSearchLookahead,
  normalizeCatalogueSearchLimit,
  normalizeCatalogueSearchOffset,
  paginateCatalogueResults,
} from "../catalogue/pagination.ts";
import {
  CATALOGUE_SET_MAX_ITEMS,
  normalizeCatalogueLookupIds,
} from "../catalogue/lookup.ts";
import { sortCatalogueSearchResults } from "../catalogue/search-order.ts";
import { compactCatalogueSearchHistory } from "../catalogue/search-payload.ts";
import { getEntitlements } from "../entitlements.ts";
import {
  normalizeCollectionQuantity,
  normalizeSaleQuantity,
  proportionalMinor,
  remainingMinor,
} from "../collection/mutations.ts";
import {
  lockCollectionItemsForBinderConsistency,
  reconcileBinderSlotsForQuantity,
} from "../binders/slot-reconciliation.ts";
import { getNotificationPreferences } from "../notifications/preferences.ts";
import {
  assertUserResourceQuota,
  lockUserResourceQuota,
  USER_RESOURCE_LIMITS,
  UserQuotaExceededError,
} from "./user-quotas.ts";
import { buildPriceHistory, priceInputsForGrade } from "../pricing/price-history.ts";
import {
  effectivePriceConfidence,
  preferredLatestPricePoint,
  priceFreshnessStatus,
  priceMarketForSource,
} from "../pricing/market-context.ts";
import {
  customerVisiblePriceSource,
  priceChartingLicenceConfirmed,
} from "../pricing/provider-permissions.mjs";
import {
  collectionItemValueMinor as exactCollectionItemValueMinor,
} from "../valuation.ts";
import type {
  AppCatalogueData,
  AppCatalogueSearchData,
  AppData,
  AppDashboardData,
  CatalogueItem,
  CollectionEvent as ClientCollectionEvent,
  CollectionItem,
  ItemType,
  SetProgress,
  StorageLocation,
  WishlistItem,
} from "../types.ts";
import { prisma } from "./prisma.ts";
import {
  assertAppDataDatabaseConfigured,
  resolveAppDataFallbackMode,
  shouldThrowAppDataReadError,
  type AppDataFallbackMode,
} from "./app-data-fallback.ts";
import { visibleSealedProductWhere, visibleSealedProductsWhere } from "./visibility.ts";
import {
  boundedOptionalText,
  boundedRequiredText,
  moneyInputToMinor,
  PERSISTED_INPUT_LIMITS,
} from "./input-validation.ts";

type PriceLike = {
  priceMinor: number;
  confidenceScore: number;
  source: string;
  sourceRef?: string | null;
  observedAt: Date;
  variantLabel: string | null;
  gradedCompany: string | null;
  gradedScore: number | string | { toString(): string } | null;
};

type CatalogueScope = "referenced";

type CatalogueSearchInput = {
  language?: string;
  limit?: number;
  offset?: number;
  q?: string;
  rarity?: string;
  set?: string;
  sort?: string;
  type?: string;
};

type CatalogueSearchType = ItemType | "all";

type NormalizedCatalogueSearchInput = {
  language: string;
  limit: number;
  offset: number;
  q: string;
  rarity: string;
  set: string;
  sort: string;
  type: CatalogueSearchType;
};

type OrderedCatalogueId = {
  id: string;
};

type AppDataOptions = {
  catalogueScope?: CatalogueScope;
  eventLimit?: number;
  eventTypes?: CollectionEventType[];
  fallback?: AppDataFallbackMode;
};

type CardPrintingWithPrices = {
  id: string;
  name: string;
  language: string;
  region: string;
  number: string;
  rarity: string | null;
  imageLargeUrl: string | null;
  imageSmallUrl: string | null;
  providerIds: unknown;
  variantMetadata: unknown;
  cardSet: { id: string; name: string; language?: string | null; providerIds?: unknown };
  priceSnapshots: PriceLike[];
};

type SealedProductWithPrices = {
  id: string;
  name: string;
  productType: string;
  imageUrl: string | null;
  relatedCardSet: { name: string } | null;
  priceSnapshots: PriceLike[];
};

type CatalogueReferenceRecord = {
  cardPrinting: CardPrintingWithPrices | null;
  sealedProduct: SealedProductWithPrices | null;
};

type ReferencedPriceSnapshot = PriceLike & {
  cardPrintingId: string | null;
  sealedProductId: string | null;
};

const PRICE_HISTORY_LIMIT = 8;
const restrictedPriceChartingSources = [
  "pricecharting-graded-card",
  "pricecharting-sealed",
];

function customerVisiblePriceSnapshotWhere({ rawCard = false } = {}): Prisma.PriceSnapshotWhereInput {
  return {
    ...(rawCard ? { gradedCompany: null } : {}),
    ...(!priceChartingLicenceConfirmed()
      ? { source: { notIn: restrictedPriceChartingSources } }
      : {}),
  };
}

function customerVisiblePriceSnapshotSql() {
  return priceChartingLicenceConfirmed()
    ? Prisma.empty
    : Prisma.sql`AND ps.source NOT IN ('pricecharting-graded-card', 'pricecharting-sealed')`;
}

const catalogueSearchPriceSelect = {
  priceMinor: true,
  confidenceScore: true,
  source: true,
  sourceRef: true,
  observedAt: true,
  variantLabel: true,
  gradedCompany: true,
  gradedScore: true,
} satisfies Prisma.PriceSnapshotSelect;

const catalogueSearchCardSelect = {
  id: true,
  name: true,
  language: true,
  region: true,
  number: true,
  rarity: true,
  supertype: true,
  imageLargeUrl: true,
  imageSmallUrl: true,
  providerIds: true,
  variantMetadata: true,
  cardSet: {
    select: {
      id: true,
      name: true,
      language: true,
      region: true,
      providerIds: true,
    },
  },
  priceSnapshots: {
    where: customerVisiblePriceSnapshotWhere({ rawCard: true }),
    orderBy: [{ observedAt: "desc" as const }, { createdAt: "desc" as const }],
    take: PRICE_HISTORY_LIMIT,
    select: catalogueSearchPriceSelect,
  },
} satisfies Prisma.CardPrintingSelect;

const catalogueSearchSealedSelect = {
  id: true,
  name: true,
  productType: true,
  imageUrl: true,
  relatedCardSet: { select: { name: true } },
  priceSnapshots: {
    where: customerVisiblePriceSnapshotWhere(),
    orderBy: [{ observedAt: "desc" as const }, { createdAt: "desc" as const }],
    take: PRICE_HISTORY_LIMIT,
    select: catalogueSearchPriceSelect,
  },
} satisfies Prisma.SealedProductSelect;

export type CreateCollectionItemInput = {
  catalogueId: string;
  quantity?: number;
  condition?: string;
  language?: string;
  variant?: string;
  paid?: string;
  purchaseDate?: string;
  overrideValue?: string;
  valuationNote?: string;
  location?: string;
  notes?: string;
};

export type UpdateCollectionItemInput = Omit<CreateCollectionItemInput, "catalogueId"> & {
  gradeCompany?: string;
  gradeScore?: string;
};

export type SellCollectionItemInput = {
  amount?: string;
  occurredAt?: string;
  quantity?: number;
  notes?: string;
};

export type CreateStorageLocationInput = {
  name?: string;
  type?: string;
  notes?: string;
};

export type UpdateStorageLocationInput = CreateStorageLocationInput;

export type CreateSealedProductInput = {
  name?: string;
  productType?: string;
  relatedSetId?: string;
  estimatedValue?: string;
  notes?: string;
};

export type UpdateWishlistItemInput = {
  variant?: string;
  priority?: string;
  targetPrice?: string;
  notes?: string;
};

export class AppMutationError extends Error {
  status: number;

  constructor(message: string, status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "AppMutationError";
    this.status = status;
  }
}

function sampleDataFallback(notice: string): AppData {
  return {
    ...sampleAppData,
    catalogueComplete: true,
    notice,
  };
}

export async function getAppData(userId: string, options: AppDataOptions = {}): Promise<AppData> {
  const fallback = resolveAppDataFallbackMode(options.fallback);
  assertAppDataDatabaseConfigured(process.env.DATABASE_URL, fallback);

  if (!process.env.DATABASE_URL) {
    return sampleDataFallback("Using sample data because DATABASE_URL is not configured.");
  }

  try {
    const [
      subscription,
      notificationPreferences,
      collectionItems,
      wishlistItems,
      cardSets,
      cardSetCounts,
      ownedCardRows,
      storageLocations,
      collectionEvents,
    ] =
      await Promise.all([
        getEntitlements(userId),
        getNotificationPreferences(userId, {
          fallback: fallback === "throw" ? "throw" : "default",
        }),
        prisma.collectionItem.findMany({
          where: {
            userId,
            archivedAt: null,
          },
          include: collectionItemInclude,
          orderBy: { createdAt: "asc" },
        }),
        prisma.wishlistItem.findMany({
          where: { userId },
          include: {
            cardPrinting: {
              include: {
                cardSet: true,
                priceSnapshots: {
                  where: customerVisiblePriceSnapshotWhere(),
                  orderBy: { observedAt: "desc" },
                  take: PRICE_HISTORY_LIMIT,
                },
              },
            },
            sealedProduct: {
              include: {
                relatedCardSet: true,
                priceSnapshots: {
                  where: customerVisiblePriceSnapshotWhere(),
                  orderBy: { observedAt: "desc" },
                  take: PRICE_HISTORY_LIMIT,
                },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.cardSet.findMany({
          orderBy: { releaseDate: "desc" },
        }),
        prisma.cardPrinting.groupBy({
          by: ["cardSetId"],
          _count: { _all: true },
        }),
        prisma.collectionItem.findMany({
          where: {
            userId,
            archivedAt: null,
            cardPrintingId: { not: null },
          },
          select: {
            cardPrintingId: true,
            cardPrinting: {
              select: { cardSetId: true },
            },
          },
        }),
        prisma.storageLocation.findMany({
          where: { userId },
          orderBy: { name: "asc" },
        }),
        prisma.collectionEvent.findMany({
          where: {
            userId,
            ...(options.eventTypes?.length ? { eventType: { in: options.eventTypes } } : {}),
          },
          include: collectionEventInclude,
          orderBy: { occurredAt: "desc" },
          take: options.eventLimit ?? 12,
        }),
      ]);

    await hydrateReferencedPriceSnapshotsByIdentity([
      ...(collectionItems as unknown as CatalogueReferenceRecord[]),
      ...(wishlistItems as unknown as CatalogueReferenceRecord[]),
    ]);

    const cardSetTotals = new Map(cardSetCounts.map((row) => [row.cardSetId, row._count._all]));
    const ownedCardsBySet = ownedCardCountsBySet(ownedCardRows);
    const catalogue = referencedCatalogueItems(collectionItems, wishlistItems);
    const collection = collectionItems.map(mapCollectionItem);

    return {
      catalogue,
      catalogueComplete: false,
      collection,
      wishlist: wishlistItems.map(mapWishlistItem),
      sets: cardSets.map((set) =>
        mapSetProgress(set, {
          owned: ownedCardsBySet.get(set.id) ?? 0,
          total: cardSetTotals.get(set.id) ?? 0,
        }),
      ),
      storageLocations: mapStorageLocations(storageLocations, collection, catalogue),
      events: collectionEvents.map(mapCollectionEvent),
      source: "database",
      subscription,
      notificationPreferences,
    };
  } catch (error) {
    if (shouldThrowAppDataReadError(fallback)) {
      throw error;
    }

    console.warn("Falling back to sample data after Prisma read failed.", error);
    return sampleDataFallback("Using sample data because the database could not be reached.");
  }
}

export async function lookupCatalogueData(userId: string, input: unknown): Promise<AppCatalogueData> {
  const ids = normalizeCatalogueLookupIds(input);
  const fallback = resolveAppDataFallbackMode();
  assertAppDataDatabaseConfigured(process.env.DATABASE_URL, fallback);

  if (!process.env.DATABASE_URL) {
    const catalogueById = new Map(sampleAppData.catalogue.map((item) => [item.id, item]));

    return {
      catalogue: ids.flatMap((id) => {
        const item = catalogueById.get(id);
        return item ? [item] : [];
      }),
      notice: "Using sample data because DATABASE_URL is not configured.",
      source: sampleAppData.source,
    };
  }

  try {
    const [cards, sealed] = await Promise.all([
      hydrateCardPrintingsByOrderedIds(ids),
      hydrateSealedProductsByOrderedIds(userId, ids),
    ]);
    const catalogueById = new Map([...cards, ...sealed].map((item) => [item.id, item]));

    return {
      catalogue: ids.flatMap((id) => {
        const item = catalogueById.get(id);
        return item ? [item] : [];
      }),
      source: "database",
    };
  } catch (error) {
    if (shouldThrowAppDataReadError(fallback)) throw error;
    console.warn("Falling back to sample catalogue lookup after Prisma read failed.", error);
    const catalogueById = new Map(sampleAppData.catalogue.map((item) => [item.id, item]));

    return {
      catalogue: ids.flatMap((id) => {
        const item = catalogueById.get(id);
        return item ? [item] : [];
      }),
      notice: "Using sample data because the database catalogue lookup could not be reached.",
      source: sampleAppData.source,
    };
  }
}

export async function getCatalogueSetData(setName: string, setId?: string | null): Promise<AppCatalogueData> {
  const normalizedSetName = normalizeOptionalText(setName);
  const normalizedSetId = normalizeOptionalText(setId ?? undefined);
  const fallback = resolveAppDataFallbackMode();
  assertAppDataDatabaseConfigured(process.env.DATABASE_URL, fallback);

  if (!process.env.DATABASE_URL) {
    const catalogue = sampleAppData.catalogue
      .filter((item) => item.type === "card" && item.set === normalizedSetName)
      .slice(0, CATALOGUE_SET_MAX_ITEMS);

    return {
      catalogue,
      notice: "Using sample data because DATABASE_URL is not configured.",
      source: sampleAppData.source,
    };
  }

  if (!normalizedSetName && !normalizedSetId) {
    return {
      catalogue: [],
      source: "database",
    };
  }

  try {
    const cards = await prisma.cardPrinting.findMany({
      where: normalizedSetId ? { cardSetId: normalizedSetId } : { cardSet: { name: normalizedSetName } },
      include: {
        cardSet: true,
        priceSnapshots: {
          where: customerVisiblePriceSnapshotWhere({ rawCard: true }),
          orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
          take: PRICE_HISTORY_LIMIT,
        },
      },
      orderBy: [{ number: "asc" }, { name: "asc" }],
      take: CATALOGUE_SET_MAX_ITEMS,
    });

    return {
      catalogue: sortCatalogueSearchResults(
        cards.map((card) => mapCardPrintingToCatalogueItem(card, card.priceSnapshots)),
        "set-number-asc",
      ),
      source: "database",
    };
  } catch (error) {
    if (shouldThrowAppDataReadError(fallback)) throw error;
    console.warn("Falling back to sample set catalogue after Prisma read failed.", error);
    return {
      catalogue: sampleAppData.catalogue
        .filter((item) => item.type === "card" && item.set === normalizedSetName)
        .slice(0, CATALOGUE_SET_MAX_ITEMS),
      notice: "Using sample data because the database set catalogue could not be reached.",
      source: sampleAppData.source,
    };
  }
}

export async function getDashboardData(userId: string): Promise<AppDashboardData> {
  const data = await getAppData(userId, { catalogueScope: "referenced" });

  return {
    ...data,
    dashboard: {
      generatedAt: new Date().toISOString(),
      summary: dashboardSummary(data),
    },
  };
}

export async function searchCatalogueData(
  userId: string,
  input: CatalogueSearchInput,
): Promise<AppCatalogueSearchData> {
  const query = normalizeCatalogueSearchInput(input);
  const fallback = resolveAppDataFallbackMode();
  assertAppDataDatabaseConfigured(process.env.DATABASE_URL, fallback);

  if (!process.env.DATABASE_URL) {
    const catalogue = filterAndSortCatalogue(sampleAppData.catalogue, query);
    const page = paginateCatalogueResults(catalogue, query);

    return {
      ...page,
      query,
      resultCount: page.returned,
      source: sampleAppData.source,
      notice: "Using sample data because DATABASE_URL is not configured.",
    };
  }

  try {
    const catalogue = await searchCatalogueItems(userId, query);
    const page = paginateCatalogueResults(catalogue, query);

    return {
      ...page,
      query,
      resultCount: page.returned,
      source: "database",
    };
  } catch (error) {
    if (shouldThrowAppDataReadError(fallback)) throw error;
    console.warn("Falling back to sample catalogue search after Prisma read failed.", error);
    const catalogue = filterAndSortCatalogue(sampleAppData.catalogue, query);
    const page = paginateCatalogueResults(catalogue, query);

    return {
      ...page,
      query,
      resultCount: page.returned,
      source: sampleAppData.source,
      notice: "Using sample data because the database catalogue search could not be reached.",
    };
  }
}

async function searchCatalogueItems(
  userId: string,
  query: NormalizedCatalogueSearchInput,
): Promise<CatalogueItem[]> {
  if (query.type === "card") {
    return searchCardPrintings(query);
  }

  if (query.type === "sealed") {
    return searchSealedProducts(userId, query);
  }

  const [cards, sealed] = await Promise.all([
    searchCardPrintings({ ...query, type: "card" }),
    searchSealedProducts(userId, { ...query, language: "all", type: "sealed" }),
  ]);

  return sortCatalogueSearchResults([...cards, ...sealed], query.sort);
}

async function searchCardPrintings(query: NormalizedCatalogueSearchInput): Promise<CatalogueItem[]> {
  if (isCatalogueValueSort(query.sort)) {
    return searchCardPrintingsByValue(query);
  }

  const filters: Prisma.CardPrintingWhereInput[] = [];

  if (query.q) {
    const languageCodes = catalogueLanguageCodesForSearch(query.q);
    const searchTerms = catalogueSearchTermsForQuery(query.q);
    const searchFilters = searchTerms.flatMap((term): Prisma.CardPrintingWhereInput[] => [
      { searchText: { contains: term, mode: "insensitive" } },
      { name: { contains: term, mode: "insensitive" } },
      { number: { contains: term, mode: "insensitive" } },
      { rarity: { contains: term, mode: "insensitive" } },
      { cardSet: { name: { contains: term, mode: "insensitive" } } },
    ]);

    filters.push({
      OR: [
        ...searchFilters,
        ...(languageCodes.length ? [{ language: { in: languageCodes } }] : []),
      ],
    });
  }

  if (query.set !== "all") {
    filters.push({ cardSet: { name: query.set } });
  }

  if (query.rarity !== "all") {
    filters.push({ rarity: query.rarity });
  }

  if (query.language !== "all") {
    filters.push({ language: query.language });
  }

  const cards = await prisma.cardPrinting.findMany({
    where: filters.length ? { AND: filters } : undefined,
    select: catalogueSearchCardSelect,
    orderBy: cardCatalogueSearchOrderBy(query.sort),
    take: catalogueSearchFetchLimit(query),
  });
  const catalogue = cards.map(mapCatalogueSearchCard);

  return sortCatalogueSearchResults(catalogue, query.sort);
}

async function searchSealedProducts(
  userId: string,
  query: NormalizedCatalogueSearchInput,
): Promise<CatalogueItem[]> {
  if (isCatalogueValueSort(query.sort)) {
    return searchSealedProductsByValue(userId, query);
  }

  const filters: Prisma.SealedProductWhereInput[] = [visibleSealedProductsWhere(userId)];

  if (query.q) {
    const productType = sealedProductTypeFromSearchTerm(query.q);
    filters.push({
      OR: [
        { name: { contains: query.q, mode: "insensitive" } },
        { relatedCardSet: { name: { contains: query.q, mode: "insensitive" } } },
        ...(productType ? [{ productType: { equals: productType } }] : []),
      ],
    });
  }

  if (query.set !== "all") {
    filters.push({ relatedCardSet: { name: query.set } });
  }

  if (query.rarity !== "all") {
    filters.push({ productType: sealedProductTypeToEnum(query.rarity) });
  }

  const products = await prisma.sealedProduct.findMany({
    where: { AND: filters },
    select: catalogueSearchSealedSelect,
    orderBy: sealedCatalogueSearchOrderBy(query.sort),
    take: catalogueSearchFetchLimit(query),
  });
  const catalogue = products.map(mapCatalogueSearchSealed);

  return sortCatalogueSearchResults(catalogue, query.sort);
}

async function searchCardPrintingsByValue(query: NormalizedCatalogueSearchInput): Promise<CatalogueItem[]> {
  const rows = await prisma.$queryRaw<OrderedCatalogueId[]>(Prisma.sql`
    SELECT cp.id
    FROM card_printings cp
    JOIN card_sets cs ON cs.id = cp.card_set_id
    LEFT JOIN LATERAL (
      SELECT recent.price_minor
      FROM (
        SELECT
          ps.price_minor,
          ps.source,
          ps.observed_at,
          ps.confidence_score,
          ps.created_at,
          ps.graded_company
        FROM price_snapshots ps
        WHERE ps.card_printing_id = cp.id
          AND ps.item_type = 'card'::item_type
          AND ps.graded_company IS NULL
          ${customerVisiblePriceSnapshotSql()}
        ORDER BY ps.observed_at DESC, ps.created_at DESC
        LIMIT ${PRICE_HISTORY_LIMIT}
      ) recent
      WHERE recent.graded_company IS NULL
      ORDER BY
        CASE
          WHEN recent.observed_at >= CURRENT_TIMESTAMP -
            CASE WHEN recent.price_minor >= 10000 THEN INTERVAL '7 days' ELSE INTERVAL '14 days' END
          THEN 1 ELSE 0
        END DESC,
        CASE
          WHEN recent.observed_at < CURRENT_TIMESTAMP -
            CASE WHEN recent.price_minor >= 10000 THEN INTERVAL '7 days' ELSE INTERVAL '14 days' END
          THEN 0
          WHEN LOWER(BTRIM(recent.source)) LIKE 'pulse-uk%'
            OR LOWER(BTRIM(recent.source)) LIKE 'uk-market%'
            OR LOWER(BTRIM(recent.source)) LIKE 'ebay-uk%' THEN 4
          WHEN LOWER(BTRIM(recent.source)) LIKE '%cardmarket%'
            OR LOWER(BTRIM(recent.source)) LIKE '%cardtrader%' THEN 3
          WHEN LOWER(BTRIM(recent.source)) = 'pokemon-tcg-api'
            OR LOWER(BTRIM(recent.source)) LIKE 'tcgcsv%'
            OR LOWER(BTRIM(recent.source)) LIKE 'pricecharting%' THEN 2
          ELSE 1
        END DESC,
        recent.observed_at DESC,
        recent.confidence_score DESC,
        recent.created_at DESC
      LIMIT 1
    ) lp ON TRUE
    ${cardCatalogueSearchWhere(query)}
    ORDER BY
      CASE WHEN lp.price_minor IS NULL THEN 1 ELSE 0 END ASC,
      lp.price_minor ${catalogueValueSortDirection(query.sort)},
      cp.name ASC,
      cp.number ASC,
      cp.id ASC
    LIMIT ${catalogueSearchFetchLimit(query)}
  `);

  return hydrateCardPrintingsByOrderedIds(rows.map((row) => row.id));
}

async function searchSealedProductsByValue(
  userId: string,
  query: NormalizedCatalogueSearchInput,
): Promise<CatalogueItem[]> {
  const rows = await prisma.$queryRaw<OrderedCatalogueId[]>(Prisma.sql`
    SELECT sp.id
    FROM sealed_products sp
    LEFT JOIN card_sets cs ON cs.id = sp.related_card_set_id
    LEFT JOIN LATERAL (
      SELECT recent.price_minor
      FROM (
        SELECT
          ps.price_minor,
          ps.source,
          ps.observed_at,
          ps.confidence_score,
          ps.created_at
        FROM price_snapshots ps
        WHERE ps.sealed_product_id = sp.id
          AND ps.item_type = 'sealed_product'::item_type
          ${customerVisiblePriceSnapshotSql()}
        ORDER BY ps.observed_at DESC, ps.created_at DESC
        LIMIT ${PRICE_HISTORY_LIMIT}
      ) recent
      ORDER BY
        CASE
          WHEN recent.observed_at >= CURRENT_TIMESTAMP -
            CASE WHEN recent.price_minor >= 10000 THEN INTERVAL '7 days' ELSE INTERVAL '14 days' END
          THEN 1 ELSE 0
        END DESC,
        CASE
          WHEN recent.observed_at < CURRENT_TIMESTAMP -
            CASE WHEN recent.price_minor >= 10000 THEN INTERVAL '7 days' ELSE INTERVAL '14 days' END
          THEN 0
          WHEN LOWER(BTRIM(recent.source)) LIKE 'pulse-uk%'
            OR LOWER(BTRIM(recent.source)) LIKE 'uk-market%'
            OR LOWER(BTRIM(recent.source)) LIKE 'ebay-uk%' THEN 4
          WHEN LOWER(BTRIM(recent.source)) LIKE '%cardmarket%'
            OR LOWER(BTRIM(recent.source)) LIKE '%cardtrader%' THEN 3
          WHEN LOWER(BTRIM(recent.source)) = 'pokemon-tcg-api'
            OR LOWER(BTRIM(recent.source)) LIKE 'tcgcsv%'
            OR LOWER(BTRIM(recent.source)) LIKE 'pricecharting%' THEN 2
          ELSE 1
        END DESC,
        recent.observed_at DESC,
        recent.confidence_score DESC,
        recent.created_at DESC
      LIMIT 1
    ) lp ON TRUE
    ${sealedCatalogueSearchWhere(userId, query)}
    ORDER BY
      CASE WHEN lp.price_minor IS NULL THEN 1 ELSE 0 END ASC,
      lp.price_minor ${catalogueValueSortDirection(query.sort)},
      sp.name ASC,
      sp.id ASC
    LIMIT ${catalogueSearchFetchLimit(query)}
  `);

  return hydrateSealedProductsByOrderedIds(userId, rows.map((row) => row.id));
}

async function hydrateCardPrintingsByOrderedIds(ids: string[]): Promise<CatalogueItem[]> {
  if (!ids.length) {
    return [];
  }

  const order = new Map(ids.map((id, index) => [id, index]));
  const cards = await prisma.cardPrinting.findMany({
    where: { id: { in: ids } },
    select: catalogueSearchCardSelect,
  });

  return cards
    .map(mapCatalogueSearchCard)
    .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
}

async function hydrateSealedProductsByOrderedIds(
  userId: string,
  ids: string[],
): Promise<CatalogueItem[]> {
  if (!ids.length) {
    return [];
  }

  const order = new Map(ids.map((id, index) => [id, index]));
  const products = await prisma.sealedProduct.findMany({
    where: visibleSealedProductsWhere(userId, ids),
    select: catalogueSearchSealedSelect,
  });

  return products
    .map(mapCatalogueSearchSealed)
    .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
}

function referencedCatalogueItems(
  collectionItems: CatalogueReferenceRecord[],
  wishlistItems: CatalogueReferenceRecord[],
): CatalogueItem[] {
  const byId = new Map<string, CatalogueItem>();

  for (const record of [...collectionItems, ...wishlistItems]) {
    const item = record.cardPrinting
      ? mapCardPrintingToCatalogueItem(
          record.cardPrinting,
          record.cardPrinting.priceSnapshots,
          { includeGradedHistory: true },
        )
      : record.sealedProduct
        ? mapSealedProductToCatalogueItem(record.sealedProduct, record.sealedProduct.priceSnapshots)
        : null;

    if (item) {
      byId.set(item.id, item);
    }
  }

  return Array.from(byId.values());
}

/**
 * Prisma's nested `take` is global to a printing, so active variants or raw
 * imports can crowd an owned grade out of the last few rows. Fetch a bounded
 * history per exact source/variant/grade stream for only the catalogue items
 * referenced by this tenant, then reuse it for dashboard, storage and exports.
 */
async function hydrateReferencedPriceSnapshotsByIdentity(records: CatalogueReferenceRecord[]) {
  const cardIds = [...new Set(records.flatMap((record) => record.cardPrinting?.id ?? []))];
  const sealedIds = [...new Set(records.flatMap((record) => record.sealedProduct?.id ?? []))];

  if (!cardIds.length && !sealedIds.length) {
    return;
  }

  const scopes: Prisma.Sql[] = [];

  if (cardIds.length) {
    scopes.push(Prisma.sql`"card_printing_id" IN (${Prisma.join(
      cardIds.map((id) => Prisma.sql`${id}::uuid`),
    )})`);
  }

  if (sealedIds.length) {
    scopes.push(Prisma.sql`"sealed_product_id" IN (${Prisma.join(
      sealedIds.map((id) => Prisma.sql`${id}::uuid`),
    )})`);
  }

  const priceChartingFilter = priceChartingLicenceConfirmed()
    ? Prisma.empty
    : Prisma.sql`AND "source" NOT IN ('pricecharting-sealed', 'pricecharting-graded-card')`;
  const rows = await prisma.$queryRaw<ReferencedPriceSnapshot[]>(Prisma.sql`
    WITH "ranked_prices" AS (
      SELECT
        "card_printing_id" AS "cardPrintingId",
        "sealed_product_id" AS "sealedProductId",
        "price_minor" AS "priceMinor",
        "confidence_score" AS "confidenceScore",
        "source",
        "source_ref" AS "sourceRef",
        "observed_at" AS "observedAt",
        "variant_label" AS "variantLabel",
        "graded_company" AS "gradedCompany",
        "graded_score" AS "gradedScore",
        ROW_NUMBER() OVER (
          PARTITION BY
            "item_type",
            "card_printing_id",
            "sealed_product_id",
            "source",
            COALESCE("variant_label", ''),
            COALESCE("graded_company"::text, ''),
            COALESCE("graded_score"::text, '')
          ORDER BY "observed_at" DESC, "created_at" DESC
        ) AS "identityRank"
      FROM "price_snapshots"
      WHERE (${Prisma.join(scopes, " OR ")})
        AND "currency" = 'GBP'
        AND (
          (
            "item_type" = 'card'::item_type
            AND ("condition" IS NULL OR "condition"::text = 'near_mint')
          )
          OR
          (
            "item_type" = 'sealed_product'::item_type
            AND ("condition" IS NULL OR "condition"::text = 'sealed')
          )
        )
        ${priceChartingFilter}
    )
    SELECT
      "cardPrintingId",
      "sealedProductId",
      "priceMinor",
      "confidenceScore",
      "source",
      "sourceRef",
      "observedAt",
      "variantLabel",
      "gradedCompany",
      "gradedScore"
    FROM "ranked_prices"
    WHERE "identityRank" <= ${PRICE_HISTORY_LIMIT}
    ORDER BY "observedAt" DESC
  `);
  const byCard = groupReferencedPrices(rows, "cardPrintingId");
  const bySealed = groupReferencedPrices(rows, "sealedProductId");

  for (const record of records) {
    if (record.cardPrinting) {
      record.cardPrinting.priceSnapshots = byCard.get(record.cardPrinting.id) ?? [];
    }

    if (record.sealedProduct) {
      record.sealedProduct.priceSnapshots = bySealed.get(record.sealedProduct.id) ?? [];
    }
  }
}

function groupReferencedPrices(
  rows: ReferencedPriceSnapshot[],
  key: "cardPrintingId" | "sealedProductId",
) {
  const grouped = new Map<string, PriceLike[]>();

  for (const row of rows) {
    const id = row[key];

    if (id) {
      grouped.set(id, [...(grouped.get(id) ?? []), row]);
    }
  }

  return grouped;
}

function ownedCardCountsBySet(
  rows: Array<{
    cardPrintingId: string | null;
    cardPrinting: { cardSetId: string } | null;
  }>,
) {
  const countedPrintings = new Set<string>();
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (!row.cardPrintingId || !row.cardPrinting || countedPrintings.has(row.cardPrintingId)) {
      continue;
    }

    countedPrintings.add(row.cardPrintingId);
    counts.set(row.cardPrinting.cardSetId, (counts.get(row.cardPrinting.cardSetId) ?? 0) + 1);
  }

  return counts;
}

function normalizeCatalogueSearchInput(input: CatalogueSearchInput): NormalizedCatalogueSearchInput {
  return {
    language: normalizeCatalogueLanguageFilter(input.language),
    limit: normalizeCatalogueSearchLimit(input.limit),
    offset: normalizeCatalogueSearchOffset(input.offset),
    q: normalizeOptionalText(input.q) ?? "",
    rarity: normalizeCatalogueFacet(input.rarity),
    set: normalizeCatalogueFacet(input.set),
    sort: normalizeCatalogueSort(input.sort),
    type: normalizeCatalogueSearchType(input.type),
  };
}

function normalizeCatalogueSearchType(value?: string): CatalogueSearchType {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "card" || normalized === "sealed") {
    return normalized;
  }

  return "all";
}

function normalizeCatalogueFacet(value?: string) {
  const normalized = normalizeOptionalText(value);

  return normalized && normalized.toLowerCase() !== "all" ? normalized : "all";
}

function normalizeCatalogueSort(value?: string) {
  const normalized = value?.trim();
  const allowed = new Set([
    "name-asc",
    "name-desc",
    "rarity",
    "set-number-asc",
    "set-number-desc",
    "value-asc",
    "value-desc",
  ]);

  return normalized && allowed.has(normalized) ? normalized : "value-desc";
}

function catalogueSearchFetchLimit(query: NormalizedCatalogueSearchInput) {
  return catalogueSearchLookahead(query);
}

function cardCatalogueSearchOrderBy(sort: string): Prisma.CardPrintingOrderByWithRelationInput[] {
  if (sort === "name-desc") {
    return [{ name: "desc" }, { id: "desc" }];
  }

  if (sort === "rarity") {
    return [{ rarity: { sort: "asc", nulls: "last" } }, { name: "asc" }, { id: "asc" }];
  }

  if (sort === "set-number-asc") {
    return [{ cardSet: { name: "asc" } }, { number: "asc" }, { id: "asc" }];
  }

  if (sort === "set-number-desc") {
    return [{ cardSet: { name: "desc" } }, { number: "desc" }, { id: "desc" }];
  }

  return [{ name: "asc" }, { id: "asc" }];
}

function sealedCatalogueSearchOrderBy(sort: string): Prisma.SealedProductOrderByWithRelationInput[] {
  if (sort === "name-desc") {
    return [{ name: "desc" }, { id: "desc" }];
  }

  if (sort === "rarity") {
    return [{ productType: "asc" }, { name: "asc" }, { id: "asc" }];
  }

  if (sort === "set-number-asc") {
    return [{ relatedCardSet: { name: "asc" } }, { name: "asc" }, { id: "asc" }];
  }

  if (sort === "set-number-desc") {
    return [{ relatedCardSet: { name: "desc" } }, { name: "desc" }, { id: "desc" }];
  }

  return [{ name: "asc" }, { id: "asc" }];
}

function isCatalogueValueSort(sort: string) {
  return sort === "value-asc" || sort === "value-desc";
}

function catalogueValueSortDirection(sort: string) {
  return sort === "value-asc" ? Prisma.raw("ASC") : Prisma.raw("DESC");
}

function cardCatalogueSearchWhere(query: NormalizedCatalogueSearchInput) {
  const filters: Prisma.Sql[] = [];

  if (query.q) {
    const patterns = catalogueSearchTermsForQuery(query.q).map((term) => `%${term}%`);
    const languageCodes = catalogueLanguageCodesForSearch(query.q);
    const textFilters = patterns.map((pattern) => Prisma.sql`(
      cp.search_text ILIKE ${pattern}
      OR cp.name ILIKE ${pattern}
      OR cp.number ILIKE ${pattern}
      OR cp.rarity ILIKE ${pattern}
      OR cs.name ILIKE ${pattern}
    )`);

    filters.push(Prisma.sql`(
      ${Prisma.join(textFilters, " OR ")}
      ${languageCodes.length ? Prisma.sql`OR cp.language IN (${Prisma.join(languageCodes)})` : Prisma.empty}
    )`);
  }

  if (query.set !== "all") {
    filters.push(Prisma.sql`cs.name = ${query.set}`);
  }

  if (query.rarity !== "all") {
    filters.push(Prisma.sql`cp.rarity = ${query.rarity}`);
  }

  if (query.language !== "all") {
    filters.push(Prisma.sql`cp.language = ${query.language}`);
  }

  return filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;
}

function sealedCatalogueSearchWhere(userId: string, query: NormalizedCatalogueSearchInput) {
  const filters: Prisma.Sql[] = [
    Prisma.sql`(
      sp.visibility = 'global'::catalogue_visibility
      OR sp.created_by_user_id = ${userId}::uuid
    )`,
  ];

  if (query.q) {
    const pattern = `%${query.q}%`;
    const productType = sealedProductTypeFromSearchTerm(query.q);

    filters.push(Prisma.sql`(
      sp.name ILIKE ${pattern}
      OR cs.name ILIKE ${pattern}
      ${productType ? Prisma.sql`OR sp.product_type = ${sealedProductTypeDbValue(productType)}::sealed_product_type` : Prisma.empty}
    )`);
  }

  if (query.set !== "all") {
    filters.push(Prisma.sql`cs.name = ${query.set}`);
  }

  if (query.rarity !== "all") {
    filters.push(Prisma.sql`sp.product_type = ${sealedProductTypeDbValue(sealedProductTypeToEnum(query.rarity))}::sealed_product_type`);
  }

  return Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;
}

function filterAndSortCatalogue(
  catalogue: CatalogueItem[],
  query: NormalizedCatalogueSearchInput,
): CatalogueItem[] {
  const normalizedSearch = query.q.toLowerCase();

  return sortCatalogueSearchResults(
    catalogue.filter((item) => {
      if (query.type !== "all" && item.type !== query.type) {
        return false;
      }

      if (query.set !== "all" && item.set !== query.set) {
        return false;
      }

      if (query.rarity !== "all" && item.rarity !== query.rarity) {
        return false;
      }

      if (query.language !== "all" && item.type === "card" && (item.language ?? "en") !== query.language) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [
        item.name,
        ...catalogueNameAliasesForText(item.name),
        item.set,
        item.number,
        item.rarity,
        item.language,
        item.languageLabel,
        item.regionLabel,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    }),
    query.sort,
  );
}

function dashboardSummary(data: AppData) {
  const catalogueById = new Map(data.catalogue.map((item) => [item.id, item]));
  const collectionSummary = data.collection.reduce(
    (summary, item) => {
      const catalogueItem = catalogueById.get(item.catalogueId);
      const value = dashboardOwnedValueMinor(item, catalogueItem);

      summary.items += item.quantity;
      summary.costMinor += item.purchasePriceMinor ?? 0;
      summary.valueMinor += value ?? 0;

      if (value === null) {
        summary.unvalued += item.quantity;
      }

      if (catalogueItem?.type === "sealed") {
        summary.sealed += item.quantity;
      } else {
        summary.cards += item.quantity;
      }

      return summary;
    },
    { cards: 0, costMinor: 0, items: 0, sealed: 0, unvalued: 0, valueMinor: 0 },
  );
  const wishlistTargetMinor = data.wishlist.reduce((total, item) => {
    const catalogueItem = catalogueById.get(item.catalogueId);

    return total + (item.targetPriceMinor ?? catalogueItem?.valueMinor ?? 0);
  }, 0);

  return {
    ...collectionSummary,
    wishlistTargetMinor,
  };
}

function dashboardOwnedValueMinor(item: CollectionItem, catalogueItem?: CatalogueItem) {
  return exactCollectionItemValueMinor(item, catalogueItem) ?? null;
}

export async function createCollectionItem(
  userId: string,
  input: CreateCollectionItemInput,
): Promise<CollectionItem> {
  assertDatabaseConfigured();
  const catalogueId = boundedRequiredText(
    input.catalogueId,
    "Catalogue item id",
    PERSISTED_INPUT_LIMITS.catalogueId,
  );

  const [cardPrinting, sealedProduct] = await Promise.all([
    prisma.cardPrinting.findUnique({
      where: { id: catalogueId },
      include: {
        cardSet: true,
        priceSnapshots: {
          where: customerVisiblePriceSnapshotWhere(),
          orderBy: { observedAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.sealedProduct.findFirst({
      where: visibleSealedProductWhere(userId, catalogueId),
      include: {
        relatedCardSet: true,
        priceSnapshots: {
          where: customerVisiblePriceSnapshotWhere(),
          orderBy: { observedAt: "desc" },
          take: 1,
        },
      },
    }),
  ]);

  if (!cardPrinting && !sealedProduct) {
    throw new AppMutationError("Catalogue item not found.", 404);
  }

  const itemType = cardPrinting ? PrismaItemType.CARD : PrismaItemType.SEALED_PRODUCT;
  const paidMinor = moneyInputToMinor(input.paid, "Purchase price");
  const overrideMinor = moneyInputToMinor(input.overrideValue, "Value override");
  const variant = boundedOptionalText(input.variant, "Variant", PERSISTED_INPUT_LIMITS.variant);
  const notes = boundedOptionalText(input.notes, "Notes", PERSISTED_INPUT_LIMITS.notes);
  const valuationNote = boundedOptionalText(
    input.valuationNote,
    "Valuation note",
    PERSISTED_INPUT_LIMITS.valuationNote,
  );
  const quantity = normalizeCollectionQuantity(input.quantity);
  const purchaseDate = input.purchaseDate === undefined
    ? paidMinor === undefined ? undefined : new Date()
    : parseDateInput(input.purchaseDate);

  const created = await prisma.$transaction(async (transaction) => {
    await lockUserResourceQuota(transaction, userId, "collectionLots");
    await lockUserResourceQuota(transaction, userId, "collectionRows");
    await lockUserResourceQuota(transaction, userId, "collectionEvents");
    const activeLots = await transaction.collectionItem.count({
      where: { userId, archivedAt: null },
    });
    const [retainedRows, retainedEvents] = await Promise.all([
      transaction.collectionItem.count({ where: { userId } }),
      transaction.collectionEvent.count({ where: { userId } }),
    ]);
    assertUserResourceQuota(activeLots, "collectionLots");
    assertUserResourceQuota(retainedRows, "collectionRows");
    assertUserResourceQuota(retainedEvents, "collectionEvents");
    const storageLocationId = await resolveStorageLocationId(transaction, userId, input.location);

    return transaction.collectionItem.create({
    data: {
      userId,
      itemType,
      cardPrintingId: cardPrinting?.id,
      sealedProductId: sealedProduct?.id,
      quantity,
      condition: conditionToEnum(input.condition, itemType),
      language: languageToCode(input.language),
      variantLabel: variant || defaultVariant(itemType),
      purchasePriceMinor: paidMinor,
      purchaseCurrency: paidMinor === undefined ? undefined : "GBP",
      purchaseDate,
      currentValueOverrideMinor: overrideMinor,
      currentValueOverrideCurrency: overrideMinor === undefined ? undefined : "GBP",
      valuationNote,
      storageLocationId,
      notes,
      events: {
        create: {
          userId,
          eventType: CollectionEventType.ADDED,
          quantity,
          amountMinor: overrideMinor,
          currency: overrideMinor === undefined ? undefined : "GBP",
          occurredAt: new Date(),
          notes: "Created from app API.",
          metadata: { source: "app_api" },
        },
      },
    },
    include: {
      cardPrinting: {
        include: {
          cardSet: true,
          priceSnapshots: {
            where: customerVisiblePriceSnapshotWhere(),
            orderBy: { observedAt: "desc" },
            take: 1,
          },
        },
      },
      sealedProduct: {
        include: {
          relatedCardSet: true,
          priceSnapshots: {
            where: customerVisiblePriceSnapshotWhere(),
            orderBy: { observedAt: "desc" },
            take: 1,
          },
        },
      },
      storageLocation: true,
    },
    });
  });

  return mapCollectionItem(created);
}

export async function updateCollectionItem(
  userId: string,
  id: string,
  input: UpdateCollectionItemInput,
): Promise<CollectionItem> {
  assertDatabaseConfigured();

  const existing = await prisma.collectionItem.findFirst({
    where: {
      id,
      userId,
      archivedAt: null,
    },
    select: {
      id: true,
      itemType: true,
      gradedCompany: true,
      gradedScore: true,
      currentValueOverrideMinor: true,
      purchaseDate: true,
      quantity: true,
    },
  });

  if (!existing) {
    throw new AppMutationError("Collection item not found.", 404);
  }

  const paidMinor = moneyInputToMinor(input.paid, "Purchase price");
  const overrideMinor = moneyInputToMinor(input.overrideValue, "Value override");
  const variant = input.variant === undefined
    ? undefined
    : boundedOptionalText(input.variant, "Variant", PERSISTED_INPUT_LIMITS.variant);
  const notes = input.notes === undefined
    ? undefined
    : boundedOptionalText(input.notes, "Notes", PERSISTED_INPUT_LIMITS.notes);
  const valuationNote = input.valuationNote === undefined
    ? undefined
    : boundedOptionalText(input.valuationNote, "Valuation note", PERSISTED_INPUT_LIMITS.valuationNote);
  const quantity = normalizeCollectionQuantity(input.quantity);
  const gradedCompany =
    input.gradeCompany === undefined
      ? undefined
      : existing.itemType === PrismaItemType.CARD
        ? gradingCompanyToEnum(input.gradeCompany)
        : null;
  const gradedScore =
    input.gradeCompany === undefined
      ? undefined
      : gradedCompany
        ? parseGradingScore(input.gradeScore)
        : null;
  const existingGradeScore =
    existing.gradedScore === null || existing.gradedScore === undefined
      ? null
      : Number(existing.gradedScore);
  const nextGradeScore = gradedScore === null || gradedScore === undefined ? null : Number(gradedScore);
  const gradingChanged =
    input.gradeCompany !== undefined &&
    (existing.gradedCompany !== gradedCompany ||
      existingGradeScore !== nextGradeScore);
  const overrideChanged =
    input.overrideValue !== undefined &&
    (existing.currentValueOverrideMinor ?? null) !== (overrideMinor ?? null);

  const updated = await prisma.$transaction(async (transaction) => {
    await lockUserResourceQuota(transaction, userId, "collectionEvents");
    assertUserResourceQuota(
      await transaction.collectionEvent.count({ where: { userId } }),
      "collectionEvents",
    );
    await lockCollectionItemsForBinderConsistency(transaction, userId, [existing.id]);
    const storageLocationId = await resolveStorageLocationId(transaction, userId, input.location);
    const current = await transaction.collectionItem.findFirst({
      where: { id: existing.id, userId, archivedAt: null },
      select: { quantity: true },
    });
    if (!current || current.quantity !== existing.quantity) {
      throw new AppMutationError("This collection item changed while it was being edited. Refresh and try again.", 409);
    }

    const result = await transaction.collectionItem.update({
      where: { id: existing.id },
      data: {
      quantity,
      condition: conditionToEnum(input.condition, existing.itemType),
      language: languageToCode(input.language),
      variantLabel: input.variant === undefined ? undefined : variant || defaultVariant(existing.itemType),
      purchasePriceMinor: paidMinor ?? null,
      purchaseCurrency: paidMinor === undefined ? null : "GBP",
      purchaseDate:
        input.purchaseDate === undefined
          ? undefined
          : parseDateInput(input.purchaseDate) ?? null,
      gradedCompany,
      gradedScore,
      currentValueOverrideMinor: input.overrideValue === undefined ? undefined : overrideMinor ?? null,
      currentValueOverrideCurrency:
        input.overrideValue === undefined ? undefined : overrideMinor === undefined ? null : "GBP",
      valuationNote: input.valuationNote === undefined ? undefined : valuationNote ?? null,
      storageLocationId: storageLocationId ?? null,
      notes: input.notes === undefined ? undefined : notes ?? null,
      events: {
        create: {
          userId,
          eventType: gradingChanged ? CollectionEventType.GRADED : CollectionEventType.EDITED,
          quantity,
          amountMinor: overrideChanged ? overrideMinor : undefined,
          currency: overrideChanged && overrideMinor !== undefined ? "GBP" : undefined,
          occurredAt: new Date(),
          notes: gradingChanged ? "Grading details updated from app API." : "Updated from app API.",
          metadata: {
            source: "app_api",
            ...(gradedCompany ? { grade_company: gradedCompany } : {}),
            ...(gradedScore ? { grade_score: gradedScore } : {}),
            value_override_changed: overrideChanged,
            valuation_note_updated: input.valuationNote !== undefined,
          },
        },
      },
    },
      include: collectionItemInclude,
    });

    if (quantity < existing.quantity) {
      await reconcileBinderSlotsForQuantity(transaction, existing.id, quantity);
    }

    return result;
  });

  return mapCollectionItem(updated);
}

export async function archiveCollectionItem(userId: string, id: string) {
  assertDatabaseConfigured();

  const existing = await prisma.collectionItem.findFirst({
    where: {
      id,
      userId,
      archivedAt: null,
    },
    select: {
      id: true,
      quantity: true,
    },
  });

  if (!existing) {
    throw new AppMutationError("Collection item not found.", 404);
  }

  await prisma.$transaction(async (transaction) => {
    await lockUserResourceQuota(transaction, userId, "collectionEvents");
    await reserveCollectionEventForDestructiveMutation(transaction, userId);
    await lockCollectionItemsForBinderConsistency(transaction, userId, [existing.id]);
    const current = await transaction.collectionItem.findFirst({
      where: { id: existing.id, userId, archivedAt: null },
      select: { quantity: true },
    });
    if (!current || current.quantity !== existing.quantity) {
      throw new AppMutationError("This collection item changed while it was being removed. Refresh and try again.", 409);
    }

    await transaction.collectionItem.update({
      where: { id: existing.id },
      data: {
      archivedAt: new Date(),
      events: {
        create: {
          userId,
          eventType: CollectionEventType.REMOVED,
          quantity: existing.quantity,
          occurredAt: new Date(),
          notes: "Archived from app API.",
          metadata: { source: "app_api" },
        },
      },
      },
    });
    await reconcileBinderSlotsForQuantity(transaction, existing.id, 0);
  });
}

export async function sellCollectionItem(
  userId: string,
  id: string,
  input: SellCollectionItemInput,
) {
  assertDatabaseConfigured();

  const existing = await prisma.collectionItem.findFirst({
    where: {
      id,
      userId,
      archivedAt: null,
    },
    select: {
      id: true,
      quantity: true,
      purchasePriceMinor: true,
      currentValueOverrideMinor: true,
    },
  });

  if (!existing) {
    throw new AppMutationError("Collection item not found.", 404);
  }

  const amountMinor = moneyInputToMinor(input.amount, "Sale amount");
  const saleNotes = boundedOptionalText(input.notes, "Sale notes", PERSISTED_INPUT_LIMITS.saleNotes);
  const occurredAt = parseDateInput(input.occurredAt) ?? new Date();
  const soldQuantity = normalizeSaleQuantity(input.quantity, existing.quantity);
  const remainingQuantity = existing.quantity - soldQuantity;
  const soldPurchaseBasisMinor = proportionalMinor(
    existing.purchasePriceMinor,
    soldQuantity,
    existing.quantity,
  );
  const remainingPurchaseBasisMinor = remainingMinor(
    existing.purchasePriceMinor,
    soldPurchaseBasisMinor,
  );
  const soldOverrideMinor = proportionalMinor(
    existing.currentValueOverrideMinor,
    soldQuantity,
    existing.quantity,
  );
  const remainingOverrideMinor = remainingMinor(
    existing.currentValueOverrideMinor,
    soldOverrideMinor,
  );

  await prisma.$transaction(async (transaction) => {
    await lockUserResourceQuota(transaction, userId, "collectionEvents");
    await reserveCollectionEventForDestructiveMutation(transaction, userId);
    await lockCollectionItemsForBinderConsistency(transaction, userId, [existing.id]);
    const current = await transaction.collectionItem.findFirst({
      where: { id: existing.id, userId, archivedAt: null },
      select: { quantity: true },
    });
    if (!current || current.quantity !== existing.quantity) {
      throw new AppMutationError("This collection item changed while the sale was being recorded. Refresh and try again.", 409);
    }

    await transaction.collectionItem.update({
      where: { id: existing.id },
      data: {
      quantity: remainingQuantity || existing.quantity,
      purchasePriceMinor: remainingQuantity ? remainingPurchaseBasisMinor : undefined,
      currentValueOverrideMinor: remainingQuantity ? remainingOverrideMinor : undefined,
      soldAt: remainingQuantity ? null : occurredAt,
      archivedAt: remainingQuantity ? null : new Date(),
      events: {
        create: {
          userId,
          eventType: CollectionEventType.SOLD,
          quantity: soldQuantity,
          amountMinor,
          currency: amountMinor === undefined ? undefined : "GBP",
          occurredAt,
          notes: saleNotes ?? "Sold from app API.",
          metadata: {
            source: "app_api",
            original_quantity: existing.quantity,
            remaining_quantity: remainingQuantity,
            sold_purchase_basis_minor: soldPurchaseBasisMinor,
          },
        },
      },
      },
    });
    await reconcileBinderSlotsForQuantity(transaction, existing.id, remainingQuantity);
  });
}

export async function reserveCollectionEventForDestructiveMutation(
  transaction: Pick<Prisma.TransactionClient, "collectionEvent">,
  userId: string,
) {
  const limit = USER_RESOURCE_LIMITS.collectionEvents;
  const count = await transaction.collectionEvent.count({ where: { userId } });
  if (count < limit) return { compacted: false };

  // Preserve acquisition, sale, removal, and grading evidence. At the hard
  // ceiling only an oldest low-value edit audit row may be replaced by the new
  // destructive event, so users can still sell or remove a lot without ever
  // exceeding the bounded event total.
  const replaceable = await transaction.collectionEvent.findFirst({
    where: { userId, eventType: CollectionEventType.EDITED },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (!replaceable) throw new UserQuotaExceededError("collection events", limit);

  const removed = await transaction.collectionEvent.deleteMany({
    where: { id: replaceable.id, userId, eventType: CollectionEventType.EDITED },
  });
  if (removed.count !== 1) {
    throw new AppMutationError("Collection history changed concurrently. Refresh and try again.", 409);
  }
  return { compacted: true };
}

export async function createStorageLocation(
  userId: string,
  input: CreateStorageLocationInput,
): Promise<StorageLocation> {
  assertDatabaseConfigured();

  const name = normalizeStorageName(input.name);
  const notes = boundedOptionalText(input.notes, "Storage notes", PERSISTED_INPUT_LIMITS.storageNotes);
  const type = storageLocationTypeToEnum(input.type);

  const location = await prisma.$transaction(async (transaction) => {
    await lockUserResourceQuota(transaction, userId, "storageLocations");
    const existing = await transaction.storageLocation.findUnique({
      where: { userId_name: { userId, name } },
    });
    if (existing) {
      return transaction.storageLocation.update({
        where: { id: existing.id },
        data: { type, notes: notes ?? null },
      });
    }
    assertUserResourceQuota(
      await transaction.storageLocation.count({ where: { userId } }),
      "storageLocations",
    );
    return transaction.storageLocation.create({
      data: { userId, name, type, notes },
    });
  });

  return mapStorageLocation(location, []);
}

export async function updateStorageLocation(
  userId: string,
  id: string,
  input: UpdateStorageLocationInput,
): Promise<StorageLocation> {
  assertDatabaseConfigured();

  const existing = await prisma.storageLocation.findFirst({
    where: {
      id,
      userId,
    },
  });

  if (!existing) {
    throw new AppMutationError("Storage location not found.", 404);
  }

  const location = await prisma.storageLocation.update({
    where: { id: existing.id },
    data: {
      name: input.name === undefined ? undefined : normalizeStorageName(input.name),
      type: input.type === undefined ? undefined : storageLocationTypeToEnum(input.type),
      notes: input.notes === undefined
        ? undefined
        : boundedOptionalText(input.notes, "Storage notes", PERSISTED_INPUT_LIMITS.storageNotes) ?? null,
    },
  });

  return mapStorageLocation(location, []);
}

export async function deleteStorageLocation(userId: string, id: string) {
  assertDatabaseConfigured();

  await prisma.storageLocation.deleteMany({
    where: {
      id,
      userId,
    },
  });
}

export async function createSealedProduct(
  userId: string,
  input: CreateSealedProductInput,
): Promise<CatalogueItem> {
  assertDatabaseConfigured();

  const name = normalizeSealedProductName(input.name);
  const productType = sealedProductTypeToEnum(input.productType);
  const relatedCardSet = await resolveCardSet(input.relatedSetId);
  const estimatedValueMinor = moneyInputToMinor(input.estimatedValue, "Estimated value");
  const notes = boundedOptionalText(input.notes, "Notes", PERSISTED_INPUT_LIMITS.notes);

  const product = await prisma.$transaction(async (transaction) => {
    await lockUserResourceQuota(transaction, userId, "manualSealedProducts");
    const productCount = await transaction.sealedProduct.count({
      where: { createdByUserId: userId, visibility: CatalogueVisibility.PRIVATE },
    });
    assertUserResourceQuota(productCount, "manualSealedProducts");

    return transaction.sealedProduct.create({
    data: {
      createdByUserId: userId,
      relatedCardSetId: relatedCardSet?.id,
      name,
      productType,
      notes,
      visibility: CatalogueVisibility.PRIVATE,
      metadata: {
        source: "manual",
      },
      priceSnapshots:
        estimatedValueMinor === undefined
          ? undefined
          : {
              create: {
                itemType: PrismaItemType.SEALED_PRODUCT,
                source: "manual",
                sourceRef: "manual_sealed_product",
                priceMinor: estimatedValueMinor,
                currency: "GBP",
                confidenceScore: 45,
                observedAt: new Date(),
                metadata: {
                  source: "manual",
                },
              },
            },
    },
    include: {
      relatedCardSet: true,
      priceSnapshots: {
        where: customerVisiblePriceSnapshotWhere(),
        orderBy: { observedAt: "desc" },
        take: PRICE_HISTORY_LIMIT,
      },
    },
    });
  });

  return mapSealedProductToCatalogueItem(product, product.priceSnapshots);
}

export async function deleteManualSealedProduct(userId: string, id: string) {
  assertDatabaseConfigured();
  const normalizedId = boundedRequiredText(id, "Sealed product id", PERSISTED_INPUT_LIMITS.catalogueId);

  return prisma.$transaction(async (transaction) => {
    await lockUserResourceQuota(transaction, userId, "manualSealedProducts");
    const product = await transaction.sealedProduct.findFirst({
      where: {
        id: normalizedId,
        createdByUserId: userId,
        visibility: CatalogueVisibility.PRIVATE,
      },
      select: {
        id: true,
        _count: { select: { collectionItems: true, wishlistItems: true } },
      },
    });
    if (!product) throw new AppMutationError("Private sealed product not found.", 404);
    if (product._count.collectionItems || product._count.wishlistItems) {
      throw new AppMutationError(
        "Remove this product from collections and wishlists before deleting it permanently.",
        409,
      );
    }

    const deleted = await transaction.sealedProduct.deleteMany({
      where: {
        id: product.id,
        createdByUserId: userId,
        visibility: CatalogueVisibility.PRIVATE,
      },
    });
    if (deleted.count !== 1) {
      throw new AppMutationError("Private sealed product changed concurrently. Refresh and try again.", 409);
    }
    return { deleted: true };
  });
}

export async function createWishlistItem(
  userId: string,
  catalogueId: string,
  variant?: string,
): Promise<WishlistItem> {
  assertDatabaseConfigured();
  const normalizedCatalogueId = boundedRequiredText(
    catalogueId,
    "Catalogue item id",
    PERSISTED_INPUT_LIMITS.catalogueId,
  );
  const normalizedVariant = boundedOptionalText(
    variant,
    "Wishlist variant",
    PERSISTED_INPUT_LIMITS.variant,
  );

  const [cardPrinting, sealedProduct] = await Promise.all([
    prisma.cardPrinting.findUnique({
      where: { id: normalizedCatalogueId },
      include: {
        cardSet: true,
        priceSnapshots: {
          where: customerVisiblePriceSnapshotWhere({ rawCard: true }),
          orderBy: { observedAt: "desc" },
          take: PRICE_HISTORY_LIMIT,
        },
      },
    }),
    prisma.sealedProduct.findFirst({
      where: visibleSealedProductWhere(userId, normalizedCatalogueId),
      include: {
        relatedCardSet: true,
        priceSnapshots: {
          where: customerVisiblePriceSnapshotWhere(),
          orderBy: { observedAt: "desc" },
          take: PRICE_HISTORY_LIMIT,
        },
      },
    }),
  ]);

  if (!cardPrinting && !sealedProduct) {
    throw new AppMutationError("Catalogue item not found.", 404);
  }

  const catalogueItem = cardPrinting
    ? mapCardPrintingToCatalogueItem(cardPrinting, cardPrinting.priceSnapshots)
    : mapSealedProductToCatalogueItem(sealedProduct!, sealedProduct!.priceSnapshots);
  const selectedValueMinor = catalogueValueMinorForVariant(catalogueItem, normalizedVariant);
  const targetPriceMinor = defaultWishlistTargetPriceMinor(selectedValueMinor);

  const uniqueWhere = cardPrinting
      ? { userId_cardPrintingId: { userId, cardPrintingId: cardPrinting.id } }
      : { userId_sealedProductId: { userId, sealedProductId: sealedProduct!.id } };
  const include = {
    cardPrinting: {
      include: {
        cardSet: true,
        priceSnapshots: {
          where: customerVisiblePriceSnapshotWhere(),
          orderBy: { observedAt: "desc" as const },
          take: 1,
        },
      },
    },
    sealedProduct: {
      include: {
        relatedCardSet: true,
        priceSnapshots: {
          where: customerVisiblePriceSnapshotWhere(),
          orderBy: { observedAt: "desc" as const },
          take: 1,
        },
      },
    },
  };
  const created = await prisma.$transaction(async (transaction) => {
    await lockUserResourceQuota(transaction, userId, "wishlistItems");
    const existing = await transaction.wishlistItem.findUnique({ where: uniqueWhere, include });
    if (existing) {
      return normalizedVariant === undefined
        ? existing
        : transaction.wishlistItem.update({
            where: { id: existing.id },
            data: { variantLabel: normalizedVariant },
            include,
          });
    }
    assertUserResourceQuota(
      await transaction.wishlistItem.count({ where: { userId } }),
      "wishlistItems",
    );
    return transaction.wishlistItem.create({
      data: {
      userId,
      itemType: cardPrinting ? PrismaItemType.CARD : PrismaItemType.SEALED_PRODUCT,
      cardPrintingId: cardPrinting?.id,
      sealedProductId: sealedProduct?.id,
      variantLabel: normalizedVariant,
      targetPriceMinor,
      targetCurrency: targetPriceMinor === undefined ? undefined : "GBP",
      priority:
        (selectedValueMinor ?? 0) > 10000
          ? WishlistPriority.GRAIL
          : WishlistPriority.HIGH,
      notes: "Added from app API.",
      },
      include,
    });
  });

  return mapWishlistItem(created);
}

export async function deleteWishlistItem(userId: string, id: string) {
  assertDatabaseConfigured();

  await prisma.wishlistItem.deleteMany({
    where: {
      id,
      userId,
    },
  });
}

export async function updateWishlistItem(
  userId: string,
  id: string,
  input: UpdateWishlistItemInput,
): Promise<WishlistItem> {
  assertDatabaseConfigured();

  const existing = await prisma.wishlistItem.findFirst({
    where: {
      id,
      userId,
    },
    select: { id: true },
  });

  if (!existing) {
    throw new AppMutationError("Wishlist item not found.", 404);
  }

  const targetPriceMinor = moneyInputToMinor(input.targetPrice, "Wishlist target price");
  const updated = await prisma.wishlistItem.update({
    where: { id: existing.id },
    data: {
      variantLabel: input.variant === undefined
        ? undefined
        : boundedOptionalText(input.variant, "Wishlist variant", PERSISTED_INPUT_LIMITS.variant) ?? null,
      priority: input.priority === undefined ? undefined : priorityToEnum(input.priority),
      targetPriceMinor: input.targetPrice === undefined ? undefined : targetPriceMinor ?? null,
      targetCurrency: input.targetPrice === undefined ? undefined : targetPriceMinor === undefined ? null : "GBP",
      notes: input.notes === undefined
        ? undefined
        : boundedOptionalText(input.notes, "Wishlist notes", PERSISTED_INPUT_LIMITS.wishlistNotes) ?? null,
    },
  });

  return mapWishlistItem(updated);
}

async function resolveStorageLocationId(
  transaction: Prisma.TransactionClient,
  userId: string,
  location?: string,
) {
  if (!location || location === "Unassigned") {
    return undefined;
  }

  const name = normalizeStorageName(location);
  await lockUserResourceQuota(transaction, userId, "storageLocations");
  const existing = await transaction.storageLocation.findUnique({
    where: { userId_name: { userId, name } },
  });
  if (existing) return existing.id;
  assertUserResourceQuota(
    await transaction.storageLocation.count({ where: { userId } }),
    "storageLocations",
  );
  const storage = await transaction.storageLocation.create({
    data: { userId, name, type: StorageLocationType.OTHER },
  });

  return storage.id;
}

function mapCardPrintingToCatalogueItem(
  card: {
    id: string;
    name: string;
    language: string;
    region: string;
    number: string;
    rarity: string | null;
    supertype?: string | null;
    imageLargeUrl: string | null;
    imageSmallUrl: string | null;
    providerIds: unknown;
    variantMetadata: unknown;
    cardSet: { id: string; name: string; language?: string | null; region?: string | null; providerIds?: unknown };
  },
  prices: PriceLike[] = [],
  options: { includeGradedHistory?: boolean } = {},
): CatalogueItem {
  const visiblePrices = prices.filter((price) => customerVisiblePriceSource(price.source, process.env));
  const rawPriceHistory = buildPriceHistory(priceInputsForGrade(visiblePrices));
  const priceHistory = options.includeGradedHistory
    ? buildPriceHistory(visiblePrices)
    : rawPriceHistory;
  const latestPrice = preferredLatestPricePoint(rawPriceHistory);
  const image =
    usableCardImageUrl(card.imageLargeUrl) ??
    usableCardImageUrl(card.imageSmallUrl) ??
    usableCardImageUrl(pokemonTcgImageUrlFromProviderIds(card.providerIds)) ??
    tcgdexJapaneseImageUrlFromProviderIds(card.providerIds) ??
    tcgplayerCardImageUrlFromPrices(visiblePrices);
  const displayName = catalogueDisplayCardForText(card.name, {
    number: card.number,
    supertype: card.supertype,
  });
  const displaySet = catalogueDisplaySetForText(card.cardSet.name, {
    language: card.cardSet.language ?? card.language,
    providerCode: tcgdexProviderCode(card.cardSet.providerIds),
  });
  const rarity = displayCatalogueRarity(card.rarity);

  return {
    id: card.id,
    type: "card",
    name: card.name,
    displayName,
    localName: displayName ? card.name : undefined,
    set: card.cardSet.name,
    displaySet,
    localSet: displaySet ? card.cardSet.name : undefined,
    setId: card.cardSet.id,
    language: card.language,
    languageLabel: catalogueLanguageLabel(card.language),
    region: card.region,
    regionLabel: catalogueRegionLabel(card.region),
    number: card.number,
    rarity,
    image,
    hasPrice: Boolean(latestPrice),
    valueMinor: latestPrice?.valueMinor ?? 0,
    confidence: effectivePriceConfidence(latestPrice),
    priceMarket: latestPrice ? priceMarketForSource(latestPrice.source) : undefined,
    priceSource: latestPrice?.source,
    priceStatus: latestPrice ? priceFreshnessStatus(latestPrice) : undefined,
    priceObservedAt: latestPrice?.observedAt,
    priceHistory: priceHistory.length ? priceHistory : undefined,
    variantOptions: buildCatalogueVariantOptions({
      itemType: "card",
      priceHistory: rawPriceHistory,
      rarity,
      setName: card.cardSet.name,
      variantMetadata: card.variantMetadata,
    }),
  };
}

function tcgplayerCardImageUrlFromPrices(prices: PriceLike[]) {
  const snapshot = prices.find((price) =>
    price.source.toLowerCase().startsWith("tcgcsv") && /^\d+$/.test(price.sourceRef?.trim() ?? ""),
  );

  return snapshot?.sourceRef
    ? `https://tcgplayer-cdn.tcgplayer.com/product/${snapshot.sourceRef.trim()}_in_1000x1000.jpg`
    : undefined;
}

function usableCardImageUrl(value?: string | null) {
  const url = value?.trim();

  return url && !isKnownBadCardImageUrl(url) ? url : undefined;
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

function mapSealedProductToCatalogueItem(
  product: {
    id: string;
    name: string;
    productType: string;
    imageUrl: string | null;
    relatedCardSet: { name: string } | null;
  },
  prices: PriceLike[] = [],
): CatalogueItem {
  const priceHistory = buildPriceHistory(
    prices.filter((price) => customerVisiblePriceSource(price.source, process.env)),
  );
  const latestPrice = preferredLatestPricePoint(priceHistory);

  return {
    id: product.id,
    type: "sealed",
    name: product.name,
    set: product.relatedCardSet?.name ?? "Sealed product",
    number: "Sealed",
    rarity: enumLabel(product.productType),
    image: product.imageUrl ?? undefined,
    hasPrice: Boolean(latestPrice),
    valueMinor: latestPrice?.valueMinor ?? 0,
    confidence: effectivePriceConfidence(latestPrice),
    priceMarket: latestPrice ? priceMarketForSource(latestPrice.source) : undefined,
    priceSource: latestPrice?.source,
    priceStatus: latestPrice ? priceFreshnessStatus(latestPrice) : undefined,
    priceObservedAt: latestPrice?.observedAt,
    priceHistory: priceHistory.length ? priceHistory : undefined,
    variantOptions: buildCatalogueVariantOptions({
      itemType: "sealed",
      priceHistory,
    }),
  };
}

function mapCatalogueSearchCard(
  card: Prisma.CardPrintingGetPayload<{ select: typeof catalogueSearchCardSelect }>,
) {
  return compactCatalogueSearchHistory(
    mapCardPrintingToCatalogueItem(card, card.priceSnapshots),
  );
}

function mapCatalogueSearchSealed(
  product: Prisma.SealedProductGetPayload<{ select: typeof catalogueSearchSealedSelect }>,
) {
  return compactCatalogueSearchHistory(
    mapSealedProductToCatalogueItem(product, product.priceSnapshots),
  );
}

function mapCollectionItem(item: {
  id: string;
  itemType: string;
  cardPrintingId: string | null;
  sealedProductId: string | null;
  quantity: number;
  condition: string;
  language: string;
  variantLabel: string | null;
  gradedCompany: string | null;
  gradedScore: unknown;
  purchasePriceMinor: number | null;
  purchaseDate: Date | null;
  currentValueOverrideMinor: number | null;
  valuationNote: string | null;
  storageLocation: { name: string } | null;
  notes: string | null;
}): CollectionItem {
  const type = itemTypeToClient(item.itemType);

  return {
    id: item.id,
    catalogueId: item.cardPrintingId ?? item.sealedProductId ?? "",
    quantity: item.quantity,
    condition: enumLabel(item.condition),
    language: languageLabel(item.language),
    variant: item.variantLabel ?? defaultVariant(type === "card" ? PrismaItemType.CARD : PrismaItemType.SEALED_PRODUCT),
    grade: gradeLabel(item),
    purchasePriceMinor: item.purchasePriceMinor ?? undefined,
    purchaseDate: dateOnly(item.purchaseDate),
    location: item.storageLocation?.name ?? "Unassigned",
    notes: item.notes ?? undefined,
    overrideValueMinor: item.currentValueOverrideMinor ?? undefined,
    valuationNote: item.valuationNote ?? undefined,
  };
}

function mapWishlistItem(item: {
  id: string;
  cardPrintingId: string | null;
  sealedProductId: string | null;
  targetPriceMinor: number | null;
  variantLabel: string | null;
  priority: string;
  notes: string | null;
}): WishlistItem {
  return {
    id: item.id,
    catalogueId: item.cardPrintingId ?? item.sealedProductId ?? "",
    variant: item.variantLabel ?? undefined,
    priority: enumLabel(item.priority) as WishlistItem["priority"],
    targetPriceMinor: item.targetPriceMinor ?? undefined,
    notes: item.notes ?? undefined,
  };
}

function mapSetProgress(set: {
  id: string;
  providerIds: unknown;
  name: string;
  language: string;
  region: string;
  series: string | null;
  releaseDate: Date | null;
  logoImageUrl: string | null;
  symbolImageUrl: string | null;
  total: number | null;
}, counts: { owned: number; total: number }): SetProgress {
  const displayName = catalogueDisplaySetForText(set.name, {
    language: set.language,
    providerCode: tcgdexProviderCode(set.providerIds),
  });

  return {
    id: set.id,
    name: set.name,
    displayName,
    localName: displayName ? set.name : undefined,
    language: set.language,
    languageLabel: catalogueLanguageLabel(set.language),
    region: set.region,
    regionLabel: catalogueRegionLabel(set.region),
    series: set.series ?? undefined,
    releaseDate: dateOnly(set.releaseDate),
    logoImage: set.logoImageUrl ?? undefined,
    symbolImage: set.symbolImageUrl ?? undefined,
    owned: counts.owned,
    total: set.total ?? counts.total,
  };
}

function tcgdexProviderCode(providerIds: unknown) {
  if (!providerIds || typeof providerIds !== "object" || Array.isArray(providerIds)) {
    return undefined;
  }

  const value = (providerIds as Record<string, unknown>).tcgdex;

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function displayCatalogueRarity(value?: string | null) {
  if (!value || value.trim().toLowerCase() === "none") {
    return "Unknown";
  }

  return value;
}

function mapStorageLocations(
  locations: Array<{ id: string; name: string; type: string; notes: string | null }>,
  collectionItems: CollectionItem[],
  catalogue: CatalogueItem[],
): StorageLocation[] {
  const catalogueById = new Map(catalogue.map((item) => [item.id, item]));

  return locations.map((location) => {
    const locationItems = collectionItems.filter((item) => item.location === location.name);
    return mapStorageLocation(location, locationItems, catalogueById);
  });
}

function mapStorageLocation(
  location: { id: string; name: string; type: string; notes: string | null },
  items: CollectionItem[],
  catalogueById: Map<string, CatalogueItem> = new Map(),
): StorageLocation {
  return {
    id: location.id,
    name: location.name,
    type: storageLocationTypeLabel(location.type),
    notes: location.notes ?? undefined,
    itemCount: items.length,
    totalQuantity: items.reduce((total, item) => total + item.quantity, 0),
    valueMinor: items.reduce(
      (total, item) => total + (exactCollectionItemValueMinor(item, catalogueById.get(item.catalogueId)) ?? 0),
      0,
    ),
  };
}

function mapCollectionEvent(event: {
  id: string;
  eventType: string;
  quantity: number | null;
  amountMinor: number | null;
  currency: string | null;
  occurredAt: Date;
  notes: string | null;
  metadata: unknown;
  collectionItem: {
    id: string;
    cardPrintingId: string | null;
    sealedProductId: string | null;
    purchasePriceMinor: number | null;
    cardPrinting: { name: string } | null;
    sealedProduct: { name: string } | null;
  };
}): ClientCollectionEvent {
  return {
    id: event.id,
    type: enumLabel(event.eventType) as ClientCollectionEvent["type"],
    itemId: event.collectionItem.id,
    catalogueId: event.collectionItem.cardPrintingId ?? event.collectionItem.sealedProductId ?? "",
    itemName:
      event.collectionItem.cardPrinting?.name ??
      event.collectionItem.sealedProduct?.name ??
      "Collection item",
    quantity: event.quantity ?? undefined,
    amountMinor: event.amountMinor ?? undefined,
    basisMinor:
      event.eventType === CollectionEventType.SOLD
        ? saleBasisMinor(event.metadata) ?? event.collectionItem.purchasePriceMinor ?? undefined
        : undefined,
    currency: event.currency ?? undefined,
    occurredAt: event.occurredAt.toISOString(),
    notes: event.notes ?? undefined,
  };
}

function saleBasisMinor(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }

  const value = (metadata as Record<string, unknown>).sold_purchase_basis_minor;

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const collectionItemInclude = {
  cardPrinting: {
    include: {
      cardSet: true,
      priceSnapshots: {
        where: customerVisiblePriceSnapshotWhere(),
        orderBy: { observedAt: "desc" },
        take: PRICE_HISTORY_LIMIT,
      },
    },
  },
  sealedProduct: {
    include: {
      relatedCardSet: true,
      priceSnapshots: {
        where: customerVisiblePriceSnapshotWhere(),
        orderBy: { observedAt: "desc" },
        take: PRICE_HISTORY_LIMIT,
      },
    },
  },
  storageLocation: true,
} as const;

const collectionEventInclude = {
  collectionItem: {
    include: {
      cardPrinting: {
        include: {
          cardSet: true,
        },
      },
      sealedProduct: {
        include: {
          relatedCardSet: true,
        },
      },
    },
  },
} as const;

function itemTypeToClient(value: string): ItemType {
  return value === PrismaItemType.SEALED_PRODUCT ? "sealed" : "card";
}

function enumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function languageLabel(value?: string | null) {
  return value ? catalogueLanguageLabel(value) : "Unknown";
}

function languageToCode(value?: string) {
  return languageLabelToCode(value);
}

function conditionToEnum(value: string | undefined, itemType: PrismaItemType) {
  if (itemType === PrismaItemType.SEALED_PRODUCT) {
    return ItemCondition.SEALED;
  }

  const normalized = value?.trim().toLowerCase().replace(/\s+/g, "_") ?? "";
  const map: Record<string, ItemCondition> = {
    near_mint: ItemCondition.NEAR_MINT,
    excellent: ItemCondition.EXCELLENT,
    light_played: ItemCondition.LIGHT_PLAYED,
    played: ItemCondition.PLAYED,
    poor: ItemCondition.POOR,
    mint: ItemCondition.MINT,
    unknown: ItemCondition.UNKNOWN,
  };

  return map[normalized] ?? ItemCondition.UNKNOWN;
}

function priorityToEnum(value?: string) {
  const normalized = value?.trim().toLowerCase() ?? "";
  const map: Record<string, WishlistPriority> = {
    low: WishlistPriority.LOW,
    medium: WishlistPriority.MEDIUM,
    high: WishlistPriority.HIGH,
    grail: WishlistPriority.GRAIL,
  };

  return map[normalized] ?? WishlistPriority.MEDIUM;
}

function gradingCompanyToEnum(value?: string) {
  const normalized = value?.trim().toLowerCase() ?? "";
  const map: Record<string, GradingCompany | null> = {
    raw: null,
    none: null,
    ungraded: null,
    psa: GradingCompany.PSA,
    bgs: GradingCompany.BGS,
    cgc: GradingCompany.CGC,
    ace: GradingCompany.ACE,
    sgc: GradingCompany.SGC,
    other: GradingCompany.OTHER,
  };

  return map[normalized] ?? null;
}

function parseGradingScore(value?: string) {
  const score = Number(String(value ?? "").replace(/[^0-9.]/g, ""));

  if (!Number.isFinite(score) || score <= 0) {
    return null;
  }

  return Math.min(10, Math.max(1, score)).toFixed(1);
}

function defaultVariant(itemType: PrismaItemType) {
  return itemType === PrismaItemType.SEALED_PRODUCT ? "Factory sealed" : "Standard";
}

function storageLocationTypeLabel(value: string) {
  return enumLabel(value) as StorageLocation["type"];
}

function storageLocationTypeToEnum(value?: string) {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, "_") ?? "";
  const map: Record<string, StorageLocationType> = {
    binder: StorageLocationType.BINDER,
    box: StorageLocationType.BOX,
    display: StorageLocationType.DISPLAY,
    safe: StorageLocationType.SAFE,
    other: StorageLocationType.OTHER,
  };

  return map[normalized] ?? StorageLocationType.OTHER;
}

function sealedProductTypeToEnum(value?: string) {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  const map: Record<string, SealedProductType> = {
    booster_box: SealedProductType.BOOSTER_BOX,
    booster_pack: SealedProductType.BOOSTER_PACK,
    elite_trainer_box: SealedProductType.ELITE_TRAINER_BOX,
    etb: SealedProductType.ELITE_TRAINER_BOX,
    collection_box: SealedProductType.COLLECTION_BOX,
    tin: SealedProductType.TIN,
    blister: SealedProductType.BLISTER,
    deck: SealedProductType.DECK,
    case: SealedProductType.CASE,
    other: SealedProductType.OTHER,
  };

  return map[normalized] ?? SealedProductType.OTHER;
}

function sealedProductTypeDbValue(value: SealedProductType) {
  const map: Record<SealedProductType, string> = {
    [SealedProductType.BOOSTER_BOX]: "booster_box",
    [SealedProductType.BOOSTER_PACK]: "booster_pack",
    [SealedProductType.ELITE_TRAINER_BOX]: "elite_trainer_box",
    [SealedProductType.COLLECTION_BOX]: "collection_box",
    [SealedProductType.TIN]: "tin",
    [SealedProductType.BLISTER]: "blister",
    [SealedProductType.DECK]: "deck",
    [SealedProductType.CASE]: "case",
    [SealedProductType.OTHER]: "other",
  };

  return map[value];
}

function sealedProductTypeFromSearchTerm(value?: string) {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  const map: Record<string, SealedProductType> = {
    booster_box: SealedProductType.BOOSTER_BOX,
    booster_pack: SealedProductType.BOOSTER_PACK,
    elite_trainer_box: SealedProductType.ELITE_TRAINER_BOX,
    etb: SealedProductType.ELITE_TRAINER_BOX,
    collection_box: SealedProductType.COLLECTION_BOX,
    tin: SealedProductType.TIN,
    blister: SealedProductType.BLISTER,
    deck: SealedProductType.DECK,
    case: SealedProductType.CASE,
  };

  return map[normalized];
}

async function resolveCardSet(id?: string) {
  const relatedSetId = id?.trim();

  if (!relatedSetId || relatedSetId === "none") {
    return null;
  }

  return prisma.cardSet.findUnique({
    where: { id: relatedSetId },
    select: { id: true },
  });
}

function gradeLabel(item: { itemType: string; gradedCompany: string | null; gradedScore: unknown }) {
  if (item.itemType === PrismaItemType.SEALED_PRODUCT) {
    return "N/A";
  }

  if (!item.gradedCompany) {
    return "Raw";
  }

  const score = item.gradedScore === null || item.gradedScore === undefined ? "" : ` ${item.gradedScore}`;

  return `${gradeCompanyLabel(item.gradedCompany)}${score}`;
}

function gradeCompanyLabel(value: string) {
  const labels: Record<string, string> = {
    PSA: "PSA",
    BGS: "BGS",
    CGC: "CGC",
    ACE: "ACE",
    SGC: "SGC",
    OTHER: "Other",
  };

  return labels[value] ?? enumLabel(value);
}

function defaultWishlistTargetPriceMinor(priceMinor?: number | null) {
  if (typeof priceMinor !== "number" || !Number.isFinite(priceMinor) || priceMinor <= 0) {
    return undefined;
  }

  return Math.max(1, Math.round(priceMinor * 0.9));
}

function parseDateInput(value?: string) {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  const date = new Date(`${normalized}T12:00:00`);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeStorageName(value?: string) {
  return boundedRequiredText(value, "Storage location name", PERSISTED_INPUT_LIMITS.storageName);
}

function normalizeSealedProductName(value?: string) {
  return boundedRequiredText(value, "Sealed product name", PERSISTED_INPUT_LIMITS.name);
}

function normalizeOptionalText(value?: string) {
  const text = value?.trim();

  return text || undefined;
}

function dateOnly(value?: Date | null) {
  return value ? value.toISOString().slice(0, 10) : undefined;
}

function assertDatabaseConfigured() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }
}
