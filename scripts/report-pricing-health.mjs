import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { restrictedCustomerPriceSources } from "../src/lib/pricing/provider-permissions.mjs";
import { runSerialTasks } from "./serial-tasks.mjs";

const dayMs = 24 * 60 * 60 * 1000;

export function buildPricingHealthReport({
  cardTraderConfigured = false,
  cardLanguages,
  cardVariantStreams = [],
  collisionStreams,
  generatedAt = new Date(),
  gradedPriceCharting = {},
  priceChartingGradedConfigured = false,
  rawSubtypeCollisionStreams = 0,
  sealed,
  sealedRotation,
  sealedSources = [],
  snapshotGrowth = {},
}, thresholds = {}) {
  const cardTraderExpected = thresholds.cardTraderExpected === undefined ||
    thresholds.cardTraderExpected === null ||
    thresholds.cardTraderExpected === ""
    ? booleanSetting(cardTraderConfigured, false)
    : booleanSetting(thresholds.cardTraderExpected, false);
  const settings = {
    cardFreshDays: positiveNumber(thresholds.cardFreshDays, 7),
    cardTraderExpected,
    maxCardTraderAgeHours: positiveNumber(thresholds.maxCardTraderAgeHours, 72),
    maxPriceChartingGradedAgeHours: positiveNumber(thresholds.maxPriceChartingGradedAgeHours, 720),
    maxSnapshotDailyGrowth: positiveNumber(thresholds.maxSnapshotDailyGrowth, 50_000),
    maxSnapshotProjectedAnnualRows: positiveNumber(thresholds.maxSnapshotProjectedAnnualRows, 15_000_000),
    maxSnapshotProjectedAnnualStorageBytes: positiveNumber(
      thresholds.maxSnapshotProjectedAnnualStorageBytes,
      10 * 1024 * 1024 * 1024,
    ),
    maxTcgcsvSealedAgeHours: positiveNumber(thresholds.maxTcgcsvSealedAgeHours, 30),
    minCardFreshPricedPercent: positiveNumber(thresholds.minCardFreshPricedPercent, 98),
    minCardTraderCoveragePercent: positiveNumber(thresholds.minCardTraderCoveragePercent, 5),
    minCardTraderFreshPricedPercent: positiveNumber(thresholds.minCardTraderFreshPricedPercent, 75),
    minEnglishCardCoveragePercent: positiveNumber(thresholds.minEnglishCardCoveragePercent, 98),
    minEnglishVariantCoveragePercent: positiveNumber(thresholds.minEnglishVariantCoveragePercent, 95),
    minJapaneseCardCoveragePercent: positiveNumber(thresholds.minJapaneseCardCoveragePercent, 65),
    minJapaneseVariantCoveragePercent: positiveNumber(thresholds.minJapaneseVariantCoveragePercent, 50),
    minVariantFreshPricedPercent: positiveNumber(thresholds.minVariantFreshPricedPercent, 90),
    minPriceChartingGradedCoveragePercent: positiveNumber(
      thresholds.minPriceChartingGradedCoveragePercent,
      80,
    ),
    minPriceChartingGradedFreshPercent: positiveNumber(
      thresholds.minPriceChartingGradedFreshPercent,
      75,
    ),
    minSealedCoveragePercent: positiveNumber(thresholds.minSealedCoveragePercent, 80),
    minSealedFreshPricedPercent: positiveNumber(thresholds.minSealedFreshPricedPercent, 75),
    minSealedRotationPercent: positiveNumber(thresholds.minSealedRotationPercent, 80),
    sealedFreshDays: positiveNumber(thresholds.sealedFreshDays, 30),
  };
  settings.priceChartingGradedExpected = thresholds.priceChartingGradedExpected === undefined ||
    thresholds.priceChartingGradedExpected === null ||
    thresholds.priceChartingGradedExpected === ""
    ? booleanSetting(priceChartingGradedConfigured, false)
    : booleanSetting(thresholds.priceChartingGradedExpected, false);
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
  const normalizedVariantStreams = cardVariantStreams.map((row) => {
    const available = numberValue(row.available);
    const priced = numberValue(row.priced);
    const fresh = numberValue(row.fresh);

    return {
      available,
      coveragePercent: percent(priced, available),
      fresh,
      freshPricedPercent: percent(fresh, priced),
      language: String(row.language),
      priced,
      stalePriced: Math.max(0, priced - fresh),
    };
  });
  const normalizedRotation = {
    availableSets: numberValue(sealedRotation.availableSets),
    jobs: numberValue(sealedRotation.jobs),
    uniqueSets: numberValue(sealedRotation.uniqueSets),
    zeroOutputJobs: numberValue(sealedRotation.zeroOutputJobs),
  };
  normalizedRotation.coveragePercent = percent(normalizedRotation.uniqueSets, normalizedRotation.availableSets);
  normalizedRotation.zeroOutputPercent = percent(normalizedRotation.zeroOutputJobs, normalizedRotation.jobs);
  const normalizedSources = normalizeSealedSources({
    cardTraderExpected: settings.cardTraderExpected,
    generatedAt,
    sealedSources,
    sealedTotal: normalizedSealed.total,
  });
  const normalizedGrowth = normalizeSnapshotGrowth(snapshotGrowth);
  const normalizedGraded = normalizeGradedPriceCharting({
    generatedAt,
    metrics: gradedPriceCharting,
    expected: settings.priceChartingGradedExpected,
  });
  const problems = [];
  const limitations = [];

  for (const lane of normalizedCards.filter((row) => ["en", "ja"].includes(row.language))) {
    if (lane.priced > 0 && lane.freshPricedPercent < settings.minCardFreshPricedPercent) {
      problems.push(
        `${lane.language} card pricing freshness is ${lane.freshPricedPercent}% of priced cards; expected at least ${settings.minCardFreshPricedPercent}% within ${settings.cardFreshDays} days.`,
      );
    }


    const minimumCoverage = lane.language === "en"
      ? settings.minEnglishCardCoveragePercent
      : settings.minJapaneseCardCoveragePercent;

    if (lane.total > 0 && lane.pricedPercent < minimumCoverage) {
      problems.push(
        `${lane.language} card pricing coverage is ${lane.pricedPercent}%; expected at least ${minimumCoverage}%.`,
      );
    }
  }

  for (const lane of normalizedVariantStreams.filter((row) => ["en", "ja"].includes(row.language))) {
    const minimumCoverage = lane.language === "en"
      ? settings.minEnglishVariantCoveragePercent
      : settings.minJapaneseVariantCoveragePercent;

    if (lane.available > 0 && lane.coveragePercent < minimumCoverage) {
      problems.push(
        `${lane.language} exact card-variant pricing coverage is ${lane.coveragePercent}% of ${lane.available} known metadata variant streams; expected at least ${minimumCoverage}%.`,
      );
    }

    if (lane.priced > 0 && lane.freshPricedPercent < settings.minVariantFreshPricedPercent) {
      problems.push(
        `${lane.language} exact card-variant pricing freshness is ${lane.freshPricedPercent}% of priced streams; expected at least ${settings.minVariantFreshPricedPercent}% within ${settings.cardFreshDays} days.`,
      );
    }
  }

  if (normalizedSealed.total > 0 && normalizedSealed.pricedPercent < settings.minSealedCoveragePercent) {
    problems.push(
      `Sealed pricing coverage is ${normalizedSealed.pricedPercent}%; expected at least ${settings.minSealedCoveragePercent}%.`,
    );
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

  const normalizedRawSubtypeCollisions = numberValue(rawSubtypeCollisionStreams);

  if (normalizedRawSubtypeCollisions > 0) {
    problems.push(
      `${normalizedRawSubtypeCollisions} TCGCSV card price stream(s) still combine multiple raw subtypes under one provider product ID and variant label.`,
    );
  }

  const tcgcsvSource = normalizedSources.find((row) => row.source === "tcgcsv");

  if (normalizedSealed.total > 0 && (!tcgcsvSource || tcgcsvSource.pricedItems === 0)) {
    problems.push("TCGCSV has not produced any sealed-product price snapshots.");
  } else if (tcgcsvSource?.latestAgeHours > settings.maxTcgcsvSealedAgeHours) {
    problems.push(
      `Latest TCGCSV sealed evidence is ${tcgcsvSource.latestAgeHours} hours old; expected output within ${settings.maxTcgcsvSealedAgeHours} hours.`,
    );
  }

  if (settings.cardTraderExpected) {
    const cardTraderSource = normalizedSources.find((row) => row.source === "cardtrader-sealed");

    if (!cardTraderSource || cardTraderSource.pricedItems === 0) {
      problems.push("CardTrader sealed pricing is configured but has not produced any price snapshots.");
    } else {
      if (cardTraderSource.coveragePercent < settings.minCardTraderCoveragePercent) {
        problems.push(
          `CardTrader sealed coverage is ${cardTraderSource.coveragePercent}% (${cardTraderSource.pricedItems} of ${normalizedSealed.total}); expected at least ${settings.minCardTraderCoveragePercent}% before it counts as a meaningful second source.`,
        );
      }

      if (cardTraderSource.freshPricedPercent < settings.minCardTraderFreshPricedPercent) {
        problems.push(
          `CardTrader sealed freshness is ${cardTraderSource.freshPricedPercent}% of its priced products; expected at least ${settings.minCardTraderFreshPricedPercent}% within ${settings.sealedFreshDays} days.`,
        );
      }

      if (cardTraderSource.latestAgeHours > settings.maxCardTraderAgeHours) {
        problems.push(
          `Latest CardTrader sealed evidence is ${cardTraderSource.latestAgeHours} hours old; expected output within ${settings.maxCardTraderAgeHours} hours.`,
        );
      }
    }
  }

  if (settings.priceChartingGradedExpected && normalizedGraded.supportedTargets > 0) {
    if (normalizedGraded.pricedTargets === 0) {
      problems.push(
        `PriceCharting graded-card pricing is configured but has produced no company-specific snapshots for ${normalizedGraded.supportedTargets} supported owned grade target(s).`,
      );
    } else {
      if (normalizedGraded.coveragePercent < settings.minPriceChartingGradedCoveragePercent) {
        problems.push(
          `PriceCharting graded-card coverage is ${normalizedGraded.coveragePercent}%; expected at least ${settings.minPriceChartingGradedCoveragePercent}% of supported owned grade targets.`,
        );
      }

      if (normalizedGraded.freshPercent < settings.minPriceChartingGradedFreshPercent) {
        problems.push(
          `PriceCharting graded-card freshness is ${normalizedGraded.freshPercent}%; expected at least ${settings.minPriceChartingGradedFreshPercent}% within ${settings.maxPriceChartingGradedAgeHours} hours.`,
        );
      }

      if (normalizedGraded.latestAgeHours > settings.maxPriceChartingGradedAgeHours) {
        problems.push(
          `Latest PriceCharting graded-card evidence is ${normalizedGraded.latestAgeHours} hours old; expected output within ${settings.maxPriceChartingGradedAgeHours} hours.`,
        );
      }
    }
  }

  if (normalizedGraded.unsupportedTargets > 0) {
    limitations.push(
      `${normalizedGraded.unsupportedTargets} owned graded-card target(s) cannot be imported safely: PriceCharting's non-10 grade fields do not identify PSA, BGS, or CGC.`,
    );
  }

  if (normalizedGrowth.dailyAverage7d > settings.maxSnapshotDailyGrowth) {
    problems.push(
      `Price snapshots are growing by ${normalizedGrowth.dailyAverage7d} rows/day; configured ceiling is ${settings.maxSnapshotDailyGrowth}.`,
    );
  }

  if (normalizedGrowth.projectedTotalRowsOneYear > settings.maxSnapshotProjectedAnnualRows) {
    problems.push(
      `Price snapshots are projected to reach ${normalizedGrowth.projectedTotalRowsOneYear} rows within one year; configured ceiling is ${settings.maxSnapshotProjectedAnnualRows}.`,
    );
  }

  if (
    normalizedGrowth.projectedStorageBytesOneYear > 0 &&
    normalizedGrowth.projectedStorageBytesOneYear > settings.maxSnapshotProjectedAnnualStorageBytes
  ) {
    problems.push(
      `Price-snapshot storage is projected to reach ${normalizedGrowth.projectedStorageBytesOneYear} bytes within one year; configured ceiling is ${settings.maxSnapshotProjectedAnnualStorageBytes}.`,
    );
  }

  return {
    cardFreshDays: settings.cardFreshDays,
    cardLanguages: normalizedCards,
    cardVariantStreams: normalizedVariantStreams,
    collisionStreams: normalizedCollisions,
    generatedAt: generatedAt.toISOString(),
    gradedPriceCharting: normalizedGraded,
    limitations,
    ok: problems.length === 0,
    problems,
    rawSubtypeCollisionStreams: normalizedRawSubtypeCollisions,
    sealed: normalizedSealed,
    sealedFreshDays: settings.sealedFreshDays,
    sealedRotation7d: normalizedRotation,
    sealedSources: normalizedSources,
    snapshotGrowth: normalizedGrowth,
    status: problems.length === 0 ? "healthy" : "degraded",
  };
}

export async function loadPricingHealthMetrics({ now = new Date(), prisma, thresholds = {} }) {
  const cardFreshSince = new Date(
    now.getTime() - positiveNumber(thresholds.cardFreshDays, 7) * dayMs,
  );
  const sealedFreshSince = new Date(
    now.getTime() - positiveNumber(thresholds.sealedFreshDays, 30) * dayMs,
  );
  const rotationSince = new Date(now.getTime() - 7 * dayMs);
  const gradedFreshSince = new Date(
    now.getTime() - positiveNumber(thresholds.maxPriceChartingGradedAgeHours, 720) * 60 * 60 * 1_000,
  );
  const restrictedSources = restrictedCustomerPriceSources(process.env);
  const customerPriceSourceFilter = restrictedSources.length
    ? Prisma.sql`AND ps.source NOT IN (${Prisma.join(restrictedSources)})`
    : Prisma.empty;
  const [
    cardLanguages,
    cardVariantStreamRows,
    sealedRows,
    rotationRows,
    collisionRows,
    sealedSourceRows,
    snapshotGrowthRows,
    cardTraderConfigurationRows,
    gradedPriceChartingRows,
    priceChartingGradedConfigurationRows,
  ] = await runSerialTasks([
    () => prisma.$queryRaw`
      WITH latest AS (
        SELECT card_printing_id, MAX(observed_at) AS observed_at
        FROM price_snapshots ps
        WHERE ps.item_type = 'card'::item_type
          AND ps.currency = 'GBP'
          AND ps.graded_company IS NULL
          ${customerPriceSourceFilter}
        GROUP BY ps.card_printing_id
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
    () => prisma.$queryRaw`
      WITH available AS (
        SELECT DISTINCT
          cp.id AS card_printing_id,
          cp.language,
          REGEXP_REPLACE(LOWER(variant.value), '[^a-z0-9]+', '', 'g') AS variant_label
        FROM card_printings cp
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(cp.variant_metadata->'availablePrices') = 'array'
              THEN cp.variant_metadata->'availablePrices'
            ELSE '[]'::jsonb
          END
        ) variant(value)
        WHERE cp.language IN ('en', 'ja')
          AND NULLIF(REGEXP_REPLACE(LOWER(variant.value), '[^a-z0-9]+', '', 'g'), '') IS NOT NULL
      ), latest AS (
        SELECT
          ps.card_printing_id,
          REGEXP_REPLACE(LOWER(COALESCE(ps.variant_label, '')), '[^a-z0-9]+', '', 'g') AS variant_label,
          MAX(ps.observed_at) AS observed_at
        FROM price_snapshots ps
        WHERE ps.item_type = 'card'::item_type
          AND ps.currency = 'GBP'
          AND ps.graded_company IS NULL
          ${customerPriceSourceFilter}
          AND NULLIF(REGEXP_REPLACE(LOWER(COALESCE(ps.variant_label, '')), '[^a-z0-9]+', '', 'g'), '') IS NOT NULL
        GROUP BY
          ps.card_printing_id,
          REGEXP_REPLACE(LOWER(COALESCE(ps.variant_label, '')), '[^a-z0-9]+', '', 'g')
      )
      SELECT
        available.language,
        COUNT(*)::int AS available,
        COUNT(latest.observed_at)::int AS priced,
        COUNT(*) FILTER (WHERE latest.observed_at >= ${cardFreshSince})::int AS fresh
      FROM available
      LEFT JOIN latest
        ON latest.card_printing_id = available.card_printing_id
        AND latest.variant_label = available.variant_label
      GROUP BY available.language
      ORDER BY available.language
    `,
    () => prisma.$queryRaw`
      WITH latest AS (
        SELECT sealed_product_id, MAX(observed_at) AS observed_at
        FROM price_snapshots ps
        WHERE ps.item_type = 'sealed_product'::item_type
          AND ps.currency = 'GBP'
          ${customerPriceSourceFilter}
        GROUP BY ps.sealed_product_id
      )
      SELECT
        COUNT(*)::int AS total,
        COUNT(latest.observed_at)::int AS priced,
        COUNT(*) FILTER (WHERE latest.observed_at >= ${sealedFreshSince})::int AS fresh
      FROM sealed_products sp
      LEFT JOIN latest ON latest.sealed_product_id = sp.id
      WHERE sp.visibility = 'global'::catalogue_visibility
    `,
    () => prisma.$queryRaw`
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
            WHERE sp.related_card_set_id = cs.id
              AND sp.visibility = 'global'::catalogue_visibility
              AND sp.provider_ids ? 'tcgcsv'
          )
        ) AS "availableSets",
        (SELECT COUNT(*)::int FROM recent_jobs) AS jobs,
        (SELECT COUNT(*)::int FROM visited) AS "uniqueSets",
        (SELECT COUNT(*)::int FROM recent_jobs
          WHERE COALESCE((result_payload->>'pricingSnapshotsCreated')::int, 0)
              + COALESCE((result_payload->>'pricingSnapshotsUpdated')::int, 0) = 0
        ) AS "zeroOutputJobs"
    `,
    () => prisma.$queryRaw`
      SELECT
        (
          SELECT COUNT(*)::int
          FROM (
            SELECT card_printing_id, source, variant_label
            FROM price_snapshots
            WHERE item_type = 'card'::item_type
              AND source IN ('tcgcsv-card', 'tcgcsv-japan-card')
              AND source_ref IS NOT NULL
            GROUP BY card_printing_id, source, variant_label
            HAVING COUNT(DISTINCT source_ref) > 1
          ) provider_ref_collisions
        ) AS count,
        (
          SELECT COUNT(*)::int
          FROM (
            SELECT card_printing_id, source, source_ref, variant_label
            FROM price_snapshots
            WHERE item_type = 'card'::item_type
              AND source IN ('tcgcsv-card', 'tcgcsv-japan-card')
              AND source_ref IS NOT NULL
            GROUP BY card_printing_id, source, source_ref, variant_label
            HAVING COUNT(DISTINCT NULLIF(BTRIM(metadata->>'subTypeName'), '')) > 1
          ) raw_subtype_collisions
        ) AS "rawSubtypeCount"
    `,
    () => prisma.$queryRaw`
      SELECT
        source,
        COUNT(*)::int AS snapshots,
        COUNT(DISTINCT sealed_product_id)::int AS "pricedItems",
        COUNT(DISTINCT sealed_product_id) FILTER (
          WHERE observed_at >= ${sealedFreshSince}
        )::int AS "freshItems",
        MAX(observed_at) AS "latestObservedAt"
      FROM price_snapshots
      WHERE item_type = 'sealed_product'::item_type
        AND currency = 'GBP'
      GROUP BY source
      ORDER BY source
    `,
    () => prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE created_at >= ${rotationSince})::int AS "created7d",
        COUNT(*) FILTER (WHERE created_at >= ${sealedFreshSince})::int AS "created30d",
        MIN(created_at) AS "oldestCreatedAt",
        pg_total_relation_size('price_snapshots'::regclass)::bigint AS "storageBytes"
      FROM price_snapshots
    `,
    () => prisma.$queryRaw`
      SELECT COALESCE(
        (request_payload->'secondSource'->>'enabled')::boolean,
        false
      ) AS configured
      FROM job_runs
      WHERE job_type = 'sealed_pricing_refresh'::job_run_type
      ORDER BY started_at DESC
      LIMIT 1
    `,
    () => prisma.$queryRaw`
      WITH targets AS (
        SELECT DISTINCT
          ci.card_printing_id,
          ci.graded_company,
          ci.graded_score,
          LOWER(TRIM(COALESCE(ci.variant_label, 'Standard'))) AS variant_label
        FROM collection_items ci
        WHERE ci.item_type = 'card'::item_type
          AND ci.archived_at IS NULL
          AND ci.card_printing_id IS NOT NULL
          AND ci.graded_company IS NOT NULL
          AND ci.graded_score IS NOT NULL
      ), supported AS (
        SELECT *
        FROM targets
        WHERE graded_company IN (
          'psa'::grading_company,
          'bgs'::grading_company,
          'cgc'::grading_company
        )
          AND graded_score = 10.0
      ), latest AS (
        SELECT
          ps.card_printing_id,
          ps.graded_company,
          ps.graded_score,
          LOWER(TRIM(COALESCE(ps.variant_label, 'Standard'))) AS variant_label,
          MAX(ps.observed_at) AS observed_at
        FROM price_snapshots ps
        WHERE ps.source = 'pricecharting-graded-card'
          AND ps.item_type = 'card'::item_type
          AND ps.currency = 'GBP'
          AND ps.graded_company IS NOT NULL
          AND ps.graded_score IS NOT NULL
        GROUP BY
          ps.card_printing_id,
          ps.graded_company,
          ps.graded_score,
          LOWER(TRIM(COALESCE(ps.variant_label, 'Standard')))
      )
      SELECT
        (SELECT COUNT(*)::int FROM targets) AS "requestedTargets",
        (SELECT COUNT(*)::int FROM supported) AS "supportedTargets",
        (SELECT COUNT(*)::int FROM targets) - (SELECT COUNT(*)::int FROM supported) AS "unsupportedTargets",
        COUNT(latest.observed_at)::int AS "pricedTargets",
        COUNT(*) FILTER (WHERE latest.observed_at >= ${gradedFreshSince})::int AS "freshTargets",
        MAX(latest.observed_at) AS "latestObservedAt"
      FROM supported
      LEFT JOIN latest
        ON latest.card_printing_id = supported.card_printing_id
        AND latest.graded_company = supported.graded_company
        AND latest.graded_score = supported.graded_score
        AND latest.variant_label = supported.variant_label
    `,
    () => prisma.$queryRaw`
      SELECT true AS configured
      FROM job_runs
      WHERE request_payload->>'provider' = 'pricecharting-graded-card'
         OR result_payload->>'provider' = 'pricecharting-graded-card'
      ORDER BY started_at DESC
      LIMIT 1
    `,
  ]);

  return {
    cardTraderConfigured: Boolean(cardTraderConfigurationRows[0]?.configured),
    cardLanguages,
    cardVariantStreams: cardVariantStreamRows,
    collisionStreams: collisionRows[0]?.count ?? 0,
    generatedAt: now,
    gradedPriceCharting: gradedPriceChartingRows[0] ?? {},
    priceChartingGradedConfigured: Boolean(priceChartingGradedConfigurationRows[0]?.configured),
    rawSubtypeCollisionStreams: collisionRows[0]?.rawSubtypeCount ?? 0,
    sealed: sealedRows[0] ?? {},
    sealedRotation: rotationRows[0] ?? {},
    sealedSources: sealedSourceRows,
    snapshotGrowth: snapshotGrowthRows[0] ?? {},
  };
}

