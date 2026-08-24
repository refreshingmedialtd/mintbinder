import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";

const DAY_MS = 24 * 60 * 60 * 1_000;
const maximumBatchSize = 10_000;

export const operationalRetentionDefaults = Object.freeze({
  accountTokenDays: 30,
  authThrottleDays: 30,
  billingCheckoutIntentDays: 730,
  billingWebhookDays: 730,
  jobRunDays: 365,
  notificationDeliveryDays: 365,
  passwordResetOutboxDays: 365,
  batchSize: 1_000,
});

export const operationalRetentionMinimums = Object.freeze({
  accountTokenDays: 1,
  authThrottleDays: 1,
  billingCheckoutIntentDays: 90,
  billingWebhookDays: 90,
  jobRunDays: 30,
  notificationDeliveryDays: 30,
  passwordResetOutboxDays: 30,
});

export function operationalRetentionOptions({ args = process.argv.slice(2), env = process.env } = {}) {
  const scheduled = args.includes("--scheduled");
  const billingWebhookDays = retentionDays({
    args,
    argument: "--billing-webhook-days",
    envValue: env.OPERATIONAL_RETENTION_BILLING_WEBHOOK_DAYS,
    fallback: operationalRetentionDefaults.billingWebhookDays,
    minimum: operationalRetentionMinimums.billingWebhookDays,
  });
  // The intent is the durable payment-id/correlation claim. Never discard it
  // before the webhook evidence that may legitimately reference it.
  const billingCheckoutIntentDays = Math.max(billingWebhookDays, retentionDays({
    args,
    argument: "--billing-checkout-intent-days",
    envValue: env.OPERATIONAL_RETENTION_BILLING_CHECKOUT_INTENT_DAYS,
    fallback: operationalRetentionDefaults.billingCheckoutIntentDays,
    minimum: operationalRetentionMinimums.billingCheckoutIntentDays,
  }));

  return {
    accountTokenDays: retentionDays({
      args,
      argument: "--account-token-days",
      envValue: env.OPERATIONAL_RETENTION_ACCOUNT_TOKEN_DAYS,
      fallback: operationalRetentionDefaults.accountTokenDays,
      minimum: operationalRetentionMinimums.accountTokenDays,
    }),
    allowDelete: booleanSetting(env.OPERATIONAL_RETENTION_ALLOW_DELETE, false),
    authThrottleDays: retentionDays({
      args,
      argument: "--auth-throttle-days",
      envValue: env.OPERATIONAL_RETENTION_AUTH_THROTTLE_DAYS,
      fallback: operationalRetentionDefaults.authThrottleDays,
      minimum: operationalRetentionMinimums.authThrottleDays,
    }),
    batchSize: Math.min(maximumBatchSize, positiveInteger(
      argumentValue(args, "--batch"),
      positiveInteger(env.OPERATIONAL_RETENTION_BATCH_SIZE, operationalRetentionDefaults.batchSize),
    )),
    billingCheckoutIntentDays,
    billingWebhookDays,
    confirm: args.includes("--confirm") || (
      scheduled && booleanSetting(env.OPERATIONAL_RETENTION_CRON_CONFIRM, false)
    ),
    jobRunDays: retentionDays({
      args,
      argument: "--job-run-days",
      envValue: env.OPERATIONAL_RETENTION_JOB_RUN_DAYS,
      fallback: operationalRetentionDefaults.jobRunDays,
      minimum: operationalRetentionMinimums.jobRunDays,
    }),
    notificationDeliveryDays: retentionDays({
      args,
      argument: "--notification-delivery-days",
      envValue: env.OPERATIONAL_RETENTION_NOTIFICATION_DELIVERY_DAYS,
      fallback: operationalRetentionDefaults.notificationDeliveryDays,
      minimum: operationalRetentionMinimums.notificationDeliveryDays,
    }),
    passwordResetOutboxDays: retentionDays({
      args,
      argument: "--password-reset-outbox-days",
      envValue: env.OPERATIONAL_RETENTION_PASSWORD_RESET_OUTBOX_DAYS,
      fallback: operationalRetentionDefaults.passwordResetOutboxDays,
      minimum: operationalRetentionMinimums.passwordResetOutboxDays,
    }),
    scheduled,
  };
}

