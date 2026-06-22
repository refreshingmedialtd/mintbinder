import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

const defaultAdminEmail = process.env.ADMIN_QA_EMAIL?.trim() || "liam@example.com";
const requiredEnv = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_URL",
  "AUTH_TRUST_HOST",
  "NEXT_PUBLIC_APP_URL",
  "JOB_SECRET",
];
const conversionRateEnv = [
  "POKEMON_TCG_USD_TO_GBP_RATE",
  "POKEMON_TCG_EUR_TO_GBP_RATE",
  "TCGCSV_USD_TO_GBP_RATE",
];
const jobRunTypes = [
  "PRICE_ALERTS",
  "CATALOGUE_REFRESH",
  "PRICING_REFRESH",
  "SEALED_PRICING_REFRESH",
];
const recentFailedJobRunDetailLimit = 5;

export async function runAdminQaSmoke({
  adminEmail = defaultAdminEmail,
  now = new Date(),
  prisma = new PrismaClient(),
} = {}) {
  try {
    const env = envStatus(requiredEnv);
    const exchangeRates = exchangeRateStatus(process.env);
    const conversionRates = conversionRateStatus(conversionRateEnv);
    const [
      adminUser,
      catalogueHealth,
      counts,
      duplicateGroups,
      recentFailedJobRunReport,
      latestJobRun,
      latestJobRunsByType,
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { email: adminEmail },
        include: {
          _count: {
            select: {
              collectionEvents: true,
              collectionItems: true,
              storageLocations: true,
              wishlistItems: true,
            },
          },
          notificationPreference: true,
          subscriptions: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      }),
      catalogueHealthReport(prisma),
      databaseCounts(prisma),
      duplicateProviderGroupCount(prisma),
      recentFailedJobRuns(prisma, now),
      prisma.jobRun.findFirst({
        orderBy: { startedAt: "desc" },
        select: jobRunSelect(),
      }),
      latestJobRuns(prisma),
    ]);
    const failures = [
      ...env.filter((entry) => !entry.present).map((entry) => `${entry.key} is not configured.`),
      ...adminFailures(adminEmail, adminUser),
      ...countFailures(counts),
    ];
    const warnings = [
      ...adminWarnings(adminEmail, adminUser),
      ...countWarnings(counts),
      ...catalogueWarnings(catalogueHealth),
      ...conversionRateWarnings(conversionRates, { automaticExchangeRates: exchangeRates.automatic }),
      ...jobRunWarnings({ recentFailedJobRunReport, latestJobRunsByType }),
      ...(duplicateGroups > 0
        ? [`${duplicateGroups} duplicate Pokemon TCG provider ID group${duplicateGroups === 1 ? "" : "s"} need review.`]
        : []),
    ];

    return {
      admin: adminSummary(adminUser),
      catalogueHealth,
      counts,
      conversionRates,
      duplicateProviderGroups: duplicateGroups,
      env,
      exchangeRates,
      failures,
      generatedAt: now.toISOString(),
      latestJobRun: latestJobRun ? mapJobRun(latestJobRun) : null,
      latestJobRunsByType,
      ok: failures.length === 0,
      recentFailedJobRunDetails: recentFailedJobRunReport.runs,
      recentFailedJobRunDetailLimit: recentFailedJobRunReport.detailLimit,
      recentFailedJobRuns24h: recentFailedJobRunReport.total,
      warnings,
    };
  } finally {
    await prisma.$disconnect();
  }
}

export function envStatus(keys) {
  return keys.map((key) => ({
    key,
    present: Boolean(process.env[key]?.trim()),
  }));
}

export function conversionRateStatus(keys) {
  return keys.map((key) => {
    const value = process.env[key]?.trim();
    const number = Number(value);

    return {
      key,
      present: Boolean(value),
      valid: Number.isFinite(number) && number > 0,
    };
  });
}

export function exchangeRateStatus(env = process.env) {
  const provider = env.EXCHANGE_RATES_PROVIDER?.trim() || "frankfurter";
  const auto = optionalBoolean(env.EXCHANGE_RATES_AUTO);

  return {
    allowEnvFallback: optionalBoolean(env.EXCHANGE_RATES_ALLOW_ENV_FALLBACK) ?? true,
    automatic: provider !== "manual" && auto !== false,
    endpoint: env.EXCHANGE_RATES_API_URL?.trim() || "https://api.frankfurter.app/latest",
    provider,
  };
}

