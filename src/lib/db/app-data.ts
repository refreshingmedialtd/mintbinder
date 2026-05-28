import {
  CollectionEventType,
  ItemCondition,
  ItemType as PrismaItemType,
  StorageLocationType,
  WishlistPriority,
} from "@prisma/client";
import { sampleAppData } from "@/lib/sample-data";
import type { AppData, CatalogueItem, CollectionItem, ItemType, SetProgress, WishlistItem } from "@/lib/types";
import { prisma } from "./prisma";

type PriceLike = {
  priceMinor: number;
  confidenceScore: number;
};

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

export type UpdateCollectionItemInput = Omit<CreateCollectionItemInput, "catalogueId">;

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
    const [cardPrintings, sealedProducts, collectionItems, wishlistItems, cardSets] =
      await Promise.all([
        prisma.cardPrinting.findMany({
          include: {
            cardSet: true,
            priceSnapshots: {
              orderBy: { observedAt: "desc" },
              take: 1,
            },
          },
          orderBy: [{ cardSet: { releaseDate: "desc" } }, { number: "asc" }],
        }),
        prisma.sealedProduct.findMany({
          include: {
            relatedCardSet: true,
            priceSnapshots: {
              orderBy: { observedAt: "desc" },
              take: 1,
            },
          },
          orderBy: { name: "asc" },
        }),
        prisma.collectionItem.findMany({
          where: {
            userId,
            archivedAt: null,
          },
          include: {
            cardPrinting: {
              include: {
                cardSet: true,
                priceSnapshots: {
                  orderBy: { observedAt: "desc" },
                  take: 1,
                },
              },
            },
            sealedProduct: {
              include: {
                relatedCardSet: true,
                priceSnapshots: {
                  orderBy: { observedAt: "desc" },
                  take: 1,
                },
              },
            },
            storageLocation: true,
          },
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
                  take: 1,
                },
              },
            },
            sealedProduct: {
              include: {
                relatedCardSet: true,
                priceSnapshots: {
                  orderBy: { observedAt: "desc" },
                  take: 1,
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
      ]);

    const catalogue: CatalogueItem[] = [
      ...cardPrintings.map((card) =>
        mapCardPrintingToCatalogueItem(card, card.priceSnapshots[0]),
      ),
      ...sealedProducts.map((product) =>
        mapSealedProductToCatalogueItem(product, product.priceSnapshots[0]),
      ),
    ];

    return {
      catalogue,
      collection: collectionItems.map(mapCollectionItem),
      wishlist: wishlistItems.map(mapWishlistItem),
      sets: cardSets.map(mapSetProgress),
      source: "database",
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
    },
  });

  if (!existing) {
    throw new Error("Collection item not found.");
  }

  const storageLocationId = await resolveStorageLocationId(userId, input.location);
  const paidMinor = parseMoneyToMinor(input.paid);
  const quantity = Math.max(1, Number(input.quantity ?? 1));

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
      storageLocationId: storageLocationId ?? null,
      notes: input.notes || null,
      events: {
        create: {
          userId,
          eventType: CollectionEventType.EDITED,
          quantity,
          occurredAt: new Date(),
          notes: "Updated from app API.",
          metadata: { source: "app_api" },
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
  price?: PriceLike,
): CatalogueItem {
  return {
    id: card.id,
    type: "card",
    name: card.name,
    set: card.cardSet.name,
    number: card.number,
    rarity: card.rarity ?? "Unknown",
    image: card.imageLargeUrl ?? card.imageSmallUrl ?? undefined,
    valueMinor: price?.priceMinor ?? 0,
    confidence: confidenceFromScore(price?.confidenceScore),
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
  price?: PriceLike,
): CatalogueItem {
  return {
    id: product.id,
    type: "sealed",
    name: product.name,
    set: product.relatedCardSet?.name ?? "Sealed product",
    number: "Sealed",
    rarity: enumLabel(product.productType),
    image: product.imageUrl ?? undefined,
    valueMinor: price?.priceMinor ?? 0,
    confidence: confidenceFromScore(price?.confidenceScore),
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

function itemTypeToClient(value: string): ItemType {
  return value === PrismaItemType.SEALED_PRODUCT ? "sealed" : "card";
}

function confidenceFromScore(score?: number) {
  if (!score) {
    return "Weak";
  }

  if (score >= 80) {
    return "Strong";
  }

  if (score >= 60) {
    return "Fair";
  }

  return "Weak";
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

function defaultVariant(itemType: PrismaItemType) {
  return itemType === PrismaItemType.SEALED_PRODUCT ? "Factory sealed" : "Standard";
}

function gradeLabel(item: { itemType: string; gradedCompany: string | null; gradedScore: unknown }) {
  if (item.itemType === PrismaItemType.SEALED_PRODUCT) {
    return "N/A";
  }

  if (!item.gradedCompany) {
    return "Raw";
  }

  const score = item.gradedScore === null || item.gradedScore === undefined ? "" : ` ${item.gradedScore}`;

  return `${enumLabel(item.gradedCompany)}${score}`;
}

function parseMoneyToMinor(value?: string) {
  const normalized = String(value ?? "").replace(/[^0-9.]/g, "");
  const amount = Number(normalized);

  if (!normalized || !Number.isFinite(amount)) {
    return undefined;
  }

  return Math.round(amount * 100);
}

function dateOnly(value?: Date | null) {
  return value ? value.toISOString().slice(0, 10) : undefined;
}

function assertDatabaseConfigured() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }
}
