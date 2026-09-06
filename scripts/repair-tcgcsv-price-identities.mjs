import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { resolveTcgcsvVariantIdentities } from "./tcgcsv-card-pricing.mjs";

export function buildTcgcsvPriceIdentityRepairPlan(rows) {
  const byStream = new Map();

  for (const row of rows) {
    const sourceRef = String(row.sourceRef ?? "").trim();

    if (!row.cardPrintingId || !row.source || !sourceRef) {
      continue;
    }

    const variantLabel = String(row.variantLabel ?? "Normal").trim() || "Normal";
    const metadata = isObject(row.metadata) ? row.metadata : {};
    const rawSubtypeName = optionalString(metadata.subTypeName);
    const key = `${row.cardPrintingId}\u0000${row.source}\u0000${variantLabel}`;
    const stream = byStream.get(key) ?? {
      cardPrintingId: row.cardPrintingId,
      source: row.source,
      variantLabel,
      rowsByIdentity: new Map(),
    };
    const identityKey = `${sourceRef}\u0000${rawSubtypeName ?? ""}`;
    const identity = stream.rowsByIdentity.get(identityKey) ?? {
      metadata,
      rawSubtypeName,
      rows: [],
      sourceRef,
    };

    identity.rows.push(row);
    stream.rowsByIdentity.set(identityKey, identity);
    byStream.set(key, stream);
  }

  const operations = [];
  let collisionStreams = 0;

  for (const stream of byStream.values()) {
    const identities = [...stream.rowsByIdentity.values()];
    const distinctRefs = new Set(identities.map((identity) => identity.sourceRef));
    const rawSubtypesByRef = new Map();

    for (const identity of identities) {
      if (!identity.rawSubtypeName) {
        continue;
      }

      const subtypes = rawSubtypesByRef.get(identity.sourceRef) ?? new Set();

      subtypes.add(identity.rawSubtypeName);
      rawSubtypesByRef.set(identity.sourceRef, subtypes);
    }

    const hasRawSubtypeCollision = [...rawSubtypesByRef.values()].some((subtypes) => subtypes.size > 1);

    if (distinctRefs.size <= 1 && !hasRawSubtypeCollision) {
      continue;
    }

    collisionStreams += 1;
    const resolvedIdentities = resolveTcgcsvVariantIdentities(
      identities.map((identity) => {
        const tcgplayerUrl = optionalString(identity.metadata.tcgplayerUrl);

        return {
          cardPrintingId: stream.cardPrintingId,
          product: {
            name: tcgplayerUrl,
            productId: identity.sourceRef,
            url: tcgplayerUrl,
          },
          rawSubtypeName: identity.rawSubtypeName,
          sourceRef: identity.sourceRef,
          subTypeName: identity.rawSubtypeName ?? stream.variantLabel,
        };
      }),
    );

    for (const identity of resolvedIdentities) {
      if (identity.variantLabel === stream.variantLabel) {
        continue;
      }

      const identityKey = `${identity.sourceRef}\u0000${identity.rawSubtypeName ?? ""}`;

      operations.push({
        cardPrintingId: stream.cardPrintingId,
        fromVariantLabel: stream.variantLabel,
        rawSubtypeName: identity.rawSubtypeName ?? null,
        snapshotCount: stream.rowsByIdentity.get(identityKey)?.rows.length ?? 0,
        source: stream.source,
        sourceRef: identity.sourceRef,
        toVariantLabel: identity.variantLabel,
      });
    }
  }

  return {
    collisionStreams,
    operations,
    snapshotsToRelabel: operations.reduce((total, operation) => total + operation.snapshotCount, 0),
  };
}

