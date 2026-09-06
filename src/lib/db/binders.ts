import { randomBytes } from "node:crypto";
import { BinderVisibility, Prisma } from "@prisma/client";
import { prisma } from "./prisma.ts";
import {
  BinderInputError,
  MAX_STANDARD_BINDER_PAGES,
  normalizeBinderLayout,
  type BinderLayoutInput,
} from "../binders/layout.ts";
import { lockCollectionItemsForBinderConsistency } from "../binders/slot-reconciliation.ts";
import {
  consumeLegacyCustomBinderMarker,
  consumeLegacyDefaultBinderMarker,
  hasLegacyDefaultBinderMarker,
  hasManagedDefaultBinderMarker,
  preserveBinderDescriptionMarker,
  visibleBinderDescription,
  withLegacyCustomBinderMarker,
  withLegacyDefaultBinderMarker,
} from "../binders/migration-state.ts";
import {
  assertUserResourceQuota,
  lockUserResourceQuota,
} from "./user-quotas.ts";

export { BinderInputError, normalizeBinderLayout, type BinderLayoutInput } from "../binders/layout.ts";

const DEFAULT_PAGE_COUNT = 2;
const SLOTS_PER_PAGE = 9;
const COVER_STYLES = new Set(["forest", "midnight", "oxblood", "sapphire", "sunset", "ivory"]);

export class BinderVersionConflictError extends Error {
  constructor() {
    super("This binder changed in another tab or sync. Refresh it before saving again.");
    this.name = "BinderVersionConflictError";
  }
}

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
  const binder = await prisma.binder.findFirst({
    where: {
      shareSlug: normalizeShareSlug(shareSlug),
      visibility: BinderVisibility.UNLISTED,
    },
    include: sharedBinderInclude,
  });

  return binder ? { ...binder, description: visibleBinderDescription(binder.description) } : null;
}

