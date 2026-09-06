import "dotenv/config";
import nodemailer from "nodemailer";
import { smtpSecurityOptions } from "./smtp-policy.mjs";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { priceAlertScheduleSettings } from "./price-alert-schedule.mjs";
import { providerSetFailureSummary } from "./run-live-scheduled-job.mjs";
import { runSerialTasks } from "./serial-tasks.mjs";
import {
  buildPricingHealthReport,
  loadPricingHealthMetrics,
  pricingHealthThresholdsFromEnv,
} from "./report-pricing-health.mjs";

const defaultLookbackMinutes = 90;
const defaultStaleMinutes = 45;
const defaultDetailLimit = 10;
const billingWebhookLeaseMinutes = 10;
const notificationDeliveryLeaseMinutes = 15;
const passwordResetOutboxLeaseMinutes = 15;
const passwordResetOutboxQueueMinutes = 10;

const scheduledJobCadenceDefinitions = [
  {
    defaultMaxAgeMinutes: 30 * 60,
    envName: "JOB_MONITOR_CATALOGUE_DISCOVERY_MAX_AGE_HOURS",
    key: "catalogue_discovery",
    label: "catalogue discovery",
    unit: "hours",
  },
  {
    defaultMaxAgeMinutes: 14 * 60,
    envName: "JOB_MONITOR_INTERNATIONAL_CATALOGUE_MAX_AGE_HOURS",
    key: "international_catalogue",
    label: "international catalogue rotation",
    unit: "hours",
  },
  {
    defaultMaxAgeMinutes: 3 * 60,
    envName: "JOB_MONITOR_CARD_PRICING_MAX_AGE_HOURS",
    key: "card_pricing",
    label: "Pokemon TCG card pricing",
    unit: "hours",
  },
  {
    defaultMaxAgeMinutes: 3 * 60,
    envName: "JOB_MONITOR_ENGLISH_CARD_PRICING_MAX_AGE_HOURS",
    key: "english_card_pricing",
    label: "English TCGCSV card pricing",
    unit: "hours",
  },
  {
    defaultMaxAgeMinutes: 3 * 60,
    envName: "JOB_MONITOR_JAPANESE_CARD_PRICING_MAX_AGE_HOURS",
    key: "japanese_card_pricing",
    label: "Japanese card pricing",
    unit: "hours",
  },
  {
    defaultMaxAgeMinutes: 3 * 60,
    envName: "JOB_MONITOR_SEALED_PRICING_MAX_AGE_HOURS",
    key: "sealed_pricing",
    label: "sealed pricing",
    unit: "hours",
  },
  {
    defaultMaxAgeMinutes: 10,
    envName: "JOB_MONITOR_PASSWORD_RESET_MAX_AGE_MINUTES",
    key: "password_reset_delivery",
    label: "password-reset delivery",
    unit: "minutes",
  },
  {
    defaultMaxAgeMinutes: 30,
    envName: "JOB_MONITOR_BILLING_RETIREMENT_MAX_AGE_MINUTES",
    key: "billing_checkout_retirement",
    label: "billing checkout retirement",
    unit: "minutes",
  },
];

export async function runJobMonitor({
  alertTo = optionalEnv("JOB_MONITOR_ALERT_TO") || optionalEnv("EMAIL_SMOKE_TO"),
  detailLimit = positiveInteger(process.env.JOB_MONITOR_DETAIL_LIMIT, defaultDetailLimit),
  dryRun = booleanSetting(process.env.JOB_MONITOR_DRY_RUN, true),
  env = process.env,
  lookbackMinutes = positiveInteger(process.env.JOB_MONITOR_LOOKBACK_MINUTES, defaultLookbackMinutes),
  now = optionalDate(process.env.JOB_MONITOR_NOW) ?? new Date(),
  prisma = new PrismaClient(),
  staleMinutes = positiveInteger(process.env.JOB_MONITOR_STALE_MINUTES, defaultStaleMinutes),
  sendEmail = sendMonitorEmail,
} = {}) {
  try {
    const pricingThresholds = pricingHealthThresholdsFromEnv(env);
    const [runs, pricingMetrics] = await runSerialTasks([
      () => loadProblemJobRuns({ detailLimit, env, lookbackMinutes, now, prisma, staleMinutes }),
      () => loadPricingHealthMetrics({ now, prisma, thresholds: pricingThresholds }),
    ]);
    const pricingHealth = buildPricingHealthReport(pricingMetrics, pricingThresholds);
    const priceAlertSettings = priceAlertScheduleSettings(env);
    const scheduledCadence = scheduledJobCadenceHealth({
      env,
      latestRuns: runs.latestScheduledRuns,
      now,
    });
    const report = buildJobMonitorReport({
      alertTo,
      detailLimit,
      dryRun,
      degradedRuns: runs.degradedRuns,
      failedBillingWebhookCount: runs.failedBillingWebhookCount,
      failedBillingWebhooks: runs.failedBillingWebhooks,
      failedRuns: runs.failedRuns,
      latestPriceAlertAttempt: runs.latestPriceAlertAttempt,
      latestPriceAlertRun: runs.latestPriceAlertRun,
      lookbackMinutes,
      now,
      priceAlertMaxAgeHours: positiveInteger(env.JOB_MONITOR_PRICE_ALERT_MAX_AGE_HOURS, 36),
      priceAlertSettings,
      pricingHealth,
      scheduledCadence,
      passwordResetOutboxProblemCount: runs.passwordResetOutboxProblemCount,
      passwordResetOutboxOldestAt: runs.passwordResetOutboxOldestAt,
      unresolvedNotificationDeliveryCount: runs.unresolvedNotificationDeliveryCount,
      unresolvedNotificationDeliveryOldestAt: runs.unresolvedNotificationDeliveryOldestAt,
      staleMinutes,
      staleRuns: runs.staleRuns,
    });

    if (!shouldSendJobMonitorAlert(report)) {
      return report;
    }

    if (!alertTo) {
      throw new Error("JOB_MONITOR_ALERT_TO or EMAIL_SMOKE_TO must be set before live job monitor alerts can send.");
    }

    const email = buildJobMonitorEmail(report);
    const sent = await sendEmail({ ...email, to: alertTo });

    return {
      ...report,
      alert: {
        ...report.alert,
        emailId: sent.id,
        sent: true,
      },
    };
  } finally {
    await prisma.$disconnect();
  }
}