export async function runTcgcsvPriceIdentityRepair(options = {}) {
  const confirm = options.confirm ?? process.argv.includes("--confirm");
  const allowAmbiguousUserVariants = options.allowAmbiguousUserVariants ??
    process.argv.includes("--allow-ambiguous-user-variants");
  const prisma = options.prisma ?? new PrismaClient();
  const shouldDisconnect = !options.prisma;

  try {
    if (!confirm) {
      return inspectTcgcsvPriceIdentityRepair(prisma, { dryRun: true });
    }

    return runSerializableRepair(prisma, async (transaction) => {
      const { affectedReferences, affectedUserVariantReferences, plan, report } =
        await inspectTcgcsvPriceIdentityRepair(transaction, { dryRun: false, includeInternals: true });

      if (affectedUserVariantReferences > 0 && !allowAmbiguousUserVariants) {
        throw new Error(
          `${affectedUserVariantReferences} user variant reference(s) use affected generic labels ` +
          `(${affectedReferences.activeCollectionItems} active collection, ` +
          `${affectedReferences.archivedCollectionItems} archived collection, ` +
          `${affectedReferences.wishlistItems} wishlist). Review or migrate them before rerunning with ` +
          `--allow-ambiguous-user-variants.`,
        );
      }

      let snapshotsRelabelled = 0;

      for (const operation of plan.operations) {
        const rawSubtypeName = optionalString(operation.rawSubtypeName);
        const result = await transaction.priceSnapshot.updateMany({
          data: { variantLabel: operation.toVariantLabel },
          where: {
            cardPrintingId: operation.cardPrintingId,
            itemType: "CARD",
            ...(rawSubtypeName
              ? { metadata: { equals: rawSubtypeName, path: ["subTypeName"] } }
              : {}),
            source: operation.source,
            sourceRef: operation.sourceRef,
            variantLabel: operation.fromVariantLabel,
          },
        });

        snapshotsRelabelled += result.count;
      }

      return {
        ...report,
        snapshotsRelabelled,
      };
    });
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

async function inspectTcgcsvPriceIdentityRepair(prisma, {
  dryRun,
  includeInternals = false,
}) {
  const rows = await loadTcgcsvCollisionSnapshots(prisma);
  const plan = buildTcgcsvPriceIdentityRepairPlan(rows);
  const affectedReferences = plan.operations.length
    ? await countPotentiallyAffectedUserVariantReferences(prisma, plan.operations)
    : emptyAffectedReferences();
  const affectedCollectionItems =
    affectedReferences.activeCollectionItems + affectedReferences.archivedCollectionItems;
  const affectedUserVariantReferences = affectedCollectionItems + affectedReferences.wishlistItems;
  const report = {
    affectedActiveCollectionItems: affectedReferences.activeCollectionItems,
    affectedArchivedCollectionItems: affectedReferences.archivedCollectionItems,
    affectedCollectionItems,
    affectedUserVariantReferences,
    affectedWishlistItems: affectedReferences.wishlistItems,
    collisionStreams: plan.collisionStreams,
    dryRun,
    operationCount: plan.operations.length,
    sampleOperations: plan.operations.slice(0, 25),
    snapshotsToRelabel: plan.snapshotsToRelabel,
  };

  return includeInternals
    ? { affectedReferences, affectedUserVariantReferences, plan, report }
    : report;
}

async function runSerializableRepair(prisma, operation) {
  if (typeof prisma.$transaction !== "function") {
    throw new Error("TCGCSV identity repair requires transaction support.");
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error?.code !== "P2034" || attempt === 3) {
        throw error;
      }
    }
  }

  throw new Error("TCGCSV identity repair could not acquire a stable serializable transaction.");
}

async function loadTcgcsvCollisionSnapshots(prisma) {
  return prisma.$queryRawUnsafe(`
    WITH provider_ref_collision_streams AS (
      SELECT card_printing_id, source, variant_label
      FROM price_snapshots
      WHERE item_type = 'card'::item_type
        AND source IN ('tcgcsv-card', 'tcgcsv-japan-card')
        AND source_ref IS NOT NULL
      GROUP BY card_printing_id, source, variant_label
      HAVING COUNT(DISTINCT source_ref) > 1
    ), raw_subtype_collision_streams AS (
      SELECT card_printing_id, source, variant_label
      FROM price_snapshots
      WHERE item_type = 'card'::item_type
        AND source IN ('tcgcsv-card', 'tcgcsv-japan-card')
        AND source_ref IS NOT NULL
      GROUP BY card_printing_id, source, source_ref, variant_label
      HAVING COUNT(DISTINCT NULLIF(BTRIM(metadata->>'subTypeName'), '')) > 1
    ), collision_streams AS (
      SELECT card_printing_id, source, variant_label
      FROM provider_ref_collision_streams
      UNION
      SELECT card_printing_id, source, variant_label
      FROM raw_subtype_collision_streams
    )
    SELECT
      ps.card_printing_id AS "cardPrintingId",
      ps.source,
      ps.source_ref AS "sourceRef",
      ps.variant_label AS "variantLabel",
      ps.metadata
    FROM price_snapshots ps
    INNER JOIN collision_streams cs
      ON cs.card_printing_id = ps.card_printing_id
      AND cs.source = ps.source
      AND cs.variant_label IS NOT DISTINCT FROM ps.variant_label
    WHERE ps.item_type = 'card'::item_type
    ORDER BY ps.card_printing_id, ps.source, ps.variant_label, ps.source_ref, ps.observed_at
  `);
}

async function countPotentiallyAffectedUserVariantReferences(prisma, operations) {
  const affectedStreams = [...new Map(operations.map((operation) => [
    `${operation.cardPrintingId}\u0000${operation.fromVariantLabel}`,
    {
      cardPrintingId: operation.cardPrintingId,
      variantLabel: operation.fromVariantLabel,
    },
  ])).values()];

  const activeCollectionItems = await prisma.collectionItem.count({
    where: {
      archivedAt: null,
      OR: affectedStreams,
    },
  });
  const archivedCollectionItems = await prisma.collectionItem.count({
    where: {
      archivedAt: { not: null },
      OR: affectedStreams,
    },
  });
  const wishlistItems = await prisma.wishlistItem.count({
    where: {
      OR: affectedStreams,
    },
  });

  return {
    activeCollectionItems,
    archivedCollectionItems,
    wishlistItems,
  };
}

function emptyAffectedReferences() {
  return {
    activeCollectionItems: 0,
    archivedCollectionItems: 0,
    wishlistItems: 0,
  };
}

function optionalString(value) {
  const text = String(value ?? "").trim();

  return text || undefined;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runTcgcsvPriceIdentityRepair();

  console.log(JSON.stringify(report, null, 2));
}