export async function runPricingHealthReport({ now = new Date(), prisma = new PrismaClient() } = {}) {
  try {
    const thresholds = pricingHealthThresholdsFromEnv(process.env);
    const metrics = await loadPricingHealthMetrics({ now, prisma, thresholds });

    return buildPricingHealthReport(metrics, thresholds);
  } finally {
    await prisma.$disconnect();
  }
}

export function pricingHealthThresholdsFromEnv(env = process.env) {
  const token = env.CARDTRADER_API_TOKEN?.trim() || env.CARDTRADER_TOKEN?.trim();
  const explicitEnabled = env.CARDTRADER_SEALED_ENABLED?.trim();
  const priceChartingToken = env.PRICECHARTING_API_TOKEN?.trim();
  const priceChartingGradedEnabled = env.PRICECHARTING_GRADED_ENABLED?.trim();

  return {
    cardFreshDays: env.PRICING_HEALTH_CARD_FRESH_DAYS,
    cardTraderExpected: explicitEnabled
      ? booleanSetting(explicitEnabled, Boolean(token))
      : token
        ? true
        : undefined,
    maxCardTraderAgeHours: env.PRICING_HEALTH_MAX_CARDTRADER_AGE_HOURS,
    minCardTraderCoveragePercent: env.PRICING_HEALTH_MIN_CARDTRADER_COVERAGE_PERCENT,
    minCardTraderFreshPricedPercent: env.PRICING_HEALTH_MIN_CARDTRADER_FRESH_PERCENT,
    maxPriceChartingGradedAgeHours: env.PRICING_HEALTH_MAX_PRICECHARTING_GRADED_AGE_HOURS,
    maxSnapshotDailyGrowth: env.PRICING_HEALTH_MAX_SNAPSHOT_DAILY_GROWTH,
    maxSnapshotProjectedAnnualRows: env.PRICING_HEALTH_MAX_SNAPSHOT_ANNUAL_ROWS,
    maxSnapshotProjectedAnnualStorageBytes: env.PRICING_HEALTH_MAX_SNAPSHOT_ANNUAL_STORAGE_BYTES,
    maxTcgcsvSealedAgeHours: env.PRICING_HEALTH_MAX_TCGCSV_SEALED_AGE_HOURS,
    minCardFreshPricedPercent: env.PRICING_HEALTH_MIN_CARD_FRESH_PERCENT,
    minEnglishCardCoveragePercent: env.PRICING_HEALTH_MIN_EN_CARD_COVERAGE_PERCENT,
    minEnglishVariantCoveragePercent: env.PRICING_HEALTH_MIN_EN_VARIANT_COVERAGE_PERCENT,
    minJapaneseCardCoveragePercent: env.PRICING_HEALTH_MIN_JA_CARD_COVERAGE_PERCENT,
    minJapaneseVariantCoveragePercent: env.PRICING_HEALTH_MIN_JA_VARIANT_COVERAGE_PERCENT,
    minPriceChartingGradedCoveragePercent: env.PRICING_HEALTH_MIN_PRICECHARTING_GRADED_COVERAGE_PERCENT,
    minPriceChartingGradedFreshPercent: env.PRICING_HEALTH_MIN_PRICECHARTING_GRADED_FRESH_PERCENT,
    priceChartingGradedExpected: priceChartingGradedEnabled
      ? booleanSetting(priceChartingGradedEnabled, Boolean(priceChartingToken))
      : undefined,
    minSealedCoveragePercent: env.PRICING_HEALTH_MIN_SEALED_COVERAGE_PERCENT,
    minSealedFreshPricedPercent: env.PRICING_HEALTH_MIN_SEALED_FRESH_PERCENT,
    minSealedRotationPercent: env.PRICING_HEALTH_MIN_SEALED_ROTATION_PERCENT,
    minVariantFreshPricedPercent: env.PRICING_HEALTH_MIN_VARIANT_FRESH_PERCENT,
    sealedFreshDays: env.PRICING_HEALTH_SEALED_FRESH_DAYS,
  };
}