export function buildJobMonitorReport({
  alertTo,
  detailLimit,
  dryRun,
  degradedRuns = [],
  failedBillingWebhookCount,
  failedBillingWebhooks = [],
  failedRuns,
  latestPriceAlertAttempt,
  latestPriceAlertRun,
  lookbackMinutes,
  now,
  priceAlertMaxAgeHours = 36,
  priceAlertSettings,
  pricingHealth,
  scheduledCadence,
  passwordResetOutboxProblemCount = 0,
  passwordResetOutboxOldestAt = null,
  unresolvedNotificationDeliveryCount = 0,
  unresolvedNotificationDeliveryOldestAt = null,
  staleMinutes,
  staleRuns,
}) {
  const normalizedFailedRuns = failedRuns.map(normalizeJobRun);
  const normalizedDegradedRuns = degradedRuns.map(normalizeJobRun);
  const normalizedStaleRuns = staleRuns.map(normalizeJobRun);
  const normalizedFailedBillingWebhooks = failedBillingWebhooks.map(normalizeBillingWebhookEvent);
  const normalizedFailedBillingWebhookCount = Number.isFinite(Number(failedBillingWebhookCount))
    ? Math.max(0, Math.floor(Number(failedBillingWebhookCount)))
    : normalizedFailedBillingWebhooks.length;
  const normalizedUnresolvedDeliveryCount = Number.isFinite(Number(unresolvedNotificationDeliveryCount))
    ? Math.max(0, Math.floor(Number(unresolvedNotificationDeliveryCount)))
    : 0;
  const unresolvedDeliveryOldestAt = dateStringOrNull(unresolvedNotificationDeliveryOldestAt);
  const unresolvedDeliveryAgeHours = unresolvedDeliveryOldestAt
    ? Math.max(0, Math.round(((now.getTime() - new Date(unresolvedDeliveryOldestAt).getTime()) / 3_600_000) * 10) / 10)
    : null;
  const normalizedPasswordResetOutboxProblemCount = Number.isFinite(Number(passwordResetOutboxProblemCount))
    ? Math.max(0, Math.floor(Number(passwordResetOutboxProblemCount)))
    : 0;
  const normalizedPasswordResetOutboxOldestAt = dateStringOrNull(passwordResetOutboxOldestAt);
  const passwordResetOutboxOldestAgeMinutes = normalizedPasswordResetOutboxOldestAt
    ? Math.max(
        0,
        Math.round((now.getTime() - new Date(normalizedPasswordResetOutboxOldestAt).getTime()) / 6_000) / 10,
      )
    : null;
  const priceAlerts = priceAlertScheduleHealth({
    latestAttempt: latestPriceAlertAttempt,
    latestRun: latestPriceAlertRun,
    maxAgeHours: priceAlertMaxAgeHours,
    now,
    settings: priceAlertSettings,
  });
  const problems = [
    ...(normalizedFailedRuns.length
      ? [`${normalizedFailedRuns.length} failed job run${normalizedFailedRuns.length === 1 ? "" : "s"} in the last ${lookbackMinutes} minutes.`]
      : []),
    ...(normalizedStaleRuns.length
      ? [`${normalizedStaleRuns.length} running job run${normalizedStaleRuns.length === 1 ? "" : "s"} older than ${staleMinutes} minutes.`]
      : []),
    ...(normalizedDegradedRuns.length
      ? [`${normalizedDegradedRuns.length} successful job run${normalizedDegradedRuns.length === 1 ? "" : "s"} reported partial provider degradation in the last ${lookbackMinutes} minutes.`]
      : []),
    ...(normalizedFailedBillingWebhookCount
      ? [`${normalizedFailedBillingWebhookCount} failed billing webhook event${normalizedFailedBillingWebhookCount === 1 ? "" : "s"} or stuck processing event${normalizedFailedBillingWebhookCount === 1 ? "" : "s"} need attention.`]
      : []),
    ...(normalizedUnresolvedDeliveryCount
      ? [
          `${normalizedUnresolvedDeliveryCount} notification delivery claim${normalizedUnresolvedDeliveryCount === 1 ? "" : "s"} ` +
          `remain unresolved${unresolvedDeliveryAgeHours === null ? "" : `; the oldest is ${unresolvedDeliveryAgeHours} hours old`}.`,
        ]
      : []),
    ...(normalizedPasswordResetOutboxProblemCount
      ? [
          `${normalizedPasswordResetOutboxProblemCount} password-reset outbox row${normalizedPasswordResetOutboxProblemCount === 1 ? "" : "s"} ` +
          `are stale or unresolved${passwordResetOutboxOldestAgeMinutes === null ? "" : `; the oldest is ${passwordResetOutboxOldestAgeMinutes} minutes old`}.`,
        ]
      : []),
    ...priceAlerts.problems,
    ...(scheduledCadence?.problems ?? []),
    ...(pricingHealth?.problems ?? []),
  ];

  return {
    alert: {
      dryRun,
      sent: false,
      to: alertTo ?? null,
      wouldSend: !dryRun && problems.length > 0,
    },
    detailLimit,
    generatedAt: now.toISOString(),
    lookbackMinutes,
    ok: problems.length === 0,
    problems,
    recentFailed: {
      count: normalizedFailedRuns.length,
      runs: normalizedFailedRuns,
    },
    pricingHealth: pricingHealth ?? null,
    priceAlerts,
    scheduledCadence: scheduledCadence ?? null,
    passwordResetOutbox: {
      count: normalizedPasswordResetOutboxProblemCount,
      oldestCreatedAt: normalizedPasswordResetOutboxOldestAt,
      oldestAgeMinutes: passwordResetOutboxOldestAgeMinutes,
    },
    recentFailedBillingWebhooks: {
      count: normalizedFailedBillingWebhookCount,
      events: normalizedFailedBillingWebhooks,
    },
    unresolvedNotificationDeliveries: {
      count: normalizedUnresolvedDeliveryCount,
      oldestUpdatedAt: unresolvedDeliveryOldestAt,
      oldestAgeHours: unresolvedDeliveryAgeHours,
    },
    recentDegraded: {
      count: normalizedDegradedRuns.length,
      runs: normalizedDegradedRuns,
    },
    staleMinutes,
    staleRunning: {
      count: normalizedStaleRuns.length,
      runs: normalizedStaleRuns,
    },
  };
}

