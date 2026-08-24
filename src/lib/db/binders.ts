import { randomBytes } from "node:crypto";
import { BinderVisibility, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  BinderInputError,
  normalizeBinderLayout,
  type BinderLayoutInput,
} from "@/lib/binders/layout";
import { lockCollectionItemsForBinderConsistency } from "@/lib/binders/slot-reconciliation";
import {
  assertUserResourceQuota,
  lockUserResourceQuota,
} from "@/lib/db/user-quotas";

export { BinderInputError, normalizeBinderLayout, type BinderLayoutInput } from "@/lib/binders/layout";

const DEFAULT_PAGE_COUNT = 2;
const SLOTS_PER_PAGE = 9;
const COVER_STYLES = new Set(["forest", "midnight", "oxblood", "sapphire", "sunset", "ivory"]);

const binderInclude = {
  pages: {
    orderBy: { position: "asc" as const },
    include: {
      slots: {
        orderBy: { position: "asc" as const },
      },
    },
  },
} satisfies Prisma.BinderInclude;

const sharedBinderInclude = {
  pages: {
    orderBy: { position: "asc" as const },
    include: {
      slots: {
        orderBy: { position: "asc" as const },
        include: {
          collectionItem: {
            select: {
              id: true,
              quantity: true,
              condition: true,
              language: true,
              variantLabel: true,
              cardPrinting: {
                select: {
                  id: true,
                  name: true,
                  number: true,
                  imageSmallUrl: true,
                  cardSet: { select: { name: true } },
                },
              },
              sealedProduct: {
                select: {
                  id: true,
                  name: true,
                  imageUrl: true,
                  productType: true,
                  relatedCardSet: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.BinderInclude;

export async function listBinders(userId: string) {
  return prisma.binder.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    include: binderInclude,
  });
}

export async function getBinder(userId: string, binderId: string) {
  const binder = await prisma.binder.findFirst({
    where: { id: binderId, userId },
    include: binderInclude,
  });

  if (!binder) {
    throw new BinderInputError("Binder not found.");
  }

  return binder;
}

export async function getSharedBinder(shareSlug: string) {
  return prisma.binder.findFirst({
    where: {
      shareSlug: normalizeShareSlug(shareSlug),
      visibility: BinderVisibility.UNLISTED,
    },
    include: sharedBinderInclude,
  });
}

export async function createBinder(
  userId: string,
  input: { coverStyle?: unknown; description?: unknown; isDefault?: unknown; name?: unknown },
) {
  const name = requiredText(input.name, "Binder name", 80);
  const description = optionalText(input.description, 500);
  const coverStyle = normalizeCoverStyle(input.coverStyle);

  return prisma.$transaction(async (transaction) => {
    await lockUserResourceQuota(transaction, userId, "binders");
    const binderCount = await transaction.binder.count({ where: { userId } });
    assertUserResourceQuota(binderCount, "binders");
    const isDefault = input.isDefault === true || binderCount === 0;

    if (isDefault) {
      await transaction.binder.updateMany({ where: { userId }, data: { isDefault: false } });
    }

    return transaction.binder.create({
      data: {
        userId,
        name,
        description,
        coverStyle,
        isDefault,
        pages: {
          create: Array.from({ length: DEFAULT_PAGE_COUNT }, (_, position) => ({
            position,
            slots: {
              create: Array.from({ length: SLOTS_PER_PAGE }, (_entry, slotPosition) => ({
                position: slotPosition,
              })),
            },
          })),
        },
      },
      include: binderInclude,
    });
  });
}

export async function updateBinder(
  userId: string,
  binderId: string,
  input: {
    coverStyle?: unknown;
    description?: unknown;
    isDefault?: unknown;
    name?: unknown;
    visibility?: unknown;
  },
) {
  return prisma.$transaction(async (transaction) => {
    await lockUserResourceQuota(transaction, userId, "binders");
    const existing = await transaction.binder.findFirst({ where: { id: binderId, userId } });
    if (!existing) throw new BinderInputError("Binder not found.");

    const data: Prisma.BinderUpdateInput = {};
    if (input.name !== undefined) data.name = requiredText(input.name, "Binder name", 80);
    if (input.description !== undefined) data.description = optionalText(input.description, 500);
    if (input.coverStyle !== undefined) data.coverStyle = normalizeCoverStyle(input.coverStyle);
    if (input.visibility !== undefined) {
      const visibility = normalizeVisibility(input.visibility);
      data.visibility = visibility;
      data.shareSlug = visibility === BinderVisibility.UNLISTED
        ? existing.shareSlug ?? createShareSlug()
        : null;
    }

    if (input.isDefault === true) {
      await transaction.binder.updateMany({ where: { userId }, data: { isDefault: false } });
      data.isDefault = true;
    } else if (input.isDefault === false && existing.isDefault) {
      throw new BinderInputError("Choose another default binder before removing this default.");
    }

    return transaction.binder.update({
      where: { id: binderId },
      data,
      include: binderInclude,
    });
  });
}

export async function replaceBinderLayout(userId: string, binderId: string, input: BinderLayoutInput) {
  const pages = normalizeBinderLayout(input);
  const itemIds = [...new Set(
    pages.flatMap((page) => page.slots.map((slot) => slot.collectionItemId).filter(isString)),
  )];

  return retrySerializableTransaction(() => prisma.$transaction(async (transaction) => {
    const binder = await transaction.binder.findFirst({
      where: { id: binderId, userId },
      select: { id: true },
    });

    if (!binder) throw new BinderInputError("Binder not found.");

    await lockCollectionItemsForBinderConsistency(transaction, userId, itemIds);
    const ownedItems = itemIds.length
      ? await transaction.collectionItem.findMany({
          where: { id: { in: itemIds }, userId, archivedAt: null },
          select: { id: true, quantity: true },
        })
      : [];
    validateAssignedCopies(pages, new Map(ownedItems.map((item) => [item.id, item.quantity])));

    await transaction.binderPage.deleteMany({ where: { binderId } });
    await transaction.binder.update({
      where: { id: binderId },
      data: {
        pages: {
          create: pages.map((page) => ({
            position: page.position,
            slots: {
              create: page.slots.map((slot) => ({
                position: slot.position,
                collectionItemId: slot.collectionItemId,
                copyIndex: slot.copyIndex,
                note: slot.note,
              })),
            },
          })),
        },
      },
    });

    return transaction.binder.findUniqueOrThrow({ where: { id: binderId }, include: binderInclude });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

function validateAssignedCopies(
  pages: ReturnType<typeof normalizeBinderLayout>,
  ownedById: Map<string, number>,
) {
  const assignedCopies = new Set<string>();

  for (const page of pages) {
    for (const slot of page.slots) {
      if (!slot.collectionItemId) continue;
      const quantity = ownedById.get(slot.collectionItemId);

      if (!quantity) throw new BinderInputError("A binder slot refers to an unavailable collection item.");
      if (!slot.copyIndex || slot.copyIndex > quantity) {
        throw new BinderInputError("A binder slot refers to a copy that is not owned.");
      }

      const copyKey = `${slot.collectionItemId}:${slot.copyIndex}`;
      if (assignedCopies.has(copyKey)) {
        throw new BinderInputError("The same owned copy cannot occupy more than one binder pocket.");
      }
      assignedCopies.add(copyKey);
    }
  }
}

async function retrySerializableTransaction<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("Binder layout could not be saved safely.");
}

export async function deleteBinder(userId: string, binderId: string) {
  return prisma.$transaction(async (transaction) => {
    await lockUserResourceQuota(transaction, userId, "binders");
    const binder = await transaction.binder.findFirst({ where: { id: binderId, userId } });

    if (!binder) {
      throw new BinderInputError("Binder not found.");
    }

    await transaction.binder.delete({ where: { id: binderId } });

    if (binder.isDefault) {
      const replacement = await transaction.binder.findFirst({
        where: { userId },
        orderBy: { updatedAt: "desc" },
      });

      if (replacement) {
        await transaction.binder.update({ where: { id: replacement.id }, data: { isDefault: true } });
      }
    }
  });
}

function requiredText(value: unknown, label: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";

  if (!text) throw new BinderInputError(`${label} is required.`);
  if (text.length > maxLength) throw new BinderInputError(`${label} must be ${maxLength} characters or fewer.`);

  return text;
}

function optionalText(value: unknown, maxLength: number) {
  if (value === undefined || value === null || value === "") return null;
  const text = typeof value === "string" ? value.trim() : "";

  if (text.length > maxLength) throw new BinderInputError(`Text must be ${maxLength} characters or fewer.`);

  return text || null;
}

function normalizeCoverStyle(value: unknown) {
  const style = typeof value === "string" ? value.trim().toLowerCase() : "forest";

  if (!COVER_STYLES.has(style)) {
    throw new BinderInputError("Binder cover style is not supported.");
  }

  return style;
}

function normalizeVisibility(value: unknown) {
  if (value === "private") return BinderVisibility.PRIVATE;
  if (value === "unlisted") return BinderVisibility.UNLISTED;
  throw new BinderInputError("Binder visibility must be private or unlisted.");
}

function createShareSlug() {
  return randomBytes(18).toString("base64url");
}

function normalizeShareSlug(value: string) {
  const slug = value.trim();

  if (!/^[A-Za-z0-9_-]{20,40}$/.test(slug)) {
    return "invalid";
  }

  return slug;
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}