export function adminFailures(adminEmail, adminUser) {
  if (!adminUser) {
    return [`Admin QA user ${adminEmail} was not found.`];
  }

  return [
    ...(adminUser.role !== "ADMIN" ? [`Admin QA user ${adminEmail} does not have ADMIN role.`] : []),
    ...(!adminUser.passwordHash ? [`Admin QA user ${adminEmail} does not have a password hash.`] : []),
    ...(!adminUser.notificationPreference ? [`Admin QA user ${adminEmail} has no notification preferences row.`] : []),
    ...(!adminUser.subscriptions.length ? [`Admin QA user ${adminEmail} has no subscription row.`] : []),
  ];
}

export function adminWarnings(adminEmail, adminUser) {
  if (!adminUser) {
    return [];
  }

  const subscription = adminUser.subscriptions[0];
  const isPlus =
    subscription &&
    (subscription.plan === "PLUS_MONTHLY" || subscription.plan === "PLUS_YEARLY") &&
    (subscription.status === "ACTIVE" || subscription.status === "TRIALING");

  return [
    ...(!isPlus
      ? [`Admin QA user ${adminEmail} is not on an active Plus plan; complete billing/webhook QA before beta.`]
      : []),
    ...(adminUser._count?.storageLocations < 1
      ? [`Admin QA user ${adminEmail} has no storage locations.`]
      : []),
    ...(adminUser._count?.collectionEvents < 1
      ? [`Admin QA user ${adminEmail} has no collection events.`]
      : []),
  ];
}

export function countFailures(counts) {
  return [
    ...(counts.users < 1 ? ["No users exist."] : []),
    ...(counts.admins < 1 ? ["No admin users exist."] : []),
    ...(counts.cardSets < 1 ? ["No card sets exist."] : []),
    ...(counts.cardPrintings < 1 ? ["No card printings exist."] : []),
    ...(counts.priceSnapshots < 1 ? ["No price snapshots exist."] : []),
  ];
}

export function countWarnings(counts) {
  return [
    ...(counts.sealedProducts < 1 ? ["No sealed products exist."] : []),
    ...(counts.collectionItems < 1 ? ["No collection items exist."] : []),
    ...(counts.collectionEvents < counts.collectionItems
      ? ["Collection event count is lower than collection item count; audit trail coverage may be incomplete."]
      : []),
    ...(counts.storageLocations < 1 ? ["No storage locations exist."] : []),
    ...(counts.subscriptions < counts.users ? ["Some users have no subscription row."] : []),
    ...(counts.wishlistItems < 1 ? ["No wishlist items exist."] : []),
    ...(counts.jobRuns < 1 ? ["No job runs have been recorded yet. Run an Operations job to verify job history."] : []),
  ];
}

export function conversionRateWarnings(conversionRates, { automaticExchangeRates = exchangeRateStatus().automatic } = {}) {
  if (automaticExchangeRates) {
    return [];
  }

  const byKey = new Map(conversionRates.map((entry) => [entry.key, entry]));
  const pokemonUsd = byKey.get("POKEMON_TCG_USD_TO_GBP_RATE");
  const pokemonEur = byKey.get("POKEMON_TCG_EUR_TO_GBP_RATE");
  const tcgcsvUsd = byKey.get("TCGCSV_USD_TO_GBP_RATE");

  return [
    ...(!pokemonUsd?.valid ? ["POKEMON_TCG_USD_TO_GBP_RATE is not configured with a positive number while automatic exchange rates are disabled; Pokemon card pricing jobs will fail."] : []),
    ...(!pokemonEur?.valid ? ["POKEMON_TCG_EUR_TO_GBP_RATE is not configured with a positive number; Cardmarket fallback pricing is disabled."] : []),
    ...(!tcgcsvUsd?.valid && !pokemonUsd?.valid
      ? ["TCGCSV_USD_TO_GBP_RATE is not configured and no Pokemon USD fallback is available while automatic exchange rates are disabled; sealed pricing jobs will fail."]
      : []),
  ];
}

export function catalogueWarnings(health) {
  return [
    ...(health.cardPricingCoveragePercent < 30
      ? [`Card pricing coverage is ${health.cardPricingCoveragePercent}%; run card pricing imports before beta.`]
      : []),
    ...(health.cardImageCoveragePercent < 80
      ? [`Card image coverage is ${health.cardImageCoveragePercent}%; run card image repair before beta.`]
      : []),
    ...(health.cardVariantMetadataCoveragePercent < 50
      ? [`Card variant metadata coverage is ${health.cardVariantMetadataCoveragePercent}%; run variant metadata repair before beta.`]
      : []),
    ...(health.sealedProductCount > 0 && health.sealedPricingCoveragePercent < 20
      ? [`Sealed pricing coverage is ${health.sealedPricingCoveragePercent}%; run sealed pricing imports before beta.`]
      : []),
    ...(health.sealedProductCount > 0 && health.sealedImageCoveragePercent < 50
      ? [`Sealed image coverage is ${health.sealedImageCoveragePercent}%; run sealed image repair before beta.`]
      : []),
  ];
}