export function shouldSendJobMonitorAlert(report) {
  return !report.ok && report.alert.dryRun === false;
}

export function buildJobMonitorEmail(report) {
  const subject = `[Mint Binder] Job monitor alert: ${report.problems.length} issue${report.problems.length === 1 ? "" : "s"}`;
  const failedRows = report.recentFailed.runs.map(jobRunTableRow).join("");
  const degradedRows = report.recentDegraded.runs.map(jobRunTableRow).join("");
  const failedBillingWebhookRows = report.recentFailedBillingWebhooks.events
    .map(billingWebhookTableRow)
    .join("");
  const staleRows = report.staleRunning.runs.map(jobRunTableRow).join("");
  const html = `<!doctype html>
<html lang="en">
<body style="color:#111827;font-family:Arial,sans-serif;line-height:1.5;margin:0;padding:24px;">
  <h1 style="font-size:20px;margin:0 0 12px;">Mint Binder job monitor alert</h1>
  <p>The job monitor found ${report.problems.length} operational issue${report.problems.length === 1 ? "" : "s"} at ${escapeHtml(report.generatedAt)}.</p>
  <ul>${report.problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join("")}</ul>
  ${failedRows ? `<h2 style="font-size:16px;margin:20px 0 8px;">Recent failed jobs</h2>${jobRunTable(failedRows)}` : ""}
  ${degradedRows ? `<h2 style="font-size:16px;margin:20px 0 8px;">Partial provider degradation</h2>${jobRunTable(degradedRows)}` : ""}
  ${failedBillingWebhookRows ? `<h2 style="font-size:16px;margin:20px 0 8px;">Billing webhooks needing attention</h2>${billingWebhookTable(failedBillingWebhookRows)}` : ""}
  ${staleRows ? `<h2 style="font-size:16px;margin:20px 0 8px;">Stale running jobs</h2>${jobRunTable(staleRows)}` : ""}
  <p style="color:#4b5563;margin-top:20px;">Check the Operations job history before running further imports or enabling beta recipient emails.</p>
</body>
</html>`;
  const text = [
    "Mint Binder job monitor alert",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    ...report.problems.map((problem) => `- ${problem}`),
    "",
    ...jobRunTextSection("Recent failed jobs", report.recentFailed.runs),
    ...jobRunTextSection("Partial provider degradation", report.recentDegraded.runs),
    ...billingWebhookTextSection(report.recentFailedBillingWebhooks.events),
    ...jobRunTextSection("Stale running jobs", report.staleRunning.runs),
    "Check the Operations job history before running further imports or enabling beta recipient emails.",
  ].join("\n");

  return {
    html,
    subject,
    text,
  };
}

