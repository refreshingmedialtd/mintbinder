import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

const dayMs = 24 * 60 * 60 * 1000;

export function buildPricingHealthReport({
  cardLanguages,
  collisionStreams,
  generatedAt = new Date(),
  sealed,
  sealedRotation,
}, thresholds = {}) {
  const settings = {
    cardFreshDays: positiveNumber(thresholds.cardFreshDays, 7),
    minCardFreshPricedPercent: positiveNumber(thresholds.minCardFreshPricedPercent, 98),
    minSealedFreshPricedPercent: positiveNumber(thresholds.minSealedFreshPricedPercent, 75),
    minSealedRotationPercent: positiveNumber(thresholds.minSealedRotationPercent, 80),
    sealedFreshDays: positiveNumber(thresholds.sealedFreshDays, 30),
  };
  const normalizedCards = cardLanguages.map((row) => {
    const total = numberValue(row.total);
    const priced = numberValue(row.priced);
    const fresh = numberValue(row.fresh);

    return {
      fresh,
      freshPricedPercent: percent(fresh, priced),
      language: String(row.language),
      priced,
      pricedPercent: percent(priced, total),
      stalePriced: Math.max(0, priced - fresh),
      total,
    };
  });
  const normalizedSealed = {
    fresh: numberValue(sealed.fresh),
    priced: numberValue(sealed.priced),
    total: numberValue(sealed.total),
  };
  normalizedSealed.freshPricedPercent = percent(normalizedSealed.fresh, normalizedSealed.priced);
  normalizedSealed.pricedPercent = percent(normalizedSealed.priced, normalizedSealed.total);
  normalizedSealed.stalePriced = Math.max(0, normalizedSealed.priced - normalizedSealed.fresh);
  const normalizedRotation = {
    availableSets: numberValue(sealedRotation.availableSets),
    jobs: numberValue(sealedRotation.jobs),
    uniqueSets: numberValue(sealedRotation.uniqueSets),
    zeroOutputJobs: numberValue(sealedRotation.zeroOutputJobs),
  };
  normalizedRotation.coveragePercent = percent(normalizedRotation.uniqueSets, normalizedRotation.availableSets);
  normalizedRotation.zeroOutputPercent = percent(normalizedRotation.zeroOutputJobs, normalizedRotation.jobs);
  const problems = [];

  for (const lane of normalizedCards.filter((row) => ["en", "ja"].includes(row.language))) {
    if (lane.priced > 0 && lane.freshPricedPercent < settings.minCardFreshPricedPercent) {
      problems.push(
        `${lane.language} card pricing freshness is ${lane.freshPricedPercent}% of priced cards; expected at least ${settings.minCardFreshPricedPercent}% within ${settings.cardFreshDays} days.`,
      );
    }
  }

  if (normalizedSealed.priced > 0 && normalizedSealed.freshPricedPercent < settings.minSealedFreshPricedPercent) {
    problems.push(
      `Sealed pricing freshness is ${normalizedSealed.freshPricedPercent}% of priced products; expected at least ${settings.minSealedFreshPricedPercent}% within ${settings.sealedFreshDays} days.`,
    );
  }

  if (normalizedRotation.availableSets > 0 && normalizedRotation.coveragePercent < settings.minSealedRotationPercent) {
    problems.push(
      `Sealed pricing visited ${normalizedRotation.uniqueSets} of ${normalizedRotation.availableSets} sets in 7 days (${normalizedRotation.coveragePercent}%); expected at least ${settings.minSealedRotationPercent}%.`,
    );
  }

  const normalizedCollisions = numberValue(collisionStreams);

  if (normalizedCollisions > 0) {
    problems.push(`${normalizedCollisions} TCGCSV card price stream(s) still combine multiple provider product IDs.`);
  }

  return {
    cardFreshDays: settings.cardFreshDays,
    cardLanguages: normalizedCards,
    collisionStreams: normalizedCollisions,
    generatedAt: generatedAt.toISOString(),
    ok: problems.length === 0,
    problems,
    sealed: normalizedSealed,
    sealedFreshDays: settings.sealedFreshDays,
    sealedRotation7d: normalizedRotation,
  };
}

