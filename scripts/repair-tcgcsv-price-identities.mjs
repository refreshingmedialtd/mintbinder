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
    const key = `${row.cardPrintingId}\u0000${row.source}\u0000${variantLabel}`;
    const stream = byStream.get(key) ?? {
      cardPrintingId: row.cardPrintingId,
      source: row.source,
      variantLabel,
      rowsByRef: new Map(),
    };
    const sourceRows = stream.rowsByRef.get(sourceRef) ?? [];

    sourceRows.push(row);
    stream.rowsByRef.set(sourceRef, sourceRows);
    byStream.set(key, stream);
  }

  const operations = [];
  let collisionStreams = 0;

  for (const stream of byStream.values()) {
    if (stream.rowsByRef.size <= 1) {
      continue;
    }

    collisionStreams += 1;
    const identities = resolveTcgcsvVariantIdentities(
      [...stream.rowsByRef.entries()].map(([sourceRef, sourceRows]) => {
        const metadata = sourceRows.find((row) => isObject(row.metadata))?.metadata ?? {};
        const tcgplayerUrl = optionalString(metadata.tcgplayerUrl);

        return {
          cardPrintingId: stream.cardPrintingId,
          product: {
            name: tcgplayerUrl,
            productId: sourceRef,
            url: tcgplayerUrl,
          },
          sourceRef,
          subTypeName: stream.variantLabel,
        };
      }),
    );

    for (const identity of identities) {
      if (identity.variantLabel === stream.variantLabel) {
        continue;
      }

      operations.push({
        cardPrintingId: stream.cardPrintingId,
        fromVariantLabel: stream.variantLabel,
        snapshotCount: stream.rowsByRef.get(identity.sourceRef)?.length ?? 0,
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

export async function runTcgcsvPriceIdentityRepair({
  confirm = process.argv.includes("--confirm"),
  prisma = new PrismaClient(),
} = {}) {
  try {
    const rows = await loadTcgcsvCollisionSnapshots(prisma);
    const plan = buildTcgcsvPriceIdentityRepairPlan(rows);
    const affectedCollectionItems = plan.operations.length
      ? await countPotentiallyAffectedCollectionItems(prisma, plan.operations)
      : 0;
    const report = {
      affectedCollectionItems,
      collisionStreams: plan.collisionStreams,
      dryRun: !confirm,
      operationCount: plan.operations.length,
      sampleOperations: plan.operations.slice(0, 25),
      snapshotsToRelabel: plan.snapshotsToRelabel,
    };

    if (!confirm) {
      return report;
    }

    if (affectedCollectionItems > 0 && !process.argv.includes("--allow-ambiguous-collection-variants")) {
      throw new Error(
        `${affectedCollectionItems} collection item(s) use affected generic variants. Review them before rerunning with --allow-ambiguous-collection-variants.`,
      );
    }

    let snapshotsRelabelled = 0;

    for (const operation of plan.operations) {
      const result = await prisma.priceSnapshot.updateMany({
        data: { variantLabel: operation.toVariantLabel },
        where: {
          cardPrintingId: operation.cardPrintingId,
          itemType: "CARD",
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
  } finally {
    await prisma.$disconnect();
  }
}

async function loadTcgcsvCollisionSnapshots(prisma) {
  return prisma.$queryRawUnsafe(`
    WITH collision_streams AS (
      SELECT card_printing_id, source, variant_label
      FROM price_snapshots
      WHERE item_type = 'card'::item_type
        AND source IN ('tcgcsv-card', 'tcgcsv-japan-card')
        AND source_ref IS NOT NULL
      GROUP BY card_printing_id, source, variant_label
      HAVING COUNT(DISTINCT source_ref) > 1
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

async function countPotentiallyAffectedCollectionItems(prisma, operations) {
  const affectedStreams = [...new Map(operations.map((operation) => [
    `${operation.cardPrintingId}\u0000${operation.fromVariantLabel}`,
    {
      cardPrintingId: operation.cardPrintingId,
      variantLabel: operation.fromVariantLabel,
    },
  ])).values()];

  return prisma.collectionItem.count({
    where: {
      archivedAt: null,
      OR: affectedStreams,
    },
  });
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