async function loadProblemJobRuns({ detailLimit, env, lookbackMinutes, now, prisma, staleMinutes }) {
  const failedSince = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
  const staleBefore = new Date(now.getTime() - staleMinutes * 60 * 1000);
  const billingWebhookStaleBefore = new Date(now.getTime() - billingWebhookLeaseMinutes * 60 * 1000);
  const notificationDeliveryStaleBefore = new Date(
    now.getTime() - notificationDeliveryLeaseMinutes * 60 * 1000,
  );
  const passwordResetOutboxClaimStaleBefore = new Date(
    now.getTime() - passwordResetOutboxLeaseMinutes * 60 * 1_000,
  );
  const passwordResetOutboxQueueStaleBefore = new Date(
    now.getTime() - passwordResetOutboxQueueMinutes * 60 * 1_000,
  );
  const [
    failedRuns,
    staleRuns,
    successfulRuns,
    latestPriceAlertAttempt,
    latestPriceAlertRun,
    latestScheduledRuns,
    failedBillingWebhooks,
    failedBillingWebhookCount,
    unresolvedNotificationDeliveryCount,
    unresolvedNotificationDeliveryOldest,
    passwordResetOutboxProblemCount,
    passwordResetOutboxOldest,
  ] = await runSerialTasks([
    () => prisma.jobRun.findMany({
      orderBy: { startedAt: "desc" },
      select: jobRunSelect(),
      take: detailLimit,
      where: {
        startedAt: { gte: failedSince },
        status: "FAILED",
      },
    }),
    () => prisma.$queryRaw`
      SELECT
        id,
        job_type AS "jobType",
        status,
        request_payload AS "requestPayload",
        result_payload AS "resultPayload",
        error_message AS "errorMessage",
        started_at AS "startedAt",
        finished_at AS "finishedAt",
        duration_ms AS "durationMs"
      FROM job_runs
      WHERE status = 'running'::job_run_status
        AND finished_at IS NULL
        AND COALESCE(
          CASE
            WHEN result_payload->>'heartbeatEpochMs' ~ '^[0-9]+$'
              THEN TO_TIMESTAMP((result_payload->>'heartbeatEpochMs')::double precision / 1000)
            ELSE NULL
          END,
          started_at
        ) <= ${staleBefore}
      ORDER BY started_at ASC
      LIMIT ${detailLimit}
    `,
    () => prisma.jobRun.findMany({
      orderBy: { startedAt: "desc" },
      select: jobRunSelect(),
      take: 250,
      where: {
        startedAt: { gte: failedSince },
        status: "SUCCEEDED",
      },
    }),
    () => prisma.jobRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: jobRunSelect(),
      where: {
        jobType: "PRICE_ALERTS",
        requestPayload: { path: ["scheduled"], equals: true },
      },
    }),
    () => prisma.jobRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: jobRunSelect(),
      where: {
        jobType: "PRICE_ALERTS",
        requestPayload: { path: ["scheduled"], equals: true },
        status: "SUCCEEDED",
      },
    }),
    () => loadLatestScheduledRuns({ env, now, prisma }),
    () => prisma.billingWebhookEvent.findMany({
      orderBy: { updatedAt: "desc" },
      select: billingWebhookEventSelect(),
      take: detailLimit,
      where: {
        OR: [
          { status: "FAILED", updatedAt: { gte: failedSince } },
          { status: "PROCESSING", updatedAt: { lte: billingWebhookStaleBefore } },
        ],
      },
    }),
    () => prisma.billingWebhookEvent.count({
      where: {
        OR: [
          { status: "FAILED", updatedAt: { gte: failedSince } },
          { status: "PROCESSING", updatedAt: { lte: billingWebhookStaleBefore } },
        ],
      },
    }),
    () => prisma.notificationDelivery.count({
      where: {
        OR: [
          { status: "AMBIGUOUS" },
          { status: "CLAIMED", updatedAt: { lte: notificationDeliveryStaleBefore } },
        ],
      },
    }),
    () => prisma.notificationDelivery.findFirst({
      orderBy: { updatedAt: "asc" },
      select: { updatedAt: true },
      where: {
        OR: [
          { status: "AMBIGUOUS" },
          { status: "CLAIMED", updatedAt: { lte: notificationDeliveryStaleBefore } },
        ],
      },
    }),
    () => prisma.passwordResetOutbox.count({
      where: passwordResetOutboxProblemWhere({
        claimStaleBefore: passwordResetOutboxClaimStaleBefore,
        queueStaleBefore: passwordResetOutboxQueueStaleBefore,
      }),
    }),
    () => prisma.passwordResetOutbox.findFirst({
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
      where: passwordResetOutboxProblemWhere({
        claimStaleBefore: passwordResetOutboxClaimStaleBefore,
        queueStaleBefore: passwordResetOutboxQueueStaleBefore,
      }),
    }),
  ]);

  return {
    degradedRuns: successfulRuns
      .map((run) => ({ ...run, degradation: successfulJobDegradation(run) }))
      .filter((run) => run.degradation)
      .slice(0, detailLimit),
    failedBillingWebhookCount,
    failedBillingWebhooks,
    failedRuns,
    latestPriceAlertAttempt,
    latestPriceAlertRun,
    latestScheduledRuns,
    passwordResetOutboxProblemCount,
    passwordResetOutboxOldestAt: passwordResetOutboxOldest?.createdAt ?? null,
    staleRuns,
    unresolvedNotificationDeliveryCount,
    unresolvedNotificationDeliveryOldestAt: unresolvedNotificationDeliveryOldest?.updatedAt ?? null,
  };
}

