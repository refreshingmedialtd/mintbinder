import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJobMonitorEmail,
  buildJobMonitorReport,
  priceAlertScheduleHealth,
  shouldSendJobMonitorAlert,
  successfulJobDegradation,
} from "../scripts/monitor-job-runs.mjs";
import { priceAlertScheduleSettings } from "../scripts/price-alert-schedule.mjs";

const now = new Date("2026-06-13T12:00:00.000Z");

test("reports healthy job history without sending alerts", () => {
  const report = buildJobMonitorReport({
    alertTo: "liam@example.com",
    detailLimit: 10,
    dryRun: false,
    failedRuns: [],
    lookbackMinutes: 90,
    now,
    staleMinutes: 45,
    staleRuns: [],
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.problems, []);
  assert.equal(shouldSendJobMonitorAlert(report), false);
});

test("summarizes failed and stale jobs", () => {
  const report = buildJobMonitorReport({
    alertTo: "liam@example.com",
    detailLimit: 10,
    dryRun: false,
    failedRuns: [
      {
        durationMs: 1200,
        errorMessage: "Provider timeout.",
        finishedAt: new Date("2026-06-13T11:40:02.000Z"),
        jobType: "PRICING_REFRESH",
        startedAt: new Date("2026-06-13T11:40:00.000Z"),
        status: "FAILED",
      },
    ],
    lookbackMinutes: 90,
    now,
    staleMinutes: 45,
    staleRuns: [
      {
        durationMs: null,
        errorMessage: null,
        finishedAt: null,
        jobType: "CATALOGUE_REFRESH",
        startedAt: new Date("2026-06-13T10:30:00.000Z"),
        status: "RUNNING",
      },
    ],
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.problems, [
    "1 failed job run in the last 90 minutes.",
    "1 running job run older than 45 minutes.",
  ]);
  assert.equal(shouldSendJobMonitorAlert(report), true);
  assert.equal(report.recentFailed.runs[0].jobType, "pricing_refresh");
  assert.equal(report.staleRunning.runs[0].status, "running");
});

test("keeps alerts quiet in dry-run mode and builds safe email content", () => {
  const report = buildJobMonitorReport({
    alertTo: "liam@example.com",
    detailLimit: 10,
    dryRun: true,
    failedRuns: [
      {
        errorMessage: "Bad <provider> response.",
        finishedAt: "2026-06-13T11:40:02.000Z",
        jobType: "PRICE_ALERTS",
        startedAt: "2026-06-13T11:40:00.000Z",
        status: "FAILED",
      },
    ],
    lookbackMinutes: 90,
    now,
    staleMinutes: 45,
    staleRuns: [],
  });
  const email = buildJobMonitorEmail(report);

  assert.equal(report.ok, false);
  assert.equal(shouldSendJobMonitorAlert(report), false);
  assert.match(email.subject, /Job monitor alert/);
  assert.match(email.text, /Bad <provider> response/);
  assert.match(email.html, /Bad &lt;provider&gt; response/);
});

test("reports recent failed billing webhooks with escaped email details", () => {
  const report = buildJobMonitorReport({
    alertTo: "liam@example.com",
    detailLimit: 10,
    dryRun: false,
    failedBillingWebhookCount: 2,
    failedBillingWebhooks: [
      {
        createdAt: new Date("2026-06-13T11:30:00.000Z"),
        errorMessage: "Customer <missing> & subscription rejected.",
        eventType: "subscription.updated",
        occurredAt: new Date("2026-06-13T11:29:59.000Z"),
        processedAt: new Date("2026-06-13T11:30:02.000Z"),
        provider: "square",
        providerEventId: "event-123",
        status: "FAILED",
        updatedAt: new Date("2026-06-13T11:30:02.000Z"),
      },
    ],
    failedRuns: [],
    lookbackMinutes: 90,
    now,
    staleMinutes: 45,
    staleRuns: [],
  });
  const email = buildJobMonitorEmail(report);

  assert.equal(report.ok, false);
  assert.equal(report.recentFailedBillingWebhooks.count, 2);
  assert.equal(report.recentFailedBillingWebhooks.events[0].status, "failed");
  assert.match(report.problems.join(" "), /2 failed billing webhook events/);
  assert.match(email.text, /square subscription\.updated \(event-123\)/);
  assert.match(email.text, /Customer <missing> & subscription rejected/);
  assert.match(email.html, /Customer &lt;missing&gt; &amp; subscription rejected/);
});

test("includes pricing-health failures in the operational alert", () => {
  const report = buildJobMonitorReport({
    alertTo: "liam@example.com",
    detailLimit: 10,
    dryRun: false,
    failedRuns: [],
    lookbackMinutes: 90,
    now,
    pricingHealth: {
      problems: ["Sealed pricing rotation is unhealthy."],
    },
    staleMinutes: 45,
    staleRuns: [],
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.problems, ["Sealed pricing rotation is unhealthy."]);
  assert.equal(shouldSendJobMonitorAlert(report), true);
});

test("surfaces unresolved notification claims with their oldest age", () => {
  const report = buildJobMonitorReport({
    alertTo: "liam@example.com",
    detailLimit: 10,
    dryRun: false,
    failedRuns: [],
    lookbackMinutes: 90,
    now,
    staleMinutes: 45,
    staleRuns: [],
    unresolvedNotificationDeliveryCount: 2,
    unresolvedNotificationDeliveryOldestAt: new Date("2026-06-13T09:30:00.000Z"),
  });

  assert.equal(report.ok, false);
  assert.equal(report.unresolvedNotificationDeliveries.count, 2);
  assert.equal(report.unresolvedNotificationDeliveries.oldestAgeHours, 2.5);
  assert.match(report.problems.join(" "), /2 notification delivery claims remain unresolved/);
});

test("surfaces stale or unresolved password-reset outbox work", () => {
  const report = buildJobMonitorReport({
    alertTo: "liam@example.com",
    detailLimit: 10,
    dryRun: false,
    failedRuns: [],
    lookbackMinutes: 90,
    now,
    passwordResetOutboxProblemCount: 3,
    passwordResetOutboxOldestAt: new Date("2026-06-13T11:30:00.000Z"),
    staleMinutes: 45,
    staleRuns: [],
  });

  assert.equal(report.ok, false);
  assert.equal(report.passwordResetOutbox.count, 3);
  assert.equal(report.passwordResetOutbox.oldestAgeMinutes, 30);
  assert.match(report.problems.join(" "), /3 password-reset outbox rows are stale or unresolved/);
});

test("surfaces partial provider failures hidden inside successful jobs", () => {
  assert.match(successfulJobDegradation({
    resultPayload: {
      failedSets: 2,
      secondSource: {
        candidatesChecked: 5,
        pricingSnapshotsCreated: 0,
        pricingSnapshotsUpdated: 0,
        provider: "cardtrader-sealed",
        status: "succeeded",
      },
    },
  }), /2 provider set refresh[\s\S]*cardtrader-sealed checked 5 candidate/);
});

test("surfaces a partial top-level graded provider result", () => {
  assert.match(successfulJobDegradation({
    resultPayload: {
      provider: "pricecharting-graded-card",
      status: "partial",
    },
  }), /pricecharting-graded-card reported partial/);
});

test("surfaces ambiguous or failed billing checkout retirements", () => {
  assert.match(successfulJobDegradation({
    resultPayload: {
      ambiguous: 2,
      errors: 1,
    },
  }), /2 billing checkout retirement\(s\) need reconciliation[\s\S]*1 billing checkout retirement provider operation/);
});

test("requires a recent daily price-alert run and reports safe delivery mode", () => {
  const settings = priceAlertScheduleSettings({
    PRICE_ALERT_DIGEST_DRY_RUN: "true",
  });
  const missing = priceAlertScheduleHealth({
    latestRun: null,
    maxAgeHours: 36,
    now,
    settings,
  });
  const current = priceAlertScheduleHealth({
    latestRun: { startedAt: new Date("2026-06-13T08:00:00.000Z") },
    maxAgeHours: 36,
    now,
    settings,
  });

  assert.equal(missing.ok, false);
  assert.match(missing.problems[0], /No price-alert digest job run/);
  assert.equal(current.ok, true);
  assert.equal(current.mode, "dry_run");
  assert.equal(current.ageHours, 4);
});

test("blocks accidental live recipient sends without explicit authorization", () => {
  const settings = priceAlertScheduleSettings({
    EMAIL_FROM: "Mint Binder <alerts@example.com>",
    PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS: "false",
    PRICE_ALERT_DIGEST_DRY_RUN: "false",
    SMTP_HOST: "smtp.example.com",
    SMTP_PASSWORD: "secret",
    SMTP_USER: "alerts@example.com",
  });

  assert.equal(settings.ok, false);
  assert.equal(settings.mode, "blocked");
  assert.match(settings.problems.join(" "), /test recipient/);
});