export async function runOperationalDataRetention({
  now = new Date(),
  options = operationalRetentionOptions(),
  prisma,
  runId = randomUUID(),
} = {}) {
  const client = prisma ?? new PrismaClient();
  const ownsClient = !prisma;
  const targets = retentionTargets(now, options);

  try {
    const candidateCounts = await Promise.all(
      targets.map((target) => client[target.delegate].count({ where: target.where })),
    );
    const datasets = Object.fromEntries(targets.map((target, index) => [
      target.key,
      datasetReport(target, Number(candidateCounts[index] ?? 0)),
    ]));
    const candidateTotal = Object.values(datasets)
      .reduce((total, dataset) => total + dataset.deletionCandidates, 0);
    const baseReport = {
      schemaVersion: 1,
      operation: "operational-data-retention",
      runId,
      generatedAt: now.toISOString(),
      trigger: options.scheduled ? "scheduled" : "manual",
      dryRun: !options.confirm,
      batchSizePerDataset: options.batchSize,
      candidateTotal,
      safeguards: [
        "dry-run unless --confirm is supplied, or a scheduled run has its separate cron confirmation enabled",
        "deletion additionally requires OPERATIONAL_RETENTION_ALLOW_DELETE=true",
        "active auth blocks, processing billing webhooks, and running jobs are never candidates",
        "claimed or ambiguous notification deliveries are never routine-deletion candidates",
        "queued, claimed, or unresolved password-reset outbox rows are never routine-deletion candidates",
        "each dataset is capped to one bounded batch per invocation",
      ],
      datasets,
    };

    if (!options.confirm || candidateTotal === 0) {
      return {
        ...baseReport,
        deletedTotal: 0,
        nextCommand: candidateTotal > 0
          ? "Set OPERATIONAL_RETENTION_ALLOW_DELETE=true, then rerun with --confirm after reviewing this report and taking a backup."
          : null,
      };
    }

    if (!options.allowDelete) {
      throw new Error(
        "OPERATIONAL_RETENTION_ALLOW_DELETE=true is required in addition to --confirm before deleting operational data.",
      );
    }

    const selectedRows = await Promise.all(targets.map((target) =>
      client[target.delegate].findMany({
        where: target.where,
        orderBy: [
          { [target.orderField]: "asc" },
          { [target.idField]: "asc" },
        ],
        take: options.batchSize,
        select: { [target.idField]: true },
      }),
    ));
    const operations = [];
    const operationTargets = [];

    targets.forEach((target, index) => {
      const ids = selectedRows[index].map((row) => row[target.idField]);

      if (!ids.length) return;

      operations.push(client[target.delegate].deleteMany({
        where: {
          AND: [
            target.where,
            { [target.idField]: { in: ids } },
          ],
        },
      }));
      operationTargets.push(target);
    });

    const deletionResults = operations.length ? await client.$transaction(operations) : [];

    operationTargets.forEach((target, index) => {
      const deleted = Number(deletionResults[index]?.count ?? 0);
      const dataset = datasets[target.key];
      dataset.deleted = deleted;
      dataset.remainingEstimate = Math.max(0, dataset.deletionCandidates - deleted);
    });

    const deletedTotal = Object.values(datasets)
      .reduce((total, dataset) => total + dataset.deleted, 0);

    return {
      ...baseReport,
      dryRun: false,
      deletedTotal,
      nextCommand: candidateTotal > deletedTotal
        ? "Run a fresh dry-run report before applying another bounded batch."
        : null,
    };
  } finally {
    if (ownsClient) {
      await client.$disconnect();
    }
  }
}