export function jobRunWarnings({ recentFailedJobRunReport, latestJobRunsByType }) {
  const recentFailedJobRuns = recentFailedJobRunReport?.total ?? 0;
  const latestRecentFailure = recentFailedJobRunReport?.runs?.[0] ?? null;

  return [
    ...(recentFailedJobRuns > 0
      ? [recentFailedJobWarning(recentFailedJobRuns, latestRecentFailure, latestJobRunsByType)]
      : []),
    ...jobRunTypes
      .filter((type) => !latestJobRunsByType[type])
      .map((type) => `No ${jobTypeLabel(type)} job run has been recorded yet.`),
    ...Object.entries(latestJobRunsByType)
      .filter(([, run]) => run?.status === "FAILED")
      .map(([type, run]) => `Latest ${jobTypeLabel(type)} job run failed: ${jobRunErrorMessage(run)}`),
  ];
}

async function databaseCounts(prisma) {
  const [
    admins,
    cardPrintings,
    cardSets,
    collectionEvents,
    collectionItems,
    jobRuns,
    notificationPreferences,
    priceSnapshots,
    sealedProducts,
    storageLocations,
    subscriptions,
    users,
    wishlistItems,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.cardPrinting.count(),
    prisma.cardSet.count(),
    prisma.collectionEvent.count(),
    prisma.collectionItem.count(),
    prisma.jobRun.count(),
    prisma.notificationPreference.count(),
    prisma.priceSnapshot.count(),
    prisma.sealedProduct.count(),
    prisma.storageLocation.count(),
    prisma.subscription.count(),
    prisma.user.count(),
    prisma.wishlistItem.count(),
  ]);

  return {
    admins,
    cardPrintings,
    cardSets,
    collectionEvents,
    collectionItems,
    jobRuns,
    notificationPreferences,
    priceSnapshots,
    sealedProducts,
    storageLocations,
    subscriptions,
    users,
    wishlistItems,
  };
}

async function catalogueHealthReport(prisma) {
  const [
    cardImageRows,
    cardVariantRows,
    cardPricingRows,
    sealedImageRows,
    sealedPricingRows,
    priceSourceRows,
  ] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE image_small_url IS NOT NULL OR image_large_url IS NOT NULL)::int AS "covered"
      FROM card_printings
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (
          WHERE jsonb_typeof(variant_metadata->'availablePrices') = 'array'
            AND jsonb_array_length(variant_metadata->'availablePrices') > 0
        )::int AS "covered"
      FROM card_printings
    `,
    prisma.$queryRaw`
      SELECT
        (SELECT COUNT(*)::int FROM card_printings) AS "total",
        COUNT(DISTINCT card_printing_id)::int AS "covered"
      FROM price_snapshots
      WHERE card_printing_id IS NOT NULL
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE image_url IS NOT NULL)::int AS "covered"
      FROM sealed_products
    `,
    prisma.$queryRaw`
      SELECT
        (SELECT COUNT(*)::int FROM sealed_products) AS "total",
        COUNT(DISTINCT sealed_product_id)::int AS "covered"
      FROM price_snapshots
      WHERE sealed_product_id IS NOT NULL
    `,
    prisma.$queryRaw`
      SELECT source, COUNT(*)::int AS snapshots
      FROM price_snapshots
      GROUP BY source
      ORDER BY snapshots DESC, source ASC
    `,
  ]);
  const cardImages = firstRow(cardImageRows);
  const cardVariants = firstRow(cardVariantRows);
  const cardPricing = firstRow(cardPricingRows);
  const sealedImages = firstRow(sealedImageRows);
  const sealedPricing = firstRow(sealedPricingRows);

  return {
    cardImageCoveragePercent: percent(cardImages.covered, cardImages.total),
    cardImages: cardImages.covered,
    cardPrintings: cardImages.total,
    cardPricingCoveragePercent: percent(cardPricing.covered, cardPricing.total),
    cardPricingSnapshotsCovered: cardPricing.covered,
    cardVariantMetadataCoveragePercent: percent(cardVariants.covered, cardVariants.total),
    cardVariantMetadataRows: cardVariants.covered,
    priceSources: priceSourceRows,
    sealedImageCoveragePercent: percent(sealedImages.covered, sealedImages.total),
    sealedImages: sealedImages.covered,
    sealedPricingCoveragePercent: percent(sealedPricing.covered, sealedPricing.total),
    sealedPricingSnapshotsCovered: sealedPricing.covered,
    sealedProductCount: sealedImages.total,
  };
}

async function duplicateProviderGroupCount(prisma) {
  const rows = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS "count"
    FROM (
      SELECT provider_ids->>'pokemon_tcg_api' AS provider_id
      FROM card_printings
      WHERE provider_ids ? 'pokemon_tcg_api'
      GROUP BY provider_ids->>'pokemon_tcg_api'
      HAVING COUNT(*) > 1
    ) duplicate_groups
  `;

  return rows[0]?.count ?? 0;
}

