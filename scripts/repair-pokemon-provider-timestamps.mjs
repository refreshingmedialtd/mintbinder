import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

const defaultBatchSize = 5_000;
const defaultMaxBatches = 1_000;
const maxBatchSize = 10_000;
const maxBatchCount = 1_000;

// Keep this scope literal and deliberately narrow. This repair must never
// rewrite TCGCSV or any other provider's evidence.
const candidateCte = `
  WITH parsed AS (
    SELECT
      id,
      source,
      observed_at,
      created_at,
      CASE
        WHEN metadata->>'providerUpdatedAt' ~ '^20[0-9]{2}/(0[1-9]|1[0-2])/(0[1-9]|[12][0-9]|3[01])$'
          AND to_char(to_date(metadata->>'providerUpdatedAt', 'YYYY/MM/DD'), 'YYYY/MM/DD') = metadata->>'providerUpdatedAt'
          THEN to_date(metadata->>'providerUpdatedAt', 'YYYY/MM/DD')::timestamp
        WHEN metadata->>'providerUpdatedAt' ~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
          AND to_char(to_date(metadata->>'providerUpdatedAt', 'YYYY-MM-DD'), 'YYYY-MM-DD') = metadata->>'providerUpdatedAt'
          THEN to_date(metadata->>'providerUpdatedAt', 'YYYY-MM-DD')::timestamp
        ELSE NULL
      END AS provider_observed_at
    FROM price_snapshots
    WHERE item_type = 'card'::item_type
      AND source IN ('pokemon-tcg-api', 'pokemon-tcg-api-cardmarket')
  ), candidates AS (
    SELECT id, source, observed_at, created_at, provider_observed_at
    FROM parsed
    WHERE provider_observed_at >= TIMESTAMP '2000-01-01 00:00:00'
      AND provider_observed_at <= created_at
      AND provider_observed_at < observed_at
  )
`;

export function pokemonProviderTimestampRepairOptions({ args = process.argv.slice(2) } = {}) {
  return {
    afterId: optionalUuid(argumentValue(args, "--after-id")),
    apply: args.includes("--apply"),
    batchSize: boundedPositiveInteger(argumentValue(args, "--batch"), defaultBatchSize, maxBatchSize),
    maxBatches: boundedPositiveInteger(
      argumentValue(args, "--max-batches"),
      defaultMaxBatches,
      maxBatchCount,
    ),
  };
}