function normalizeGradedPriceCharting({ expected, generatedAt, metrics }) {
  const requestedTargets = numberValue(metrics.requestedTargets);
  const supportedTargets = numberValue(metrics.supportedTargets);
  const pricedTargets = numberValue(metrics.pricedTargets);
  const freshTargets = numberValue(metrics.freshTargets);
  const latestObservedAt = optionalIso(metrics.latestObservedAt);

  return {
    coveragePercent: percent(pricedTargets, supportedTargets),
    expected,
    freshPercent: percent(freshTargets, supportedTargets),
    freshTargets,
    latestAgeHours: latestObservedAt
      ? Math.round(Math.max(0, generatedAt.getTime() - Date.parse(latestObservedAt)) / 3_600) / 1_000
      : null,
    latestObservedAt,
    pricedTargets,
    requestedTargets,
    supportedTargets,
    unsupportedTargets: numberValue(metrics.unsupportedTargets),
  };
}

function normalizeSealedSources({ cardTraderExpected, generatedAt, sealedSources, sealedTotal }) {
  const rows = sealedSources.map((row) => {
    const latestObservedAt = optionalIso(row.latestObservedAt);
    const pricedItems = numberValue(row.pricedItems);
    const freshItems = numberValue(row.freshItems);

    return {
      coveragePercent: percent(pricedItems, sealedTotal),
      expected: row.source === "tcgcsv" || (row.source === "cardtrader-sealed" && cardTraderExpected),
      freshItems,
      freshPricedPercent: percent(freshItems, pricedItems),
      latestAgeHours: latestObservedAt
        ? Math.round(Math.max(0, generatedAt.getTime() - Date.parse(latestObservedAt)) / 3_600) / 1_000
        : null,
      latestObservedAt,
      pricedItems,
      snapshots: numberValue(row.snapshots),
      source: String(row.source),
    };
  });

  for (const source of ["tcgcsv", ...(cardTraderExpected ? ["cardtrader-sealed"] : [])]) {
    if (!rows.some((row) => row.source === source)) {
      rows.push({
        coveragePercent: 0,
        expected: true,
        freshItems: 0,
        freshPricedPercent: 0,
        latestAgeHours: null,
        latestObservedAt: null,
        pricedItems: 0,
        snapshots: 0,
        source,
      });
    }
  }

  return rows.sort((left, right) => left.source.localeCompare(right.source));
}

function normalizeSnapshotGrowth(row) {
  const total = numberValue(row.total);
  const created7d = numberValue(row.created7d);
  const dailyAverage7d = Math.round((created7d / 7) * 10) / 10;
  const storageBytes = numberValue(row.storageBytes);
  const projectedTotalRowsOneYear = Math.round(total + dailyAverage7d * 365);
  const bytesPerSnapshot = total > 0 ? storageBytes / total : 0;

  return {
    bytesPerSnapshot: Math.round(bytesPerSnapshot * 10) / 10,
    created30d: numberValue(row.created30d),
    created7d,
    dailyAverage7d,
    oldestCreatedAt: optionalIso(row.oldestCreatedAt),
    projectedStorageBytesOneYear: Math.round(projectedTotalRowsOneYear * bytesPerSnapshot),
    projectedTotalRowsOneYear,
    storageBytes,
    total,
  };
}

function numberValue(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
}

function positiveNumber(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function booleanSetting(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function optionalIso(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