function retentionTargets(now, options) {
  const accountTokenCutoff = cutoff(now, options.accountTokenDays);
  const authThrottleCutoff = cutoff(now, options.authThrottleDays);
  const billingCheckoutIntentCutoff = cutoff(now, options.billingCheckoutIntentDays);
  const billingWebhookCutoff = cutoff(now, options.billingWebhookDays);
  const jobRunCutoff = cutoff(now, options.jobRunDays);
  const notificationDeliveryCutoff = cutoff(now, options.notificationDeliveryDays);
  const passwordResetOutboxCutoff = cutoff(now, options.passwordResetOutboxDays);

  return [
    {
      key: "accountTokens",
      delegate: "accountToken",
      idField: "id",
      orderField: "expiresAt",
      retentionDays: options.accountTokenDays,
      minimumRetentionDays: operationalRetentionMinimums.accountTokenDays,
      cutoff: accountTokenCutoff,
      eligibility: "token expired before cutoff",
      where: { expiresAt: { lt: accountTokenCutoff } },
    },
    {
      key: "authThrottles",
      delegate: "authThrottle",
      idField: "keyHash",
      orderField: "updatedAt",
      retentionDays: options.authThrottleDays,
      minimumRetentionDays: operationalRetentionMinimums.authThrottleDays,
      cutoff: authThrottleCutoff,
      eligibility: "last updated before cutoff and not currently blocked",
      where: {
        updatedAt: { lt: authThrottleCutoff },
        OR: [
          { blockedUntil: null },
          { blockedUntil: { lt: now } },
        ],
      },
    },
    {
      key: "billingCheckoutIntents",
      delegate: "billingCheckoutIntent",
      idField: "id",
      orderField: "expiresAt",
      retentionDays: options.billingCheckoutIntentDays,
      minimumRetentionDays: operationalRetentionMinimums.billingCheckoutIntentDays,
      cutoff: billingCheckoutIntentCutoff,
      eligibility: "terminal checkout attempt last updated before cutoff",
      where: {
        status: { in: ["completed", "failed", "retired"] },
        updatedAt: { lt: billingCheckoutIntentCutoff },
      },
    },
    {
      key: "billingWebhookEvents",
      delegate: "billingWebhookEvent",
      idField: "id",
      orderField: "processedAt",
      retentionDays: options.billingWebhookDays,
      minimumRetentionDays: operationalRetentionMinimums.billingWebhookDays,
      cutoff: billingWebhookCutoff,
      eligibility: "succeeded or failed event processed before cutoff",
      where: {
        status: { in: ["SUCCEEDED", "FAILED"] },
        processedAt: { lt: billingWebhookCutoff },
      },
    },
    {
      key: "notificationDeliveries",
      delegate: "notificationDelivery",
      idField: "id",
      orderField: "sentAt",
      retentionDays: options.notificationDeliveryDays,
      minimumRetentionDays: operationalRetentionMinimums.notificationDeliveryDays,
      cutoff: notificationDeliveryCutoff,
      eligibility: "successfully sent delivery last updated before cutoff",
      where: {
        status: "SENT",
        updatedAt: { lt: notificationDeliveryCutoff },
      },
    },
    {
      key: "passwordResetOutbox",
      delegate: "passwordResetOutbox",
      idField: "id",
      orderField: "updatedAt",
      retentionDays: options.passwordResetOutboxDays,
      minimumRetentionDays: operationalRetentionMinimums.passwordResetOutboxDays,
      cutoff: passwordResetOutboxCutoff,
      eligibility: "sent or discarded password-reset request last updated before cutoff",
      where: {
        status: { in: ["SENT", "DISCARDED"] },
        updatedAt: { lt: passwordResetOutboxCutoff },
      },
    },
    {
      key: "jobRuns",
      delegate: "jobRun",
      idField: "id",
      orderField: "finishedAt",
      retentionDays: options.jobRunDays,
      minimumRetentionDays: operationalRetentionMinimums.jobRunDays,
      cutoff: jobRunCutoff,
      eligibility: "succeeded or failed job finished before cutoff",
      where: {
        status: { in: ["SUCCEEDED", "FAILED"] },
        finishedAt: { lt: jobRunCutoff },
      },
    },
  ];
}

function datasetReport(target, deletionCandidates) {
  return {
    retentionDays: target.retentionDays,
    minimumRetentionDays: target.minimumRetentionDays,
    cutoff: target.cutoff.toISOString(),
    eligibility: target.eligibility,
    deletionCandidates,
    deleted: 0,
    remainingEstimate: deletionCandidates,
  };
}

function retentionDays({ args, argument, envValue, fallback, minimum }) {
  const requested = positiveInteger(argumentValue(args, argument), positiveInteger(envValue, fallback));
  return Math.max(minimum, requested);
}

function cutoff(now, days) {
  return new Date(now.getTime() - days * DAY_MS);
}

function argumentValue(args, name) {
  const inline = args.find((argument) => argument.startsWith(`${name}=`));

  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runOperationalDataRetention();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      schemaVersion: 1,
      operation: "operational-data-retention",
      status: "failed",
      generatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Operational retention failed.",
    }, null, 2));
    process.exitCode = 1;
  }
}