export async function runPokemonProviderTimestampRepair({
  options = pokemonProviderTimestampRepairOptions(),
  prisma = new PrismaClient(),
} = {}) {
  try {
    const sourceRows = await prisma.$queryRawUnsafe(`${candidateCte}
      SELECT
        source,
        COUNT(*)::int AS "candidateCount",
        MIN(observed_at) AS "oldestOriginalObservedAt",
        MAX(observed_at) AS "newestOriginalObservedAt",
        MIN(provider_observed_at) AS "oldestCorrectedObservedAt",
        MAX(provider_observed_at) AS "newestCorrectedObservedAt"
      FROM candidates
      GROUP BY source
      ORDER BY source
    `);
    const sources = sourceRows.map(normalizeSourceReport);
    const candidateCount = sources.reduce((total, source) => total + source.candidateCount, 0);
    const baseReport = {
      batchSize: options.batchSize,
      candidateCount,
      dryRun: !options.apply,
      maxBatches: options.maxBatches,
      startAfterId: options.afterId ?? null,
      scope: ["pokemon-tcg-api", "pokemon-tcg-api-cardmarket"],
      sources,
      strategy: "move observedAt backwards to a valid metadata.providerUpdatedAt date",
    };

    if (!options.apply || candidateCount === 0) {
      return {
        ...baseReport,
        batchesRun: 0,
        lastCursor: options.afterId ?? null,
        remainingEstimate: candidateCount,
        rowsScanned: 0,
        timestampsRepaired: 0,
        nextCommand: candidateCount > 0
          ? `node scripts/repair-pokemon-provider-timestamps.mjs --apply --batch=${options.batchSize}`
          : null,
      };
    }

    let batchesRun = 0;
    let lastCursor = options.afterId ?? null;
    let rowsScanned = 0;
    let timestampsRepaired = 0;
    const repairedBySource = new Map();

    while (batchesRun < options.maxBatches) {
      const rows = await prisma.$queryRawUnsafe(`
        WITH scoped AS (
          SELECT id, source, observed_at, created_at, metadata
          FROM price_snapshots
          WHERE item_type = 'card'::item_type
            AND source IN ('pokemon-tcg-api', 'pokemon-tcg-api-cardmarket')
            AND ($1::uuid IS NULL OR id > $1::uuid)
          ORDER BY id
          LIMIT $2
        ), parsed AS (
          SELECT
            id,
            source,
            observed_at,
            created_at,
            CASE
              WHEN metadata->>'providerUpdatedAt' ~ '^20[0-9]{2}/(0[1-9]|1[0-2])/(0[1-9]|[12][0-9]|3[01])$'
                AND to_char(to_date(metadata->>'providerUpdatedAt', 'YYYY/MM/DD'), 'YYYY/MM/DD') = metadata->>'providerUpdatedAt'
                THEN to_date(metadata->>'providerUpdatedAt', 'YYYY/MM/DD')::timestamp
              WHEN metadata->>'providerUpdatedAt' ~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                AND to_char(to_date(metadata->>'providerUpdatedAt', 'YYYY-MM-DD'), 'YYYY-MM-DD') = metadata->>'providerUpdatedAt'
                THEN to_date(metadata->>'providerUpdatedAt', 'YYYY-MM-DD')::timestamp
              ELSE NULL
            END AS provider_observed_at
          FROM scoped
        ), candidates AS (
          SELECT id, source, provider_observed_at
          FROM parsed
          WHERE provider_observed_at >= TIMESTAMP '2000-01-01 00:00:00'
            AND provider_observed_at <= created_at
            AND provider_observed_at < observed_at
        ), updated AS (
          UPDATE price_snapshots snapshot
          SET observed_at = candidates.provider_observed_at
          FROM candidates
          WHERE snapshot.id = candidates.id
            AND snapshot.observed_at > candidates.provider_observed_at
          RETURNING snapshot.source, snapshot.observed_at
        ), page_stats AS (
          SELECT
            COUNT(*)::int AS scanned_count,
            (SELECT id::text FROM scoped ORDER BY id DESC LIMIT 1) AS next_cursor
          FROM scoped
        )
        SELECT
          page_stats.scanned_count AS "scannedCount",
          page_stats.next_cursor AS "nextCursor",
          updated.source,
          COUNT(updated.source)::int AS "repairedCount"
        FROM page_stats
        LEFT JOIN updated ON TRUE
        GROUP BY page_stats.scanned_count, page_stats.next_cursor, updated.source
        ORDER BY updated.source
      `, lastCursor, options.batchSize);
      const scannedThisBatch = Number(rows[0]?.scannedCount ?? 0);
      const nextCursor = optionalUuid(rows[0]?.nextCursor);
      const repairedThisBatch = rows.reduce(
        (total, row) => total + Number(row.repairedCount ?? 0),
        0,
      );

      if (scannedThisBatch === 0 || !nextCursor || nextCursor === lastCursor) {
        break;
      }

      batchesRun += 1;
      lastCursor = nextCursor;
      rowsScanned += scannedThisBatch;
      timestampsRepaired += repairedThisBatch;

      for (const row of rows) {
        const source = typeof row.source === "string" ? row.source : "";

        if (!source || Number(row.repairedCount ?? 0) === 0) {
          continue;
        }

        const existing = repairedBySource.get(source) ?? 0;
        repairedBySource.set(source, existing + Number(row.repairedCount ?? 0));
      }

      if (scannedThisBatch < options.batchSize) {
        break;
      }
    }

    const remainingEstimate = Math.max(0, candidateCount - timestampsRepaired);

    return {
      ...baseReport,
      batchesRun,
      dryRun: false,
      lastCursor,
      repairedBySource: Object.fromEntries(repairedBySource),
      remainingEstimate,
      rowsScanned,
      timestampsRepaired,
      batchLimitReached: remainingEstimate > 0 && batchesRun >= options.maxBatches,
      nextCommand: remainingEstimate > 0
        ? continuationCommand({
            afterId: lastCursor,
            batchSize: options.batchSize,
            maxBatches: options.maxBatches,
          })
        : null,
    };
  } finally {
    await prisma.$disconnect();
  }
}

function normalizeSourceReport(row) {
  return {
    candidateCount: Number(row.candidateCount ?? 0),
    newestCorrectedObservedAt: isoOrNull(row.newestCorrectedObservedAt),
    newestOriginalObservedAt: isoOrNull(row.newestOriginalObservedAt),
    oldestCorrectedObservedAt: isoOrNull(row.oldestCorrectedObservedAt),
    oldestOriginalObservedAt: isoOrNull(row.oldestOriginalObservedAt),
    source: String(row.source),
  };
}

function argumentValue(args, name) {
  const inline = args.find((argument) => argument.startsWith(`${name}=`));

  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);

  return index >= 0 ? args[index + 1] : undefined;
}

function boundedPositiveInteger(value, fallback, maximum) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.min(maximum, Math.floor(number));
}

function optionalUuid(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error(`Invalid UUID cursor: ${value}`);
  }

  return normalized;
}

function continuationCommand({ afterId, batchSize, maxBatches }) {
  const cursor = afterId ? ` --after-id=${afterId}` : "";

  return `node scripts/repair-pokemon-provider-timestamps.mjs --apply --batch=${batchSize} --max-batches=${maxBatches}${cursor}`;
}

function isoOrNull(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runPokemonProviderTimestampRepair();

  console.log(JSON.stringify(report, null, 2));
}
