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
import { sampleAppData } from "@/lib/sample-data";
import {
  buildCatalogueVariantOptions,
  catalogueValueMinorForVariant,
  latestPricePointForVariant,
  pokemonTcgImageUrlFromProviderIds,
} from "@/lib/catalogue/variants";
import { tcgdexJapaneseImageUrlFromProviderIds } from "@/lib/catalogue/tcgdex-images";
import {
  catalogueDisplayCardForText,
  catalogueNameAliasesForText,
  catalogueDisplaySetForText,
  catalogueSearchTermsForQuery,
} from "@/lib/catalogue/name-aliases";
import {
  catalogueLanguageCodesForSearch,
  catalogueLanguageLabel,
  catalogueRegionLabel,
  languageLabelToCode,
  normalizeCatalogueLanguageFilter,
} from "@/lib/catalogue/languages";
import { getEntitlements } from "@/lib/entitlements";
import { getNotificationPreferences } from "@/lib/notifications/preferences";
import { buildPriceHistory } from "@/lib/pricing/price-history";
import {
  effectivePriceConfidence,
  preferredLatestPricePoint,
  priceFreshnessStatus,
  priceMarketForSource,
} from "@/lib/pricing/market-context";
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
} from "@/lib/types";
import { prisma } from "./prisma";

type PriceLike = {
  priceMinor: number;
  confidenceScore: number;
  source: string;
  sourceRef?: string | null;
  observedAt: Date;
  variantLabel: string | null;
};

type CatalogueScope = "full" | "referenced";

type CatalogueSearchInput = {
  language?: string;
  limit?: number;
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

const PRICE_HISTORY_LIMIT = 8;
const CATALOGUE_SEARCH_MAX_LIMIT = 100;
const CATALOGUE_SEARCH_FETCH_MULTIPLIER = 6;

export type CreateCollectionItemInput = {
  catalogueId: string;
  quantity?: number;
  condition?: string;
  language?: string;
  variant?: string;
  paid?: string;
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
  priority?: string;
  targetPrice?: string;
  notes?: string;
};

export function sampleDataFallback(notice: string): AppData {
  return {
    ...sampleAppData,
    catalogueComplete: true,
    notice,
  };
}

export async function getAppData(userId: string, options: AppDataOptions = {}): Promise<AppData> {
  const catalogueScope = options.catalogueScope ?? "full";

  if (!process.env.DATABASE_URL) {
    return sampleDataFallback("Using sample data because DATABASE_URL is not configured.");
  }

  try {
    const [
      subscription,
      notificationPreferences,
      fullCatalogue,
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
        getNotificationPreferences(userId),
        catalogueScope === "full" ? getCatalogueItems(userId) : Promise.resolve([]),
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
                  orderBy: { observedAt: "desc" },
                  take: PRICE_HISTORY_LIMIT,
                },
              },
            },
            sealedProduct: {
              include: {
                relatedCardSet: true,
                priceSnapshots: {
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
          where: { userId },
          include: collectionEventInclude,
          orderBy: { occurredAt: "desc" },
          take: 12,
        }),
      ]);

    const cardSetTotals = new Map(cardSetCounts.map((row) => [row.cardSetId, row._count._all]));
    const ownedCardsBySet = ownedCardCountsBySet(ownedCardRows);
    const catalogue =
      catalogueScope === "full"
        ? fullCatalogue
        : referencedCatalogueItems(collectionItems, wishlistItems);

    return {
      catalogue,
      catalogueComplete: catalogueScope === "full",
      collection: collectionItems.map(mapCollectionItem),
      wishlist: wishlistItems.map(mapWishlistItem),
      sets: cardSets.map((set) =>
        mapSetProgress(set, {
          owned: ownedCardsBySet.get(set.id) ?? 0,
          total: cardSetTotals.get(set.id) ?? 0,
        }),
      ),
      storageLocations: mapStorageLocations(storageLocations, collectionItems),
      events: collectionEvents.map(mapCollectionEvent),
      source: "database",
      subscription,
      notificationPreferences,
    };
  } catch (error) {
    console.warn("Falling back to sample data after Prisma read failed.", error);
    return sampleDataFallback("Using sample data because the database could not be reached.");
  }
}