async function loadLatestScheduledRuns({ env, now, prisma }) {
  const maxAgeMinutes = Math.max(
    ...scheduledCadenceSettings(env).map((setting) => setting.maxAgeMinutes),
  );
  const cadenceSince = new Date(now.getTime() - (maxAgeMinutes + 24 * 60) * 60 * 1_000);

  return prisma.$queryRaw`
    WITH classified_runs AS (
      SELECT
        CASE
          WHEN job_type = 'catalogue_refresh'::job_run_type
            AND request_payload->>'setsOnly' = 'true'
            AND request_payload->>'scheduled' = 'true'
            THEN 'catalogue_discovery'
          WHEN job_type = 'catalogue_refresh'::job_run_type
            AND request_payload->>'provider' = 'tcgdex'
            AND request_payload->>'scheduled' = 'true'
            THEN 'international_catalogue'
          WHEN job_type = 'pricing_refresh'::job_run_type
            AND request_payload->>'scheduler' = 'scheduled-set-pricing'
            AND request_payload->>'scheduled' = 'true'
            AND request_payload->>'writePrices' = 'true'
            THEN 'card_pricing'
          WHEN job_type = 'pricing_refresh'::job_run_type
            AND request_payload->>'language' = 'en'
            AND request_payload->>'source' = 'tcgcsv-card'
            AND request_payload->>'scheduled' = 'true'
            AND request_payload->>'writePrices' = 'true'
            THEN 'english_card_pricing'
          WHEN job_type = 'pricing_refresh'::job_run_type
            AND request_payload->>'language' = 'ja'
            AND request_payload->>'scheduled' = 'true'
            AND request_payload->>'writePrices' = 'true'
            THEN 'japanese_card_pricing'
          WHEN job_type = 'sealed_pricing_refresh'::job_run_type
            AND request_payload->>'scheduled' = 'true'
            AND request_payload->>'writePrices' = 'true'
            THEN 'sealed_pricing'
          WHEN job_type = 'password_reset_delivery'::job_run_type
            AND request_payload->>'scheduled' = 'true'
            THEN 'password_reset_delivery'
          WHEN job_type = 'billing_checkout_retirement'::job_run_type
            AND request_payload->>'scheduled' = 'true'
            THEN 'billing_checkout_retirement'
          ELSE NULL
        END AS lane,
        started_at AS "startedAt",
        status
      FROM job_runs
      WHERE job_type IN (
        'catalogue_refresh'::job_run_type,
        'pricing_refresh'::job_run_type,
        'sealed_pricing_refresh'::job_run_type,
        'password_reset_delivery'::job_run_type,
        'billing_checkout_retirement'::job_run_type
      )
        AND started_at >= ${cadenceSince}
    )
    SELECT
      lane,
      MAX("startedAt") AS "latestAttemptAt",
      (ARRAY_AGG(status ORDER BY "startedAt" DESC))[1] AS "latestAttemptStatus",
      MAX("startedAt") FILTER (
        WHERE status = 'succeeded'::job_run_status
      ) AS "latestSucceededAt"
    FROM classified_runs
    WHERE lane IS NOT NULL
    GROUP BY lane
    ORDER BY lane
  `;
}

function passwordResetOutboxProblemWhere({ claimStaleBefore, queueStaleBefore }) {
  return {
    OR: [
      { status: "UNRESOLVED" },
      { claimedAt: { lte: claimStaleBefore }, status: "CLAIMED" },
      { createdAt: { lte: queueStaleBefore }, status: "QUEUED" },
    ],
  };
}

async function sendMonitorEmail({ html, subject, text, to }) {
  const provider = emailProvider();
  const from = requiredEnv("EMAIL_FROM", "EMAIL_FROM must be set before live job monitor alerts can send.");

  if (provider === "smtp") {
    const host = requiredEnv("SMTP_HOST", "SMTP_HOST must be set before live SMTP job monitor alerts can send.");
    const user = requiredEnv("SMTP_USER", "SMTP_USER must be set before live SMTP job monitor alerts can send.");
    const pass = requiredEnv("SMTP_PASSWORD", "SMTP_PASSWORD must be set before live SMTP job monitor alerts can send.");
    const port = smtpPort();
    const security = smtpSecurityOptions(port, process.env.SMTP_SECURE);
    const transporter = nodemailer.createTransport({
      auth: {
        pass,
        user,
      },
      host,
      port,
      ...security,
    });
    const info = await transporter.sendMail({
      from,
      headers: { "X-Mint-Binder-Monitor": "job-runs" },
      html,
      subject,
      text,
      to,
    });

    return { id: info.messageId || "sent" };
  }

  const apiKey = requiredEnv("RESEND_API_KEY", "RESEND_API_KEY must be set before live Resend job monitor alerts can send.");
  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from,
      html,
      subject,
      text,
      to,
    }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `mintbinder-job-monitor-${new Date().toISOString().slice(0, 13)}`,
    },
    method: "POST",
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message ?? data.name ?? `Job monitor email failed with HTTP ${response.status}.`);
  }

  return { id: data.id ?? "sent" };
}

