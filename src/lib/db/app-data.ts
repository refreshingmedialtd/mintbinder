import {
  CatalogueVisibility,
  CollectionEventType,
  GradingCompany,
  ItemCondition,
  ItemType as PrismaItemType,
  SealedProductType,
  StorageLocationType,
  WishlistPriority,
} from "@prisma/client";
import { sampleAppData } from "@/lib/sample-data";
import { getEntitlements } from "@/lib/entitlements";
import { getNotificationPreferences } from "@/lib/notifications/preferences";
import { buildPriceHistory, latestPricePoint } from "@/lib/pricing/price-history";
import type {
  AppData,
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
  observedAt: Date;
};

const PRICE_HISTORY_LIMIT = 8;

export type CreateCollectionItemInput = {
  catalogueId: string;
  quantity?: number;
  condition?: string;
  language?: string;
  variant?: string;
  paid?: string;
  location?: string;
  notes?: string;
};

export type UpdateCollectionItemInput = Omit<CreateCollectionItemInput, "catalogueId"> & {
  gradeCompany?: string;
  gradeScore?: string;
  overrideValue?: string;
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
    notice,
  };
}

export async function getAppData(userId: string): Promise<AppData> {
  if (!process.env.DATABASE_URL) {
    return sampleDataFallback("Using sample data because DATABASE_URL is not configured.");
  }

  try {
    const [
      subscription,
      notificationPreferences,
      cardPrintings,
      sealedProducts,
      collectionItems,
      wishlistItems,
      cardSets,
      storageLocations,
      collectionEvents,
    ] =
      await Promise.all([
        getEntitlements(userId),
        getNotificationPreferences(userId),
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
          include: {
            cardPrintings: {
              select: {
                id: true,
                collectionItems: {
                  where: {
                    userId,
                    archivedAt: null,
                  },
                  select: { id: true },
                },
              },
            },
          },
          orderBy: { releaseDate: "desc" },
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

    const catalogue: CatalogueItem[] = [
      ...cardPrintings.map((card) =>
        mapCardPrintingToCatalogueItem(card, card.priceSnapshots),
      ),
      ...sealedProducts.map((product) =>
        mapSealedProductToCatalogueItem(product, product.priceSnapshots),
      ),
    ];

    return {
      catalogue,
      collection: collectionItems.map(mapCollectionItem),
      wishlist: wishlistItems.map(mapWishlistItem),
      sets: cardSets.map(mapSetProgress),
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
      storageLocationId,
      notes: input.notes || undefined,
      events: {
        create: {
          userId,
          eventType: CollectionEventType.ADDED,
          quantity: Math.max(1, Number(input.quantity ?? 1)),
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
      targetPriceMinor: priceSnapshot?.priceMinor,
      targetCurrency: priceSnapshot ? priceSnapshot.currency : undefined,
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
    number: string;
    rarity: string | null;
    imageLargeUrl: string | null;
    imageSmallUrl: string | null;
    cardSet: { name: string };
  },
  prices: PriceLike[] = [],
): CatalogueItem {
  const priceHistory = buildPriceHistory(prices);
  const latestPrice = latestPricePoint(priceHistory);

  return {
    id: card.id,
    type: "card",
    name: card.name,
    set: card.cardSet.name,
    number: card.number,
    rarity: card.rarity ?? "Unknown",
    image: card.imageLargeUrl ?? card.imageSmallUrl ?? undefined,
    valueMinor: latestPrice?.valueMinor ?? 0,
    confidence: latestPrice?.confidence ?? "Weak",
    priceSource: latestPrice?.source,
    priceObservedAt: latestPrice?.observedAt,
    priceHistory: priceHistory.length ? priceHistory : undefined,
  };
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
  const latestPrice = latestPricePoint(priceHistory);

  return {
    id: product.id,
    type: "sealed",
    name: product.name,
    set: product.relatedCardSet?.name ?? "Sealed product",
    number: "Sealed",
    rarity: enumLabel(product.productType),
    image: product.imageUrl ?? undefined,
    valueMinor: latestPrice?.valueMinor ?? 0,
    confidence: latestPrice?.confidence ?? "Weak",
    priceSource: latestPrice?.source,
    priceObservedAt: latestPrice?.observedAt,
    priceHistory: priceHistory.length ? priceHistory : undefined,
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
  name: string;
  total: number | null;
  cardPrintings: Array<{ id: string; collectionItems: Array<{ id: string }> }>;
}): SetProgress {
  return {
    id: set.id,
    name: set.name,
    owned: set.cardPrintings.filter((card) => card.collectionItems.length > 0).length,
    total: set.total ?? set.cardPrintings.length,
  };
}

function mapStorageLocations(
  locations: Array<{ id: string; name: string; type: string; notes: string | null }>,
  collectionItems: Array<{
    storageLocationId: string | null;
    quantity: number;
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
    quantity: number;
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
  quantity: number;
  currentValueOverrideMinor: number | null;
  cardPrinting: { priceSnapshots: PriceLike[] } | null;
  sealedProduct: { priceSnapshots: PriceLike[] } | null;
}) {
  if (item.currentValueOverrideMinor !== null) {
    return item.currentValueOverrideMinor;
  }

  const unitValue =
    item.cardPrinting?.priceSnapshots[0]?.priceMinor ??
    item.sealedProduct?.priceSnapshots[0]?.priceMinor ??
    0;

  return unitValue * item.quantity;
}

const collectionItemInclude = {
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
  const languages: Record<string, string> = {
    en: "English",
    ja: "Japanese",
    de: "German",
    fr: "French",
  };

  return value ? languages[value] ?? enumLabel(value) : "Unknown";
}

function languageToCode(value?: string) {
  const languages: Record<string, string> = {
    English: "en",
    Japanese: "ja",
    German: "de",
    French: "fr",
  };

  return value ? languages[value] ?? value.toLowerCase() : "en";
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
