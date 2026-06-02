import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const adminEmail = process.env.ADMIN_QA_EMAIL?.trim() || "liam@example.com";
const requiredEnv = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_URL",
  "AUTH_TRUST_HOST",
  "NEXT_PUBLIC_APP_URL",
  "JOB_SECRET",
];

try {
  const env = envStatus(requiredEnv);
  const [
    adminUser,
    counts,
    duplicateGroups,
    latestJobRun,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { email: adminEmail },
      include: {
        notificationPreference: true,
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    databaseCounts(),
    duplicateProviderGroupCount(),
    prisma.jobRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        durationMs: true,
        errorMessage: true,
        finishedAt: true,
        jobType: true,
        startedAt: true,
        status: true,
      },
    }),
  ]);

  const failures = [
    ...env.filter((entry) => !entry.present).map((entry) => `${entry.key} is not configured.`),
    ...adminFailures(adminUser),
    ...countFailures(counts),
  ];
  const warnings = [
    ...countWarnings(counts),
    ...(duplicateGroups > 0
      ? [`${duplicateGroups} duplicate Pokemon TCG provider ID group${duplicateGroups === 1 ? "" : "s"} need review.`]
      : []),
  ];

  const report = {
    admin: adminUser
      ? {
          email: adminUser.email,
          hasNotificationPreferences: Boolean(adminUser.notificationPreference),
          role: adminUser.role,
          subscriptionPlan: adminUser.subscriptions[0]?.plan ?? null,
          subscriptionStatus: adminUser.subscriptions[0]?.status ?? null,
        }
      : null,
    counts,
    duplicateProviderGroups: duplicateGroups,
    env,
    generatedAt: new Date().toISOString(),
    latestJobRun: latestJobRun
      ? {
          durationMs: latestJobRun.durationMs,
          errorMessage: latestJobRun.errorMessage,
          finishedAt: latestJobRun.finishedAt?.toISOString() ?? null,
          jobType: latestJobRun.jobType,
          startedAt: latestJobRun.startedAt.toISOString(),
          status: latestJobRun.status,
        }
      : null,
    ok: failures.length === 0,
    warnings,
  };

  console.log(JSON.stringify(report, null, 2));

  if (failures.length) {
    console.error(`Admin QA smoke failed:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}

function envStatus(keys) {
  return keys.map((key) => ({
    key,
    present: Boolean(process.env[key]?.trim()),
  }));
}

async function databaseCounts() {
  const [
    admins,
    cardPrintings,
    cardSets,
    collectionItems,
    jobRuns,
    notificationPreferences,
    priceSnapshots,
    sealedProducts,
    subscriptions,
    users,
    wishlistItems,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.cardPrinting.count(),
    prisma.cardSet.count(),
    prisma.collectionItem.count(),
    prisma.jobRun.count(),
    prisma.notificationPreference.count(),
    prisma.priceSnapshot.count(),
    prisma.sealedProduct.count(),
    prisma.subscription.count(),
    prisma.user.count(),
    prisma.wishlistItem.count(),
  ]);

  return {
    admins,
    cardPrintings,
    cardSets,
    collectionItems,
    jobRuns,
    notificationPreferences,
    priceSnapshots,
    sealedProducts,
    subscriptions,
    users,
    wishlistItems,
  };
}

async function duplicateProviderGroupCount() {
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

function adminFailures(adminUser) {
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

function countFailures(counts) {
  return [
    ...(counts.users < 1 ? ["No users exist."] : []),
    ...(counts.admins < 1 ? ["No admin users exist."] : []),
    ...(counts.cardSets < 1 ? ["No card sets exist."] : []),
    ...(counts.cardPrintings < 1 ? ["No card printings exist."] : []),
    ...(counts.priceSnapshots < 1 ? ["No price snapshots exist."] : []),
  ];
}

function countWarnings(counts) {
  return [
    ...(counts.sealedProducts < 1 ? ["No sealed products exist."] : []),
    ...(counts.collectionItems < 1 ? ["No collection items exist."] : []),
    ...(counts.wishlistItems < 1 ? ["No wishlist items exist."] : []),
    ...(counts.jobRuns < 1 ? ["No job runs have been recorded yet. Run an Operations job to verify job history."] : []),
  ];
}