async function recentFailedJobRuns(prisma, now) {
  const where = {
    startedAt: {
      gte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    },
    status: "FAILED",
  };
  const [total, runs] = await Promise.all([
    prisma.jobRun.count({ where }),
    prisma.jobRun.findMany({
      orderBy: { startedAt: "desc" },
      select: jobRunSelect(),
      take: recentFailedJobRunDetailLimit,
      where,
    }),
  ]);

  return {
    detailLimit: recentFailedJobRunDetailLimit,
    runs: runs.map(mapJobRun),
    total,
  };
}

function recentFailedJobWarning(count, latestRun, latestJobRunsByType = {}) {
  const countLabel = `${count} job run${count === 1 ? "" : "s"} failed in the last 24 hours`;

  if (!latestRun) {
    return `${countLabel}.`;
  }

  const latestRunForType = latestJobRunsByType[latestRun.jobType];
  const recoveryNote =
    latestRunForType?.status === "SUCCEEDED" && isAfter(latestRunForType.startedAt, latestRun.startedAt)
      ? ` Latest ${jobTypeLabel(latestRun.jobType)} has since succeeded at ${latestRunForType.startedAt}.`
      : "";

  return `${countLabel}; latest failed ${jobTypeLabel(latestRun.jobType)} started ${latestRun.startedAt}: ${sentenceFragment(jobRunErrorMessage(latestRun))}.${recoveryNote}`;
}

function jobRunErrorMessage(run) {
  return run.errorMessage?.trim() || "No error message.";
}

function sentenceFragment(value) {
  return value.replace(/[.!?]+$/u, "");
}

function isAfter(value, comparison) {
  const date = new Date(value);
  const comparisonDate = new Date(comparison);

  return date.getTime() > comparisonDate.getTime();
}

async function latestJobRuns(prisma) {
  const entries = await Promise.all(
    jobRunTypes.map(async (type) => {
      const run = await prisma.jobRun.findFirst({
        orderBy: { startedAt: "desc" },
        select: jobRunSelect(),
        where: { jobType: type },
      });

      return [type, run ? mapJobRun(run) : null];
    }),
  );

  return Object.fromEntries(entries);
}

function adminSummary(adminUser) {
  if (!adminUser) {
    return null;
  }

  return {
    collectionEvents: adminUser._count.collectionEvents,
    collectionItems: adminUser._count.collectionItems,
    email: adminUser.email,
    hasNotificationPreferences: Boolean(adminUser.notificationPreference),
    role: adminUser.role,
    storageLocations: adminUser._count.storageLocations,
    subscriptionPlan: adminUser.subscriptions[0]?.plan ?? null,
    subscriptionStatus: adminUser.subscriptions[0]?.status ?? null,
    wishlistItems: adminUser._count.wishlistItems,
  };
}

function jobRunSelect() {
  return {
    durationMs: true,
    errorMessage: true,
    finishedAt: true,
    jobType: true,
    startedAt: true,
    status: true,
  };
}

function mapJobRun(run) {
  return {
    durationMs: run.durationMs,
    errorMessage: run.errorMessage,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    jobType: run.jobType,
    startedAt: run.startedAt.toISOString(),
    status: run.status,
  };
}

function firstRow(rows) {
  return {
    covered: rows[0]?.covered ?? 0,
    total: rows[0]?.total ?? 0,
  };
}

function percent(value, total) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function optionalBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function jobTypeLabel(type) {
  return type.toLowerCase().replace(/_/g, " ");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runAdminQaSmoke();

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    console.error(`Admin QA smoke failed:\n- ${report.failures.join("\n- ")}`);
    process.exitCode = 1;
  }
}