export async function loadPricingHealthMetrics({ now = new Date(), prisma }) {
  const cardFreshSince = new Date(now.getTime() - 7 * dayMs);
  const sealedFreshSince = new Date(now.getTime() - 30 * dayMs);
  const rotationSince = new Date(now.getTime() - 7 * dayMs);
  const [cardLanguages, sealedRows, rotationRows, collisionRows] = await Promise.all([
    prisma.$queryRaw`
      WITH latest AS (
        SELECT card_printing_id, MAX(observed_at) AS observed_at
        FROM price_snapshots
        WHERE item_type = 'card'::item_type
          AND currency = 'GBP'
        GROUP BY card_printing_id
      )
      SELECT
        cp.language,
        COUNT(*)::int AS total,
        COUNT(latest.observed_at)::int AS priced,
        COUNT(*) FILTER (WHERE latest.observed_at >= ${cardFreshSince})::int AS fresh
      FROM card_printings cp
      LEFT JOIN latest ON latest.card_printing_id = cp.id
      GROUP BY cp.language
      ORDER BY cp.language
    `,
    prisma.$queryRaw`
      WITH latest AS (
        SELECT sealed_product_id, MAX(observed_at) AS observed_at
        FROM price_snapshots
        WHERE item_type = 'sealed_product'::item_type
          AND currency = 'GBP'
        GROUP BY sealed_product_id
      )
      SELECT
        COUNT(*)::int AS total,
        COUNT(latest.observed_at)::int AS priced,
        COUNT(*) FILTER (WHERE latest.observed_at >= ${sealedFreshSince})::int AS fresh
      FROM sealed_products sp
      LEFT JOIN latest ON latest.sealed_product_id = sp.id
    `,
    prisma.$queryRaw`
      WITH recent_jobs AS (
        SELECT result_payload
        FROM job_runs
        WHERE job_type = 'sealed_pricing_refresh'::job_run_type
          AND status = 'succeeded'::job_run_status
          AND started_at >= ${rotationSince}
      ), visited AS (
        SELECT DISTINCT result->>'setId' AS set_id
        FROM recent_jobs
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(result_payload->'groupResults', '[]'::jsonb)) result
        WHERE result->>'setId' IS NOT NULL

        UNION

        SELECT id::text AS set_id
        FROM card_sets
        WHERE metadata->>'scheduledSealedPricingLastAttemptAt' >= ${rotationSince.toISOString()}
      )
      SELECT
        (SELECT COUNT(*)::int FROM card_sets cs WHERE
          cs.metadata ? 'scheduledSealedPricingGroupId'
          OR EXISTS (
            SELECT 1 FROM sealed_products sp
            WHERE sp.related_card_set_id = cs.id AND sp.provider_ids ? 'tcgcsv'
          )
        ) AS "availableSets",
        (SELECT COUNT(*)::int FROM recent_jobs) AS jobs,
        (SELECT COUNT(*)::int FROM visited) AS "uniqueSets",
        (SELECT COUNT(*)::int FROM recent_jobs
          WHERE COALESCE((result_payload->>'pricingSnapshotsCreated')::int, 0)
              + COALESCE((result_payload->>'pricingSnapshotsUpdated')::int, 0) = 0
        ) AS "zeroOutputJobs"
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT card_printing_id, source, variant_label
        FROM price_snapshots
        WHERE item_type = 'card'::item_type
          AND source IN ('tcgcsv-card', 'tcgcsv-japan-card')
          AND source_ref IS NOT NULL
        GROUP BY card_printing_id, source, variant_label
        HAVING COUNT(DISTINCT source_ref) > 1
      ) collisions
    `,
  ]);

  return {
    cardLanguages,
    collisionStreams: collisionRows[0]?.count ?? 0,
    generatedAt: now,
    sealed: sealedRows[0] ?? {},
    sealedRotation: rotationRows[0] ?? {},
  };
}

export async function runPricingHealthReport({ now = new Date(), prisma = new PrismaClient() } = {}) {
  try {
    const metrics = await loadPricingHealthMetrics({ now, prisma });

    return buildPricingHealthReport(metrics, {
      cardFreshDays: process.env.PRICING_HEALTH_CARD_FRESH_DAYS,
      minCardFreshPricedPercent: process.env.PRICING_HEALTH_MIN_CARD_FRESH_PERCENT,
      minSealedFreshPricedPercent: process.env.PRICING_HEALTH_MIN_SEALED_FRESH_PERCENT,
      minSealedRotationPercent: process.env.PRICING_HEALTH_MIN_SEALED_ROTATION_PERCENT,
      sealedFreshDays: process.env.PRICING_HEALTH_SEALED_FRESH_DAYS,
    });
  } finally {
    await prisma.$disconnect();
  }
}

function numberValue(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
}

function positiveNumber(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function percent(value, total) {
  return total > 0 ? Math.round((value / total) * 1_000) / 10 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runPricingHealthReport();

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}