export async function getCatalogueData(userId: string): Promise<AppCatalogueData> {
  if (!process.env.DATABASE_URL) {
    return {
      catalogue: sampleAppData.catalogue,
      notice: "Using sample data because DATABASE_URL is not configured.",
      source: sampleAppData.source,
    };
  }

  try {
    return {
      catalogue: await getCatalogueItems(userId),
      source: "database",
    };
  } catch (error) {
    console.warn("Falling back to sample catalogue after Prisma read failed.", error);
    return {
      catalogue: sampleAppData.catalogue,
      notice: "Using sample data because the database catalogue could not be reached.",
      source: sampleAppData.source,
    };
  }
}

export async function getCatalogueSetData(setName: string, setId?: string | null): Promise<AppCatalogueData> {
  const normalizedSetName = normalizeOptionalText(setName);
  const normalizedSetId = normalizeOptionalText(setId ?? undefined);

  if (!process.env.DATABASE_URL) {
    const catalogue = sampleAppData.catalogue.filter((item) => item.type === "card" && item.set === normalizedSetName);

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
          orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
          take: PRICE_HISTORY_LIMIT,
        },
      },
      orderBy: [{ number: "asc" }, { name: "asc" }],
    });

    return {
      catalogue: sortCatalogueSearchResults(
        cards.map((card) => mapCardPrintingToCatalogueItem(card, card.priceSnapshots)),
        "set-number-asc",
      ),
      source: "database",
    };
  } catch (error) {
    console.warn("Falling back to sample set catalogue after Prisma read failed.", error);
    return {
      catalogue: sampleAppData.catalogue.filter((item) => item.type === "card" && item.set === normalizedSetName),
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

  if (!process.env.DATABASE_URL) {
    const catalogue = filterAndSortCatalogue(sampleAppData.catalogue, query);

    return {
      catalogue: catalogue.slice(0, query.limit),
      hasMore: catalogue.length > query.limit,
      query,
      resultCount: catalogue.length,
      source: sampleAppData.source,
      notice: "Using sample data because DATABASE_URL is not configured.",
    };
  }

  try {
    const catalogue = await searchCatalogueItems(userId, query);

    return {
      catalogue: catalogue.slice(0, query.limit),
      hasMore: catalogue.length > query.limit,
      query,
      resultCount: catalogue.length,
      source: "database",
    };
  } catch (error) {
    console.warn("Falling back to sample catalogue search after Prisma read failed.", error);
    const catalogue = filterAndSortCatalogue(sampleAppData.catalogue, query);

    return {
      catalogue: catalogue.slice(0, query.limit),
      hasMore: catalogue.length > query.limit,
      query,
      resultCount: catalogue.length,
      source: sampleAppData.source,
      notice: "Using sample data because the database catalogue search could not be reached.",
    };
  }
}

async function getCatalogueItems(userId: string): Promise<CatalogueItem[]> {
  const [cardPrintings, sealedProducts] = await Promise.all([
    prisma.cardPrinting.findMany({
      include: {
        cardSet: true,
        priceSnapshots: {
          orderBy: { observedAt: "desc" },
          take: PRICE_HISTORY_LIMIT,
        },
      },
      orderBy: [{ cardSet: { releaseDate: "desc" } }, { number: "asc" }],
    }),
    prisma.sealedProduct.findMany({
      where: {
        OR: [
          { visibility: CatalogueVisibility.GLOBAL },
          { createdByUserId: userId },
        ],
      },
      include: {
        relatedCardSet: true,
        priceSnapshots: {
          orderBy: { observedAt: "desc" },
          take: PRICE_HISTORY_LIMIT,
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return [
    ...cardPrintings.map((card) =>
      mapCardPrintingToCatalogueItem(card, card.priceSnapshots),
    ),
    ...sealedProducts.map((product) =>
      mapSealedProductToCatalogueItem(product, product.priceSnapshots),
    ),
  ];
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
    include: {
      cardSet: true,
      priceSnapshots: {
        orderBy: { observedAt: "desc" },
        take: PRICE_HISTORY_LIMIT,
      },
    },
    orderBy: [{ cardSet: { releaseDate: "desc" } }, { number: "asc" }],
    take: catalogueSearchFetchLimit(query),
  });
  const catalogue = cards.map((card) => mapCardPrintingToCatalogueItem(card, card.priceSnapshots));

  return sortCatalogueSearchResults(catalogue, query.sort);
}

async function searchSealedProducts(
  userId: string,
  query: NormalizedCatalogueSearchInput,
): Promise<CatalogueItem[]> {
  if (isCatalogueValueSort(query.sort)) {
    return searchSealedProductsByValue(userId, query);
  }

  const filters: Prisma.SealedProductWhereInput[] = [
    {
      OR: [
        { visibility: CatalogueVisibility.GLOBAL },
        { createdByUserId: userId },
      ],
    },
  ];

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
    include: {
      relatedCardSet: true,
      priceSnapshots: {
        orderBy: { observedAt: "desc" },
        take: PRICE_HISTORY_LIMIT,
      },
    },
    orderBy: { name: "asc" },
    take: catalogueSearchFetchLimit(query),
  });
  const catalogue = products.map((product) =>
    mapSealedProductToCatalogueItem(product, product.priceSnapshots),
  );

  return sortCatalogueSearchResults(catalogue, query.sort);
}

async function searchCardPrintingsByValue(query: NormalizedCatalogueSearchInput): Promise<CatalogueItem[]> {
  const rows = await prisma.$queryRaw<OrderedCatalogueId[]>(Prisma.sql`
    WITH latest_prices AS (
      SELECT DISTINCT ON (card_printing_id)
        card_printing_id,
        price_minor
      FROM price_snapshots
      WHERE card_printing_id IS NOT NULL
        AND item_type = 'card'::item_type
      ORDER BY card_printing_id, observed_at DESC, created_at DESC
    )
    SELECT cp.id
    FROM card_printings cp
    JOIN card_sets cs ON cs.id = cp.card_set_id
    LEFT JOIN latest_prices lp ON lp.card_printing_id = cp.id
    ${cardCatalogueSearchWhere(query)}
    ORDER BY
      CASE WHEN lp.price_minor IS NULL THEN 1 ELSE 0 END ASC,
      lp.price_minor ${catalogueValueSortDirection(query.sort)},
      cp.name ASC,
      cp.number ASC
    LIMIT ${catalogueSearchFetchLimit(query)}
  `);

  return hydrateCardPrintingsByOrderedIds(rows.map((row) => row.id));
}

async function searchSealedProductsByValue(
  userId: string,
  query: NormalizedCatalogueSearchInput,
): Promise<CatalogueItem[]> {
  const rows = await prisma.$queryRaw<OrderedCatalogueId[]>(Prisma.sql`
    WITH latest_prices AS (
      SELECT DISTINCT ON (sealed_product_id)
        sealed_product_id,
        price_minor
      FROM price_snapshots
      WHERE sealed_product_id IS NOT NULL
        AND item_type = 'sealed_product'::item_type
      ORDER BY sealed_product_id, observed_at DESC, created_at DESC
    )
    SELECT sp.id
    FROM sealed_products sp
    LEFT JOIN card_sets cs ON cs.id = sp.related_card_set_id
    LEFT JOIN latest_prices lp ON lp.sealed_product_id = sp.id
    ${sealedCatalogueSearchWhere(userId, query)}
    ORDER BY
      CASE WHEN lp.price_minor IS NULL THEN 1 ELSE 0 END ASC,
      lp.price_minor ${catalogueValueSortDirection(query.sort)},
      sp.name ASC
    LIMIT ${catalogueSearchFetchLimit(query)}
  `);

  return hydrateSealedProductsByOrderedIds(rows.map((row) => row.id));
}

async function hydrateCardPrintingsByOrderedIds(ids: string[]): Promise<CatalogueItem[]> {
  if (!ids.length) {
    return [];
  }

  const order = new Map(ids.map((id, index) => [id, index]));
  const cards = await prisma.cardPrinting.findMany({
    where: { id: { in: ids } },
    include: {
      cardSet: true,
      priceSnapshots: {
        orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
        take: PRICE_HISTORY_LIMIT,
      },
    },
  });

  return cards
    .map((card) => mapCardPrintingToCatalogueItem(card, card.priceSnapshots))
    .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
}

async function hydrateSealedProductsByOrderedIds(ids: string[]): Promise<CatalogueItem[]> {
  if (!ids.length) {
    return [];
  }

  const order = new Map(ids.map((id, index) => [id, index]));
  const products = await prisma.sealedProduct.findMany({
    where: { id: { in: ids } },
    include: {
      relatedCardSet: true,
      priceSnapshots: {
        orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
        take: PRICE_HISTORY_LIMIT,
      },
    },
  });

  return products
    .map((product) => mapSealedProductToCatalogueItem(product, product.priceSnapshots))
    .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
}

function referencedCatalogueItems(
  collectionItems: CatalogueReferenceRecord[],
  wishlistItems: CatalogueReferenceRecord[],
): CatalogueItem[] {
  const byId = new Map<string, CatalogueItem>();

  for (const record of [...collectionItems, ...wishlistItems]) {
    const item = record.cardPrinting
      ? mapCardPrintingToCatalogueItem(record.cardPrinting, record.cardPrinting.priceSnapshots)
      : record.sealedProduct
        ? mapSealedProductToCatalogueItem(record.sealedProduct, record.sealedProduct.priceSnapshots)
        : null;

    if (item) {
      byId.set(item.id, item);
    }
  }

  return Array.from(byId.values());
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
  const limit = Number(input.limit);

  return {
    language: normalizeCatalogueLanguageFilter(input.language),
    limit:
      Number.isFinite(limit) && limit > 0
        ? Math.min(Math.floor(limit), CATALOGUE_SEARCH_MAX_LIMIT)
        : 40,
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
  const multiplier = query.q || query.set !== "all" || query.rarity !== "all" || query.language !== "all"
    ? CATALOGUE_SEARCH_FETCH_MULTIPLIER
    : 3;

  return Math.min(CATALOGUE_SEARCH_MAX_LIMIT * CATALOGUE_SEARCH_FETCH_MULTIPLIER, query.limit * multiplier);
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

function sortCatalogueSearchResults(items: CatalogueItem[], sort: string) {
  return [...items].sort((left, right) => {
    if (sort === "value-asc") {
      return compareCatalogueValues(left, right, "asc") || compareCatalogueNames(left, right);
    }

    if (sort === "name-asc") {
      return compareCatalogueNames(left, right);
    }

    if (sort === "name-desc") {
      return compareCatalogueNames(right, left);
    }

    if (sort === "set-number-asc") {
      return compareCatalogueSetNumbers(left, right);
    }

    if (sort === "set-number-desc") {
      return compareCatalogueSetNumbers(right, left);
    }

    if (sort === "rarity") {
      return left.rarity.localeCompare(right.rarity) || compareCatalogueNames(left, right);
    }

    return compareCatalogueValues(right, left, "desc") || compareCatalogueNames(left, right);
  });
}

function compareCatalogueValues(left: CatalogueItem, right: CatalogueItem, direction: "asc" | "desc") {
  const leftValue = left.hasPrice ? left.valueMinor : null;
  const rightValue = right.hasPrice ? right.valueMinor : null;

  if (leftValue === null && rightValue === null) {
    return 0;
  }

  if (leftValue === null) {
    return direction === "asc" ? 1 : -1;
  }

  if (rightValue === null) {
    return direction === "asc" ? -1 : 1;
  }

  return leftValue - rightValue;
}

function compareCatalogueNames(left: CatalogueItem, right: CatalogueItem) {
  return left.name.localeCompare(right.name, undefined, { numeric: true });
}

function compareCatalogueSetNumbers(left: CatalogueItem, right: CatalogueItem) {
  return `${left.set} ${left.number}`.localeCompare(`${right.set} ${right.number}`, undefined, {
    numeric: true,
  });
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
  if (item.overrideValueMinor !== undefined) {
    return item.overrideValueMinor;
  }

  if (!catalogueItem?.hasPrice) {
    return null;
  }

  const unitValue = catalogueValueMinorForVariant(catalogueItem, item.variant) ?? catalogueItem.valueMinor;

  return Math.round(unitValue * conditionValueMultiplier(item.condition)) * item.quantity;
}

export async function createCollectionItem(
  userId: string,
  input: CreateCollectionItemInput,
): Promise<CollectionItem> {
  assertDatabaseConfigured();

  const [cardPrinting, sealedProduct] = await Promise.all([
    prisma.cardPrinting.findUnique({
      where: { id: input.catalogueId },
      include: {
        cardSet: true,
        priceSnapshots: { orderBy: { observedAt: "desc" }, take: 1 },
      },
    }),
    prisma.sealedProduct.findUnique({
      where: { id: input.catalogueId },
      include: {
        relatedCardSet: true,
        priceSnapshots: { orderBy: { observedAt: "desc" }, take: 1 },
      },
    }),
  ]);

  if (!cardPrinting && !sealedProduct) {
    throw new Error("Catalogue item not found.");
  }

  const itemType = cardPrinting ? PrismaItemType.CARD : PrismaItemType.SEALED_PRODUCT;
  const storageLocationId = await resolveStorageLocationId(userId, input.location);
  const paidMinor = parseMoneyToMinor(input.paid);
  const overrideMinor = parseMoneyToMinor(input.overrideValue);

  const created = await prisma.collectionItem.create({
    data: {
      userId,
      itemType,
      cardPrintingId: cardPrinting?.id,
      sealedProductId: sealedProduct?.id,
      quantity: Math.max(1, Number(input.quantity ?? 1)),
      condition: conditionToEnum(input.condition, itemType),
      language: languageToCode(input.language),
      variantLabel: input.variant || defaultVariant(itemType),
      purchasePriceMinor: paidMinor,
      purchaseCurrency: paidMinor === undefined ? undefined : "GBP",
      purchaseDate: paidMinor === undefined ? undefined : new Date(),
      currentValueOverrideMinor: overrideMinor,
      currentValueOverrideCurrency: overrideMinor === undefined ? undefined : "GBP",
      valuationNote: normalizeOptionalText(input.valuationNote),
      storageLocationId,
      notes: input.notes || undefined,
      events: {
        create: {
          userId,
          eventType: CollectionEventType.ADDED,
          quantity: Math.max(1, Number(input.quantity ?? 1)),
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
          priceSnapshots: { orderBy: { observedAt: "desc" }, take: 1 },
        },
      },
      sealedProduct: {
        include: {
          relatedCardSet: true,
          priceSnapshots: { orderBy: { observedAt: "desc" }, take: 1 },
        },
      },
      storageLocation: true,
    },
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
    },
  });

  if (!existing) {
    throw new Error("Collection item not found.");
  }

  const storageLocationId = await resolveStorageLocationId(userId, input.location);
  const paidMinor = parseMoneyToMinor(input.paid);
  const overrideMinor = parseMoneyToMinor(input.overrideValue);
  const quantity = Math.max(1, Number(input.quantity ?? 1));
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

  const updated = await prisma.collectionItem.update({
    where: { id: existing.id },
    data: {
      quantity,
      condition: conditionToEnum(input.condition, existing.itemType),
      language: languageToCode(input.language),
      variantLabel: input.variant || defaultVariant(existing.itemType),
      purchasePriceMinor: paidMinor ?? null,
      purchaseCurrency: paidMinor === undefined ? null : "GBP",
      purchaseDate: paidMinor === undefined ? null : new Date(),
      gradedCompany,
      gradedScore,
      currentValueOverrideMinor: input.overrideValue === undefined ? undefined : overrideMinor ?? null,
      currentValueOverrideCurrency:
        input.overrideValue === undefined ? undefined : overrideMinor === undefined ? null : "GBP",
      valuationNote: input.valuationNote === undefined ? undefined : normalizeOptionalText(input.valuationNote) ?? null,
      storageLocationId: storageLocationId ?? null,
      notes: input.notes || null,
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
    throw new Error("Collection item not found.");
  }

  await prisma.collectionItem.update({
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
    },
  });

  if (!existing) {
    throw new Error("Collection item not found.");
  }

  const amountMinor = parseMoneyToMinor(input.amount);
  const occurredAt = parseDateInput(input.occurredAt) ?? new Date();

  await prisma.collectionItem.update({
    where: { id: existing.id },
    data: {
      soldAt: occurredAt,
      archivedAt: new Date(),
      events: {
        create: {
          userId,
          eventType: CollectionEventType.SOLD,
          quantity: existing.quantity,
          amountMinor,
          currency: amountMinor === undefined ? undefined : "GBP",
          occurredAt,
          notes: normalizeOptionalText(input.notes) ?? "Sold from app API.",
          metadata: { source: "app_api" },
        },
      },
    },
  });
}

export async function createStorageLocation(
  userId: string,
  input: CreateStorageLocationInput,
): Promise<StorageLocation> {
  assertDatabaseConfigured();

  const name = normalizeStorageName(input.name);
  const notes = normalizeOptionalText(input.notes);
  const type = storageLocationTypeToEnum(input.type);

  const location = await prisma.storageLocation.upsert({
    where: {
      userId_name: {
        userId,
        name,
      },
    },
    update: {
      type,
      notes: notes ?? null,
    },
    create: {
      userId,
      name,
      type,
      notes,
    },
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
    throw new Error("Storage location not found.");
  }

  const location = await prisma.storageLocation.update({
    where: { id: existing.id },
    data: {
      name: input.name === undefined ? undefined : normalizeStorageName(input.name),
      type: input.type === undefined ? undefined : storageLocationTypeToEnum(input.type),
      notes: input.notes === undefined ? undefined : normalizeOptionalText(input.notes) ?? null,
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
  const estimatedValueMinor = parseMoneyToMinor(input.estimatedValue);

  const product = await prisma.sealedProduct.create({
    data: {
      createdByUserId: userId,
      relatedCardSetId: relatedCardSet?.id,
      name,
      productType,
      notes: normalizeOptionalText(input.notes),
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
        orderBy: { observedAt: "desc" },
        take: PRICE_HISTORY_LIMIT,
      },
    },
  });

  return mapSealedProductToCatalogueItem(product, product.priceSnapshots);
}

export async function createWishlistItem(userId: string, catalogueId: string): Promise<WishlistItem> {
  assertDatabaseConfigured();

  const [cardPrinting, sealedProduct] = await Promise.all([
    prisma.cardPrinting.findUnique({
      where: { id: catalogueId },
      include: { priceSnapshots: { orderBy: { observedAt: "desc" }, take: 1 } },
    }),
    prisma.sealedProduct.findUnique({
      where: { id: catalogueId },
      include: { priceSnapshots: { orderBy: { observedAt: "desc" }, take: 1 } },
    }),
  ]);

  if (!cardPrinting && !sealedProduct) {
    throw new Error("Catalogue item not found.");
  }

  const priceSnapshot = cardPrinting?.priceSnapshots[0] ?? sealedProduct?.priceSnapshots[0];
  const targetPriceMinor = defaultWishlistTargetPriceMinor(priceSnapshot?.priceMinor);

  const created = await prisma.wishlistItem.upsert({
    where: cardPrinting
      ? { userId_cardPrintingId: { userId, cardPrintingId: cardPrinting.id } }
      : { userId_sealedProductId: { userId, sealedProductId: sealedProduct!.id } },
    update: {},
    create: {
      userId,
      itemType: cardPrinting ? PrismaItemType.CARD : PrismaItemType.SEALED_PRODUCT,
      cardPrintingId: cardPrinting?.id,
      sealedProductId: sealedProduct?.id,
      targetPriceMinor,
      targetCurrency: targetPriceMinor === undefined ? undefined : priceSnapshot?.currency ?? "GBP",
      priority:
        (priceSnapshot?.priceMinor ?? 0) > 10000
          ? WishlistPriority.GRAIL
          : WishlistPriority.HIGH,
      notes: "Added from app API.",
    },
    include: {
      cardPrinting: {
        include: {
          cardSet: true,
          priceSnapshots: { orderBy: { observedAt: "desc" }, take: 1 },
        },
      },
      sealedProduct: {
        include: {
          relatedCardSet: true,
          priceSnapshots: { orderBy: { observedAt: "desc" }, take: 1 },
        },
      },
    },
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
    throw new Error("Wishlist item not found.");
  }

  const targetPriceMinor = parseMoneyToMinor(input.targetPrice);
  const updated = await prisma.wishlistItem.update({
    where: { id: existing.id },
    data: {
      priority: input.priority === undefined ? undefined : priorityToEnum(input.priority),
      targetPriceMinor: input.targetPrice === undefined ? undefined : targetPriceMinor ?? null,
      targetCurrency: input.targetPrice === undefined ? undefined : targetPriceMinor === undefined ? null : "GBP",
      notes: input.notes === undefined ? undefined : normalizeOptionalText(input.notes) ?? null,
    },
  });

  return mapWishlistItem(updated);
}

async function resolveStorageLocationId(userId: string, location?: string) {
  if (!location || location === "Unassigned") {
    return undefined;
  }

  const storage = await prisma.storageLocation.upsert({
    where: {
      userId_name: {
        userId,
        name: location,
      },
    },
    update: {},
    create: {
      userId,
      name: location,
      type: StorageLocationType.OTHER,
    },
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
): CatalogueItem {
  const priceHistory = buildPriceHistory(prices);
  const latestPrice = preferredLatestPricePoint(priceHistory);
  const image =
    usableCardImageUrl(card.imageLargeUrl) ??
    usableCardImageUrl(card.imageSmallUrl) ??
    usableCardImageUrl(pokemonTcgImageUrlFromProviderIds(card.providerIds)) ??
    tcgdexJapaneseImageUrlFromProviderIds(card.providerIds) ??
    tcgplayerCardImageUrlFromPrices(prices);
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
      priceHistory,
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
  const priceHistory = buildPriceHistory(prices);
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
  priority: string;
  notes: string | null;
}): WishlistItem {
  return {
    id: item.id,
    catalogueId: item.cardPrintingId ?? item.sealedProductId ?? "",
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
  collectionItems: Array<{
    condition: string;
    storageLocationId: string | null;
    quantity: number;
    variantLabel: string | null;
    currentValueOverrideMinor: number | null;
    cardPrinting: { priceSnapshots: PriceLike[] } | null;
    sealedProduct: { priceSnapshots: PriceLike[] } | null;
  }>,
): StorageLocation[] {
  return locations.map((location) => {
    const locationItems = collectionItems.filter((item) => item.storageLocationId === location.id);
    return mapStorageLocation(location, locationItems);
  });
}

function mapStorageLocation(
  location: { id: string; name: string; type: string; notes: string | null },
  items: Array<{
    condition: string;
    quantity: number;
    variantLabel: string | null;
    currentValueOverrideMinor: number | null;
    cardPrinting: { priceSnapshots: PriceLike[] } | null;
    sealedProduct: { priceSnapshots: PriceLike[] } | null;
  }>,
): StorageLocation {
  return {
    id: location.id,
    name: location.name,
    type: storageLocationTypeLabel(location.type),
    notes: location.notes ?? undefined,
    itemCount: items.length,
    totalQuantity: items.reduce((total, item) => total + item.quantity, 0),
    valueMinor: items.reduce((total, item) => total + collectionItemValueMinor(item), 0),
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
        ? event.collectionItem.purchasePriceMinor ?? undefined
        : undefined,
    currency: event.currency ?? undefined,
    occurredAt: event.occurredAt.toISOString(),
    notes: event.notes ?? undefined,
  };
}

function collectionItemValueMinor(item: {
  condition: string;
  quantity: number;
  variantLabel: string | null;
  currentValueOverrideMinor: number | null;
  cardPrinting: { priceSnapshots: PriceLike[] } | null;
  sealedProduct: { priceSnapshots: PriceLike[] } | null;
}) {
  if (item.currentValueOverrideMinor !== null) {
    return item.currentValueOverrideMinor;
  }

  const priceHistory = buildPriceHistory(
    item.cardPrinting?.priceSnapshots ?? item.sealedProduct?.priceSnapshots ?? [],
  );
  const latestValue = preferredLatestPricePoint(priceHistory)?.valueMinor ?? 0;
  const unitValue = item.variantLabel
    ? latestPricePointForVariant(priceHistory, item.variantLabel)?.valueMinor ?? latestValue
    : latestValue;

  return Math.round(unitValue * conditionValueMultiplier(enumLabel(item.condition))) * item.quantity;
}

function conditionValueMultiplier(condition: string) {
  const normalized = condition.trim().toLowerCase();
  const multipliers: Record<string, number> = {
    mint: 1.05,
    "near mint": 1,
    excellent: 0.85,
    "light played": 0.7,
    played: 0.55,
    poor: 0.35,
    sealed: 1,
    unknown: 1,
  };

  return multipliers[normalized] ?? 1;
}

const collectionItemInclude = {
  cardPrinting: {
    include: {
      cardSet: true,
      priceSnapshots: { orderBy: { observedAt: "desc" }, take: PRICE_HISTORY_LIMIT },
    },
  },
  sealedProduct: {
    include: {
      relatedCardSet: true,
      priceSnapshots: { orderBy: { observedAt: "desc" }, take: PRICE_HISTORY_LIMIT },
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

function parseMoneyToMinor(value?: string) {
  const normalized = String(value ?? "").replace(/[^0-9.]/g, "");
  const amount = Number(normalized);

  if (!normalized || !Number.isFinite(amount)) {
    return undefined;
  }

  return Math.round(amount * 100);
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
  const name = value?.trim();

  if (!name) {
    throw new Error("Storage location name is required.");
  }

  return name;
}

function normalizeSealedProductName(value?: string) {
  const name = value?.trim();

  if (!name) {
    throw new Error("Sealed product name is required.");
  }

  return name;
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