function normalizeJobRun(run) {
  const lane = scheduledJobLane(run);

  return {
    durationMs: numberOrNull(run.durationMs),
    errorMessage: run.errorMessage ?? null,
    degradation: run.degradation ?? null,
    finishedAt: dateStringOrNull(run.finishedAt),
    jobType: jobTypeLabel(run.jobType),
    label: scheduledJobLaneLabel(lane) ?? jobTypeLabel(run.jobType),
    lane,
    startedAt: dateStringOrNull(run.startedAt),
    status: jobStatusLabel(run.status),
  };
}

function jobRunSelect() {
  return {
    durationMs: true,
    errorMessage: true,
    finishedAt: true,
    jobType: true,
    requestPayload: true,
    resultPayload: true,
    startedAt: true,
    status: true,
  };
}

function billingWebhookEventSelect() {
  return {
    createdAt: true,
    errorMessage: true,
    eventType: true,
    occurredAt: true,
    processedAt: true,
    provider: true,
    providerEventId: true,
    status: true,
    updatedAt: true,
  };
}

function jobRunTable(rows) {
  return `<table style="border-collapse:collapse;width:100%;">
    <thead>
      <tr>
        <th align="left" style="border-bottom:1px solid #d1d5db;padding:8px;">Type</th>
        <th align="left" style="border-bottom:1px solid #d1d5db;padding:8px;">Status</th>
        <th align="left" style="border-bottom:1px solid #d1d5db;padding:8px;">Started</th>
        <th align="left" style="border-bottom:1px solid #d1d5db;padding:8px;">Error</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function jobRunTableRow(run) {
  return `<tr>
    <td style="border-bottom:1px solid #e5e7eb;padding:8px;">${escapeHtml(run.label ?? run.jobType)}</td>
    <td style="border-bottom:1px solid #e5e7eb;padding:8px;">${escapeHtml(run.status)}</td>
    <td style="border-bottom:1px solid #e5e7eb;padding:8px;">${escapeHtml(run.startedAt ?? "-")}</td>
    <td style="border-bottom:1px solid #e5e7eb;padding:8px;">${escapeHtml(run.errorMessage ?? run.degradation ?? "-")}</td>
  </tr>`;
}

function billingWebhookTable(rows) {
  return `<table style="border-collapse:collapse;width:100%;">
    <thead>
      <tr>
        <th align="left" style="border-bottom:1px solid #d1d5db;padding:8px;">Provider</th>
        <th align="left" style="border-bottom:1px solid #d1d5db;padding:8px;">Event</th>
        <th align="left" style="border-bottom:1px solid #d1d5db;padding:8px;">Failed</th>
        <th align="left" style="border-bottom:1px solid #d1d5db;padding:8px;">Error</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function billingWebhookTableRow(event) {
  return `<tr>
    <td style="border-bottom:1px solid #e5e7eb;padding:8px;">${escapeHtml(event.provider)}</td>
    <td style="border-bottom:1px solid #e5e7eb;padding:8px;">${escapeHtml(`${event.eventType} (${event.providerEventId})`)}</td>
    <td style="border-bottom:1px solid #e5e7eb;padding:8px;">${escapeHtml(event.updatedAt ?? "-")}</td>
    <td style="border-bottom:1px solid #e5e7eb;padding:8px;">${escapeHtml(event.errorMessage ?? "-")}</td>
  </tr>`;
}

function jobRunTextSection(title, runs) {
  if (!runs.length) {
    return [];
  }

  return [
    title,
    ...runs.map(
      (run) =>
        `- ${run.label ?? run.jobType} ${run.status} started ${run.startedAt ?? "unknown"}${run.errorMessage || run.degradation ? `: ${run.errorMessage ?? run.degradation}` : ""}`,
    ),
    "",
  ];
}

function billingWebhookTextSection(events) {
  if (!events.length) {
    return [];
  }

  return [
    "Billing webhooks needing attention",
    ...events.map((event) =>
      `- ${event.provider} ${event.eventType} (${event.providerEventId}) failed ${event.updatedAt ?? "at an unknown time"}${event.errorMessage ? `: ${event.errorMessage}` : ""}`
    ),
    "",
  ];
}

function normalizeBillingWebhookEvent(event) {
  return {
    createdAt: dateStringOrNull(event.createdAt),
    errorMessage: event.errorMessage ?? null,
    eventType: String(event.eventType ?? "unknown"),
    occurredAt: dateStringOrNull(event.occurredAt),
    processedAt: dateStringOrNull(event.processedAt),
    provider: String(event.provider ?? "unknown"),
    providerEventId: String(event.providerEventId ?? "unknown"),
    status: jobStatusLabel(event.status),
    updatedAt: dateStringOrNull(event.updatedAt),
  };
}

function jobTypeLabel(value) {
  return String(value).toLowerCase();
}

export function scheduledJobLane(run) {
  const jobType = jobTypeLabel(run?.jobType);
  const request = isObject(run?.requestPayload) ? run.requestPayload : {};
  const scheduled = booleanJsonValue(request.scheduled);

  if (!scheduled) return null;

  if (jobType === "catalogue_refresh" && booleanJsonValue(request.setsOnly)) {
    return "catalogue_discovery";
  }

  if (
    jobType === "pricing_refresh" &&
    request.scheduler === "scheduled-set-pricing" &&
    booleanJsonValue(request.writePrices)
  ) {
    return "card_pricing";
  }

  return null;
}

function booleanJsonValue(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function scheduledJobLaneLabel(lane) {
  if (lane === "catalogue_discovery") return "catalogue discovery";
  if (lane === "card_pricing") return "Pokemon TCG set pricing";

  return null;
}

function jobStatusLabel(value) {
  return String(value).toLowerCase();
}

function dateStringOrNull(value) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : String(value);
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function successfulJobDegradation(run) {
  const result = isObject(run?.resultPayload) ? run.resultPayload : {};
  const reasons = [];
  const warning = optionalEnvValue(result.warning);
  const topLevelStatus = optionalEnvValue(result.status);
  const topLevelProvider = optionalEnvValue(result.provider) ?? "scheduled provider";

  if (topLevelStatus && !["succeeded", "healthy", "not_configured"].includes(topLevelStatus)) {
    reasons.push(`${topLevelProvider} reported ${topLevelStatus}.`);
  }

  if (warning) {
    reasons.push(warning);
  }

  const failedSets = positiveCount(result.failedSets);
  const failedGroups = positiveCount(result.failedGroups);
  const partialSets = positiveCount(result.partialSets);
  const ambiguousCheckouts = positiveCount(result.ambiguous);
  const checkoutErrors = positiveCount(result.errors);

  if (failedSets) reasons.push(`${failedSets} provider set refresh(es) failed.`);
  if (partialSets) reasons.push(`${partialSets} provider set refresh(es) were partial.`);
  if (failedGroups) reasons.push(`${failedGroups} provider group refresh(es) failed.`);
  if (ambiguousCheckouts) reasons.push(`${ambiguousCheckouts} billing checkout retirement(s) need reconciliation.`);
  if (checkoutErrors) reasons.push(`${checkoutErrors} billing checkout retirement provider operation(s) failed.`);

  const affectedSets = providerSetFailureSummary(result);

  if (affectedSets) reasons.push(affectedSets);

  const secondSource = isObject(result.secondSource) ? result.secondSource : null;

  if (secondSource) {
    const status = optionalEnvValue(secondSource.status);
    const provider = optionalEnvValue(secondSource.provider) ?? "second source";
    const output = positiveCount(secondSource.pricingSnapshotsCreated) +
      positiveCount(secondSource.pricingSnapshotsUpdated);
    const candidatesChecked = positiveCount(secondSource.candidatesChecked);

    if (status && !["succeeded", "not_configured"].includes(status)) {
      reasons.push(`${provider} reported ${status}.`);
    } else if (
      status === "succeeded" &&
      candidatesChecked > 0 &&
      output === 0 &&
      !isExpectedCardTraderDiscoveryMiss(secondSource, provider)
    ) {
      reasons.push(`${provider} checked ${candidatesChecked} candidate(s) but produced no price snapshots.`);
    }
  }

  return [...new Set(reasons)].join(" ") || null;
}

function isExpectedCardTraderDiscoveryMiss(result, provider) {
  const outcome = optionalEnvValue(result.outcome);
  const selectionMode = optionalEnvValue(result.selectionMode);
  const apiRequests = positiveCount(result.apiRequests);
  const quarantined = positiveCount(result.pricingObservationsQuarantined);

  return provider === "cardtrader-sealed" &&
    apiRequests > 0 &&
    (
      (selectionMode === "discovery" &&
        ["no_blueprint_match", "no_eligible_listing"].includes(outcome)) ||
      (outcome === "quarantined" && quarantined > 0)
    );
}

export function scheduledJobCadenceHealth({ env = {}, latestRuns = [], now }) {
  const latestByLane = new Map(
    latestRuns
      .filter((run) => optionalEnvValue(run?.lane))
      .map((run) => [String(run.lane), run]),
  );
  const lanes = scheduledCadenceSettings(env).map((setting) => {
    const run = latestByLane.get(setting.key);
    const latestAttemptAt = validDate(run?.latestAttemptAt);
    const latestSucceededAt = validDate(run?.latestSucceededAt);
    const latestAttemptStatus = optionalEnvValue(run?.latestAttemptStatus)?.toLowerCase() ?? null;
    const ageMinutes = latestSucceededAt
      ? Math.round(Math.max(0, now.getTime() - latestSucceededAt.getTime()) / 6_000) / 10
      : null;
    let problem = null;

    if (ageMinutes === null) {
      problem = `No successful ${setting.label} job has been recorded within ${setting.thresholdLabel}.`;
    } else if (ageMinutes > setting.maxAgeMinutes) {
      problem =
        `Latest successful ${setting.label} job is ${formatAge(ageMinutes)} old; ` +
        `expected a run within ${setting.thresholdLabel}.`;
    }

    if (latestAttemptStatus === "failed") {
      const failure =
        `Latest ${setting.label} attempt failed` +
        `${latestAttemptAt ? ` at ${latestAttemptAt.toISOString()}` : " at an unknown time"}.`;
      problem = problem ? `${problem} ${failure}` : failure;
    }

    return {
      ageMinutes,
      key: setting.key,
      label: setting.label,
      latestAttemptAt: latestAttemptAt?.toISOString() ?? null,
      latestAttemptStatus,
      latestSucceededAt: latestSucceededAt?.toISOString() ?? null,
      maxAgeMinutes: setting.maxAgeMinutes,
      ok: problem === null,
      problem,
    };
  });
  const problems = lanes.map((lane) => lane.problem).filter(Boolean);

  return {
    lanes,
    ok: problems.length === 0,
    problems,
  };
}

function scheduledCadenceSettings(env) {
  return scheduledJobCadenceDefinitions.map((definition) => {
    const defaultThreshold = definition.unit === "hours"
      ? definition.defaultMaxAgeMinutes / 60
      : definition.defaultMaxAgeMinutes;
    const configuredThreshold = positiveInteger(env[definition.envName], defaultThreshold);
    const maxAgeMinutes = definition.unit === "hours"
      ? configuredThreshold * 60
      : configuredThreshold;

    return {
      ...definition,
      maxAgeMinutes,
      thresholdLabel: `${configuredThreshold} ${definition.unit}`,
    };
  });
}

function validDate(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatAge(minutes) {
  if (minutes >= 120) {
    return `${Math.ceil((minutes / 60) * 10) / 10} hours`;
  }

  return `${minutes} minutes`;
}

export function priceAlertScheduleHealth({
  latestAttempt,
  latestRun,
  maxAgeHours = 36,
  now,
  settings,
}) {
  if (!settings) {
    return {
      latestRunAt: null,
      maxAgeHours,
      mode: "unknown",
      ok: true,
      problems: [],
    };
  }

  const latestRunAt = latestRun?.startedAt
    ? (latestRun.startedAt instanceof Date ? latestRun.startedAt : new Date(latestRun.startedAt))
    : null;
  const latestAttemptAt = latestAttempt?.startedAt
    ? (latestAttempt.startedAt instanceof Date
      ? latestAttempt.startedAt
      : new Date(latestAttempt.startedAt))
    : null;
  const latestAttemptStatus = String(latestAttempt?.status ?? "").trim().toUpperCase() || null;
  const ageHours = latestRunAt && !Number.isNaN(latestRunAt.getTime())
    ? Math.round(Math.max(0, now.getTime() - latestRunAt.getTime()) / 3_600) / 1_000
    : null;
  const problems = [...settings.problems];

  if (latestAttemptStatus === "FAILED") {
    problems.push(
      `Latest scheduled price-alert digest attempt failed${
        latestAttemptAt && !Number.isNaN(latestAttemptAt.getTime())
          ? ` at ${latestAttemptAt.toISOString()}`
          : ""
      }; inspect the job run before beta emails are enabled.`,
    );
  }

  if (ageHours === null) {
    problems.push("No price-alert digest job run has been recorded; configure the daily dry-run schedule.");
  } else if (ageHours > maxAgeHours) {
    problems.push(
      `Latest price-alert digest job is ${ageHours} hours old; expected a run within ${maxAgeHours} hours.`,
    );
  }

  return {
    ageHours,
    allowLiveRecipients: settings.allowLiveRecipients,
    dryRun: settings.dryRun,
    emailConfigured: settings.emailConfigured,
    latestAttemptAt: latestAttemptAt && !Number.isNaN(latestAttemptAt.getTime())
      ? latestAttemptAt.toISOString()
      : null,
    latestAttemptStatus,
    latestRunAt: latestRunAt?.toISOString() ?? null,
    maxAgeHours,
    mode: settings.mode,
    ok: problems.length === 0,
    problems,
    testRecipientConfigured: settings.testRecipientConfigured,
  };
}

function positiveCount(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function optionalEnvValue(value) {
  const text = String(value ?? "").trim();

  return text || undefined;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function emailProvider() {
  const explicitProvider = optionalEnv("EMAIL_PROVIDER")?.toLowerCase();

  if (explicitProvider === "smtp" || explicitProvider === "resend") {
    return explicitProvider;
  }

  if (optionalEnv("SMTP_HOST") && optionalEnv("SMTP_USER") && optionalEnv("SMTP_PASSWORD")) {
    return "smtp";
  }

  if (optionalEnv("RESEND_API_KEY")) {
    return "resend";
  }

  throw new Error("Email delivery is not configured for live job monitor alerts.");
}

function requiredEnv(name, message) {
  const value = optionalEnv(name);

  if (!value) {
    throw new Error(message);
  }

  return value;
}

function optionalEnv(name) {
  const value = process.env[name]?.trim();

  return value || undefined;
}

function optionalDate(value) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const date = new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    throw new Error("JOB_MONITOR_NOW must be a valid ISO date/time.");
  }

  return date;
}

function positiveInteger(value, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.floor(number);
}

function smtpPort() {
  const port = Number.parseInt(process.env.SMTP_PORT ?? "", 10);

  return Number.isFinite(port) && port > 0 ? port : 465;
}

function booleanSetting(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (match) => {
    switch (match) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runJobMonitor();

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}
