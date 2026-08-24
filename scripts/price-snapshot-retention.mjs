import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";

const minimumRetentionDays = 90;

export function priceSnapshotRetentionOptions({ args = process.argv.slice(2), env = process.env } = {}) {
  const requestedDays = positiveInteger(argumentValue(args, "--days"),
    positiveInteger(env.PRICE_SNAPSHOT_RETENTION_DAYS, 365));

  return {
    allowDelete: booleanSetting(env.PRICE_SNAPSHOT_RETENTION_ALLOW_DELETE, false),
    batchSize: Math.min(25_000, positiveInteger(
      argumentValue(args, "--batch"),
      positiveInteger(env.PRICE_SNAPSHOT_RETENTION_BATCH_SIZE, 5_000),
    )),
    confirm: args.includes("--confirm"),
    retentionDays: Math.max(minimumRetentionDays, requestedDays),
  };
}

export async function runPriceSnapshotRetention({
  now = new Date(),
  options = priceSnapshotRetentionOptions(),
  prisma = new PrismaClient(),
} = {}) {
  const cutoff = new Date(now.getTime() - options.retentionDays * 24 * 60 * 60 * 1_000);

  try {
    const [summary] = await prisma.$queryRaw`
      WITH ranked AS (
        SELECT
          id,
          observed_at,
          ROW_NUMBER() OVER (
            PARTITION BY
              item_type,
              COALESCE(card_printing_id::text, ''),
              COALESCE(sealed_product_id::text, ''),
              source,
              COALESCE(source_ref, ''),
              COALESCE(condition::text, ''),
              COALESCE(language, ''),
              COALESCE(variant_label, ''),
              COALESCE(graded_company::text, ''),
              COALESCE(graded_score::text, ''),
              COALESCE(currency, ''),
              date_trunc('week', observed_at AT TIME ZONE 'UTC')
            ORDER BY observed_at DESC, created_at DESC, id DESC
          ) AS row_number
        FROM price_snapshots
        WHERE observed_at < ${cutoff}
      )
      SELECT
        COUNT(*) FILTER (WHERE row_number > 1)::int AS "deletionCandidates",
        COUNT(*) FILTER (WHERE row_number = 1)::int AS "weeklyRowsRetained",
        MIN(observed_at) AS "oldestCandidateAt",
        MAX(observed_at) AS "newestCandidateAt"
      FROM ranked
    `;
    const report = {
      batchSize: options.batchSize,
      cutoff: cutoff.toISOString(),
      deletionCandidates: Number(summary?.deletionCandidates ?? 0),
      dryRun: !options.confirm,
      minimumRetentionDays,
      newestCandidateAt: isoOrNull(summary?.newestCandidateAt),
      oldestCandidateAt: isoOrNull(summary?.oldestCandidateAt),
      retentionDays: options.retentionDays,
      strategy: "retain the latest snapshot per UTC week and full price identity before the cutoff",
      weeklyRowsRetained: Number(summary?.weeklyRowsRetained ?? 0),
    };

    if (!options.confirm || report.deletionCandidates === 0) {
      return {
        ...report,
        deleted: 0,
        nextCommand: report.deletionCandidates > 0
          ? `Set PRICE_SNAPSHOT_RETENTION_ALLOW_DELETE=true, then rerun with --days=${options.retentionDays} --batch=${options.batchSize} --confirm`
          : null,
      };
    }

    if (!options.allowDelete) {
      throw new Error(
        "PRICE_SNAPSHOT_RETENTION_ALLOW_DELETE=true is required in addition to --confirm before deleting snapshots.",
      );
    }

    const deleted = await prisma.$executeRaw`
      WITH ranked AS (
        SELECT
          id,
          observed_at,
          ROW_NUMBER() OVER (
            PARTITION BY
              item_type,
              COALESCE(card_printing_id::text, ''),
              COALESCE(sealed_product_id::text, ''),
              source,
              COALESCE(source_ref, ''),
              COALESCE(condition::text, ''),
              COALESCE(language, ''),
              COALESCE(variant_label, ''),
              COALESCE(graded_company::text, ''),
              COALESCE(graded_score::text, ''),
              COALESCE(currency, ''),
              date_trunc('week', observed_at AT TIME ZONE 'UTC')
            ORDER BY observed_at DESC, created_at DESC, id DESC
          ) AS row_number
        FROM price_snapshots
        WHERE observed_at < ${cutoff}
      ), candidates AS (
        SELECT id
        FROM ranked
        WHERE row_number > 1
        ORDER BY observed_at ASC, id ASC
        LIMIT ${options.batchSize}
      )
      DELETE FROM price_snapshots snapshot
      USING candidates
      WHERE snapshot.id = candidates.id
    `;

    return {
      ...report,
      deleted: Number(deleted),
      dryRun: false,
      remainingEstimate: Math.max(0, report.deletionCandidates - Number(deleted)),
    };
  } finally {
    await prisma.$disconnect();
  }
}

function argumentValue(args, name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));

  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);

  return index >= 0 ? args[index + 1] : undefined;
}

function isoOrNull(value) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runPriceSnapshotRetention();

  console.log(JSON.stringify(report, null, 2));
}