export async function createBinder(
  userId: string,
  input: {
    coverStyle?: unknown;
    description?: unknown;
    isDefault?: unknown;
    legacySource?: unknown;
    managedDefaultBootstrap?: unknown;
    name?: unknown;
  },
  database: Pick<typeof prisma, "$transaction"> = prisma,
) {
  const name = requiredText(input.name, "Binder name", 80);
  const visibleDescription = visibleBinderDescription(optionalText(input.description, 500));
  const legacySource = optionalLegacyMigrationSource(input.legacySource);
  const managedDefaultBootstrap = input.managedDefaultBootstrap === true;
  const coverStyle = normalizeCoverStyle(input.coverStyle);

  if (managedDefaultBootstrap && legacySource) {
    throw new BinderInputError("A binder cannot use two migration sources.");
  }

  return database.$transaction(async (transaction) => {
    await lockUserResourceQuota(transaction, userId, "binders");
    const binderCount = await transaction.binder.count({ where: { userId } });
    assertUserResourceQuota(binderCount, "binders");
    const currentDefaults = await transaction.binder.findMany({
      where: { isDefault: true, userId },
      select: { description: true, id: true, updatedAt: true },
    });

    if (managedDefaultBootstrap && currentDefaults.length) {
      const existingManagedDefault = currentDefaults.find((binder) =>
        hasLegacyDefaultBinderMarker(binder.description) || hasManagedDefaultBinderMarker(binder.description)
      );
      if (existingManagedDefault) {
        return transaction.binder.findUniqueOrThrow({
          where: { id: existingManagedDefault.id },
          include: binderInclude,
        });
      }
      throw new BinderInputError("The full-collection binder has already been initialized.");
    }
    if (!managedDefaultBootstrap && !currentDefaults.length) {
      throw new BinderInputError("The full-collection binder must finish initializing before custom binders can be created.");
    }

    const isDefault = managedDefaultBootstrap || input.isDefault === true;
    const description = managedDefaultBootstrap
      ? withLegacyDefaultBinderMarker(visibleDescription)
      : legacySource
        ? withLegacyCustomBinderMarker(visibleDescription, legacySource)
        : visibleDescription;

    if (isDefault) {
      for (const currentDefault of currentDefaults) {
        await transaction.binder.update({
          where: { id: currentDefault.id },
          data: {
            isDefault: false,
            updatedAt: nextBinderVersion(currentDefault.updatedAt),
          },
        });
      }
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
    expectedUpdatedAt?: unknown;
    isDefault?: unknown;
    name?: unknown;
    visibility?: unknown;
  },
) {
  const expectedUpdatedAt = requiredBinderTimestamp(input.expectedUpdatedAt, "Expected binder version");

  return prisma.$transaction(async (transaction) => {
    await lockUserResourceQuota(transaction, userId, "binders");
    const existing = await transaction.binder.findFirst({ where: { id: binderId, userId } });
    if (!existing) throw new BinderInputError("Binder not found.");
    if (existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw new BinderVersionConflictError();
    }

    const data: Prisma.BinderUpdateInput = { updatedAt: nextBinderVersion(existing.updatedAt) };
    if (input.name !== undefined) data.name = requiredText(input.name, "Binder name", 80);
    if (input.description !== undefined) {
      const description = optionalText(input.description, 500);
      data.description = preserveBinderDescriptionMarker(existing.description, description);
    }
    if (input.coverStyle !== undefined) data.coverStyle = normalizeCoverStyle(input.coverStyle);
    if (input.visibility !== undefined) {
      const visibility = normalizeVisibility(input.visibility);
      data.visibility = visibility;
      data.shareSlug = visibility === BinderVisibility.UNLISTED
        ? existing.shareSlug ?? createShareSlug()
        : null;
    }

    if (input.isDefault === true) {
      const previousDefaults = await transaction.binder.findMany({
        where: { id: { not: binderId }, isDefault: true, userId },
        select: { id: true, updatedAt: true },
      });
      for (const previousDefault of previousDefaults) {
        await transaction.binder.update({
          where: { id: previousDefault.id },
          data: {
            isDefault: false,
            updatedAt: nextBinderVersion(previousDefault.updatedAt),
          },
        });
      }
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

export async function replaceBinderLayout(
  userId: string,
  binderId: string,
  input: BinderLayoutInput,
  options: {
    completeLegacyCustomMigration?: boolean;
    completeLegacyDefaultMigration?: boolean;
    expectedUpdatedAt?: unknown;
    releaseConflictsFromDefaultBinderId?: unknown;
    releaseConflictsFromDefaultUpdatedAt?: unknown;
  } = {},
) {
  const pages = normalizeBinderLayout(input);
  const expectedUpdatedAt = requiredBinderTimestamp(options.expectedUpdatedAt, "Expected binder version");
  const releaseBinderId = optionalBinderId(options.releaseConflictsFromDefaultBinderId);
  const releaseExpectedUpdatedAt = releaseBinderId
    ? requiredBinderTimestamp(options.releaseConflictsFromDefaultUpdatedAt, "Expected default binder version")
    : null;
  const itemIds = [...new Set(
    pages.flatMap((page) => page.slots.map((slot) => slot.collectionItemId).filter(isString)),
  )];

  return retrySerializableTransaction(() => prisma.$transaction(async (transaction) => {
    await lockUserResourceQuota(transaction, userId, "binders");
    const binder = await transaction.binder.findFirst({
      where: { id: binderId, userId },
      select: { description: true, id: true, isDefault: true, updatedAt: true },
    });

    if (!binder) throw new BinderInputError("Binder not found.");
    if (binder.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw new BinderVersionConflictError();
    }
    const allowsManagedCapacity = hasManagedDefaultBinderMarker(binder.description) || (
      binder.isDefault && hasLegacyDefaultBinderMarker(binder.description)
    );
    if (pages.length > MAX_STANDARD_BINDER_PAGES && !allowsManagedCapacity) {
      throw new BinderInputError(
        `Custom binders support at most ${MAX_STANDARD_BINDER_PAGES} pages.`,
      );
    }
    if (releaseBinderId === binder.id) {
      throw new BinderInputError("A binder cannot release conflicting copies from itself.");
    }
    if (releaseBinderId && binder.isDefault) {
      throw new BinderInputError("Only a non-default binder can receive copies from the full-collection binder.");
    }

    await lockCollectionItemsForBinderConsistency(transaction, userId, itemIds);
    const ownedItems = itemIds.length
      ? await transaction.collectionItem.findMany({
          where: { id: { in: itemIds }, userId, archivedAt: null },
          select: { id: true, quantity: true },
        })
      : [];
    validateAssignedCopies(pages, new Map(ownedItems.map((item) => [item.id, item.quantity])));

    if (releaseBinderId && releaseExpectedUpdatedAt) {
      const releaseBinder = await transaction.binder.findFirst({
        where: { id: releaseBinderId, userId },
        select: { description: true, id: true, isDefault: true, updatedAt: true },
      });

      if (
        !releaseBinder ||
        !releaseBinder.isDefault ||
        !(
          hasLegacyDefaultBinderMarker(releaseBinder.description) ||
          hasManagedDefaultBinderMarker(releaseBinder.description)
        )
      ) {
        throw new BinderInputError("The managed full-collection binder is no longer available for this transfer.");
      }

      const assignments = pages.flatMap((page) => page.slots).filter((slot) => slot.collectionItemId && slot.copyIndex);
      const conflictingSlots = assignments.length
        ? await transaction.binderSlot.findMany({
            where: {
              binderPage: { binderId: releaseBinder.id },
              OR: assignments.map((slot) => ({
                collectionItemId: slot.collectionItemId,
                copyIndex: slot.copyIndex,
              })),
            },
            select: {
              collectionItemId: true,
              copyIndex: true,
              id: true,
              note: true,
            },
          })
        : [];

      if (conflictingSlots.length) {
        if (releaseBinder.updatedAt.getTime() !== releaseExpectedUpdatedAt.getTime()) {
          throw new BinderVersionConflictError();
        }
        const releasedNotes = new Map(
          conflictingSlots
            .filter((slot) => slot.collectionItemId && slot.copyIndex && slot.note)
            .map((slot) => [`${slot.collectionItemId}:${slot.copyIndex}`, slot.note] as const),
        );

        for (const page of pages) {
          for (const slot of page.slots) {
            if (slot.note || !slot.collectionItemId || !slot.copyIndex) continue;
            slot.note = releasedNotes.get(`${slot.collectionItemId}:${slot.copyIndex}`) ?? null;
          }
        }

        await transaction.binderSlot.updateMany({
          where: { id: { in: conflictingSlots.map((slot) => slot.id) } },
          data: { collectionItemId: null, copyIndex: null, note: null },
        });
        await transaction.binder.update({
          where: { id: releaseBinder.id },
          data: { updatedAt: nextBinderVersion(releaseBinder.updatedAt) },
        });
      }
    }

    await transaction.binderPage.deleteMany({ where: { binderId } });
    const binderUpdate: Prisma.BinderUpdateInput = {
      updatedAt: nextBinderVersion(binder.updatedAt),
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
    };
    const migrationCompletion = binder.isDefault && options.completeLegacyDefaultMigration
      ? consumeLegacyDefaultBinderMarker(binder.description)
      : !binder.isDefault && options.completeLegacyCustomMigration
        ? consumeLegacyCustomBinderMarker(binder.description)
        : null;

    if (migrationCompletion?.consumed) {
      binderUpdate.description = migrationCompletion.description;
    }

    await transaction.binder.update({
      where: { id: binderId },
      data: binderUpdate,
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

export async function deleteBinder(userId: string, binderId: string, expectedVersion: unknown) {
  const expectedUpdatedAt = requiredBinderTimestamp(expectedVersion, "Expected binder version");

  return prisma.$transaction(async (transaction) => {
    await lockUserResourceQuota(transaction, userId, "binders");
    const binder = await transaction.binder.findFirst({ where: { id: binderId, userId } });

    if (!binder) {
      throw new BinderInputError("Binder not found.");
    }
    if (binder.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw new BinderVersionConflictError();
    }

    await transaction.binder.delete({ where: { id: binderId } });

    if (binder.isDefault) {
      const replacement = await transaction.binder.findFirst({
        where: { userId },
        orderBy: { updatedAt: "desc" },
      });

      if (replacement) {
        await transaction.binder.update({
          where: { id: replacement.id },
          data: {
            isDefault: true,
            updatedAt: nextBinderVersion(replacement.updatedAt),
          },
        });
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

function optionalBinderId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const id = typeof value === "string" ? value.trim() : "";

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new BinderInputError("Default binder ID is invalid.");
  }

  return id;
}

function optionalLegacyMigrationSource(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const source = typeof value === "string" ? value.trim() : "";

  if (!source || source === "default" || source.length > 120 || /[\]\r\n]/.test(source)) {
    throw new BinderInputError("Legacy binder source is invalid.");
  }

  return source;
}

function requiredBinderTimestamp(value: unknown, label: string) {
  const timestamp = typeof value === "string" ? value.trim() : "";
  const date = timestamp ? new Date(timestamp) : new Date(Number.NaN);

  if (!timestamp || Number.isNaN(date.getTime())) {
    throw new BinderInputError(`${label} is missing or invalid. Refresh binders and try again.`);
  }

  return date;
}

function nextBinderVersion(current: Date) {
  return new Date(Math.max(Date.now(), current.getTime() + 1));
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
