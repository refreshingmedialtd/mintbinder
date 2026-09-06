import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildJobMonitorEmail,
  buildJobMonitorReport,
  priceAlertScheduleHealth,
  scheduledJobCadenceHealth,
  scheduledJobLane,
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
  const degradation = successfulJobDegradation({
    requestPayload: {
      scheduled: true,
      scheduler: "scheduled-set-pricing",
      writePrices: true,
    },
    resultPayload: {
      failedSets: 2,
      setResults: [
        {
          error: "Pokemon TCG API request failed with 500 after 3 attempts.",
          name: "Neo Genesis",
          providerId: "neo1",
          status: "failed",
          statusCode: 500,
        },
      ],
      secondSource: {
        apiRequests: 3,
        candidatesChecked: 5,
        outcome: "no_blueprint_match",
        pricingSnapshotsCreated: 0,
        pricingSnapshotsUpdated: 0,
        provider: "cardtrader-sealed",
        selectionMode: "discovery",
        status: "succeeded",
      },
    },
  });

  assert.match(degradation, /2 provider set refresh/);
  assert.match(degradation, /Neo Genesis \(neo1\).*HTTP 500/);
  assert.doesNotMatch(degradation, /cardtrader-sealed/);
});

test("labels catalogue discovery separately from Pokemon TCG set pricing", () => {
  assert.equal(scheduledJobLane({
    jobType: "CATALOGUE_REFRESH",
    requestPayload: { scheduled: true, setsOnly: true },
  }), "catalogue_discovery");
  assert.equal(scheduledJobLane({
    jobType: "PRICING_REFRESH",
    requestPayload: {
      scheduled: true,
      scheduler: "scheduled-set-pricing",
      writePrices: true,
    },
  }), "card_pricing");
  assert.equal(scheduledJobLane({
    jobType: "CATALOGUE_REFRESH",
    requestPayload: { scheduled: false, setsOnly: true },
  }), null);

  const report = buildJobMonitorReport({
    alertTo: "liam@example.com",
    detailLimit: 10,
    dryRun: false,
    failedRuns: [{
      errorMessage: "Pokemon TCG sets request failed with 500.",
      jobType: "CATALOGUE_REFRESH",
      requestPayload: { scheduled: true, setsOnly: true },
      startedAt: now,
      status: "FAILED",
    }],
    lookbackMinutes: 90,
    now,
    staleMinutes: 45,
    staleRuns: [],
  });
  const email = buildJobMonitorEmail(report);

  assert.equal(report.recentFailed.runs[0].lane, "catalogue_discovery");
  assert.equal(report.recentFailed.runs[0].label, "catalogue discovery");
  assert.match(email.text, /catalogue discovery failed/);
});

test("keeps API-healthy CardTrader discovery misses out of operational alerts", () => {
  assert.equal(successfulJobDegradation({
    resultPayload: {
      secondSource: {
        apiRequests: 4,
        candidatesChecked: 5,
        outcome: "no_eligible_listing",
        pricingSnapshotsCreated: 0,
        pricingSnapshotsUpdated: 0,
        provider: "cardtrader-sealed",
        selectionMode: "discovery",
        status: "succeeded",
      },
    },
  }), null);
});

test("keeps explicitly quarantined CardTrader observations out of provider-failure alerts", () => {
  assert.equal(successfulJobDegradation({
    resultPayload: {
      secondSource: {
        apiRequests: 4,
        candidatesChecked: 1,
        outcome: "quarantined",
        pricingObservationsQuarantined: 1,
        pricingSnapshotsCreated: 0,
        pricingSnapshotsUpdated: 0,
        provider: "cardtrader-sealed",
        selectionMode: "refresh",
        status: "succeeded",
      },
    },
  }), null);
});

test("keeps zero-output refreshes and unrecognized discovery results actionable", () => {
  for (const secondSource of [
    {
      apiRequests: 4,
      candidatesChecked: 5,
      outcome: "no_eligible_listing",
      provider: "cardtrader-sealed",
      selectionMode: "refresh",
      status: "succeeded",
    },
    {
      apiRequests: 3,
      candidatesChecked: 5,
      outcome: "unknown_result",
      provider: "cardtrader-sealed",
      selectionMode: "discovery",
      status: "succeeded",
    },
  ]) {
    assert.match(successfulJobDegradation({
      resultPayload: { secondSource },
    }), /produced no price snapshots/);
  }
});

test("keeps failed CardTrader work in operational alerts", () => {
  assert.match(successfulJobDegradation({
    resultPayload: {
      secondSource: {
        error: "CardTrader timed out.",
        provider: "cardtrader-sealed",
        status: "failed",
      },
    },
  }), /cardtrader-sealed reported failed/);
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
    latestAttempt: {
      startedAt: new Date("2026-06-13T08:00:00.000Z"),
      status: "SUCCEEDED",
    },
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

test("a newer failed scheduled price-alert attempt cannot be masked by an older success", () => {
  const settings = priceAlertScheduleSettings({
    PRICE_ALERT_DIGEST_DRY_RUN: "true",
  });
  const health = priceAlertScheduleHealth({
    latestAttempt: {
      startedAt: new Date("2026-06-13T11:00:00.000Z"),
      status: "FAILED",
    },
    latestRun: {
      startedAt: new Date("2026-06-13T08:00:00.000Z"),
      status: "SUCCEEDED",
    },
    maxAgeHours: 36,
    now,
    settings,
  });

  assert.equal(health.ok, false);
  assert.equal(health.latestAttemptStatus, "FAILED");
  assert.match(health.problems.join(" "), /Latest scheduled price-alert digest attempt failed/);
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

test("requires every independent scheduled job lane within its documented cadence", () => {
  const latestRuns = [
    ["catalogue_discovery", 30 * 60],
    ["international_catalogue", 14 * 60],
    ["card_pricing", 3 * 60],
    ["english_card_pricing", 3 * 60],
    ["japanese_card_pricing", 3 * 60],
    ["sealed_pricing", 3 * 60],
    ["password_reset_delivery", 10],
    ["billing_checkout_retirement", 30],
  ].map(([lane, ageMinutes]) => ({
    lane,
    latestAttemptAt: new Date(now.getTime() - ageMinutes * 60_000),
    latestAttemptStatus: "SUCCEEDED",
    latestSucceededAt: new Date(now.getTime() - ageMinutes * 60_000),
  }));
  const health = scheduledJobCadenceHealth({ latestRuns, now });

  assert.equal(health.ok, true);
  assert.equal(health.lanes.length, 8);
  assert.deepEqual(health.problems, []);
});

test("fails closed for missing, stale, invalid, and latest-failed schedule evidence", () => {
  const health = scheduledJobCadenceHealth({
    latestRuns: [
      {
        lane: "card_pricing",
        latestAttemptAt: new Date("2026-06-13T11:55:00.000Z"),
        latestAttemptStatus: "FAILED",
        latestSucceededAt: new Date("2026-06-13T11:00:00.000Z"),
      },
      {
        lane: "sealed_pricing",
        latestAttemptAt: new Date("2026-06-13T08:59:00.000Z"),
        latestAttemptStatus: "SUCCEEDED",
        latestSucceededAt: new Date("2026-06-13T08:59:00.000Z"),
      },
      {
        lane: "japanese_card_pricing",
        latestAttemptAt: "not-a-date",
        latestAttemptStatus: "SUCCEEDED",
        latestSucceededAt: "not-a-date",
      },
    ],
    now,
  });
  const byKey = new Map(health.lanes.map((lane) => [lane.key, lane]));

  assert.equal(health.ok, false);
  assert.match(byKey.get("card_pricing").problem, /Latest Pokemon TCG card pricing attempt failed/);
  assert.match(byKey.get("sealed_pricing").problem, /3\.1 hours old/);
  assert.match(byKey.get("japanese_card_pricing").problem, /No successful Japanese card pricing job/);
  assert.match(byKey.get("english_card_pricing").problem, /No successful English TCGCSV card pricing job/);
});

test("supports explicit cadence thresholds without letting one lane mask another", () => {
  const health = scheduledJobCadenceHealth({
    env: {
      JOB_MONITOR_ENGLISH_CARD_PRICING_MAX_AGE_HOURS: "4",
      JOB_MONITOR_JAPANESE_CARD_PRICING_MAX_AGE_HOURS: "2",
    },
    latestRuns: [
      {
        lane: "english_card_pricing",
        latestAttemptAt: new Date("2026-06-13T09:00:00.000Z"),
        latestAttemptStatus: "SUCCEEDED",
        latestSucceededAt: new Date("2026-06-13T09:00:00.000Z"),
      },
      {
        lane: "japanese_card_pricing",
        latestAttemptAt: new Date("2026-06-13T09:00:00.000Z"),
        latestAttemptStatus: "SUCCEEDED",
        latestSucceededAt: new Date("2026-06-13T09:00:00.000Z"),
      },
    ],
    now,
  });
  const byKey = new Map(health.lanes.map((lane) => [lane.key, lane]));

  assert.equal(byKey.get("english_card_pricing").ok, true);
  assert.equal(byKey.get("japanese_card_pricing").ok, false);
});

test("cadence evidence requires scheduler provenance and effective pricing writes", () => {
  const source = readFileSync(new URL("../scripts/monitor-job-runs.mjs", import.meta.url), "utf8");
  const queryStart = source.indexOf("WITH classified_runs AS");
  const queryEnd = source.indexOf("function passwordResetOutboxProblemWhere", queryStart);
  const query = source.slice(queryStart, queryEnd);

  assert.ok(queryStart >= 0 && queryEnd > queryStart);
  assert.equal((query.match(/request_payload->>'scheduled' = 'true'/g) ?? []).length, 8);
  assert.equal((query.match(/request_payload->>'writePrices' = 'true'/g) ?? []).length, 4);
  assert.match(source, /requestPayload: \{ path: \["scheduled"\], equals: true \}/);

  for (const relativePath of [
    "../src/app/api/jobs/billing-checkout-retirement/route.ts",
    "../src/app/api/jobs/catalogue-refresh/route.ts",
    "../src/app/api/jobs/international-card-pricing/route.ts",
    "../src/app/api/jobs/password-reset-delivery/route.ts",
    "../src/app/api/jobs/price-alerts/route.ts",
    "../src/app/api/jobs/scheduled-pricing/route.ts",
    "../src/app/api/jobs/scheduled-set-pricing/route.ts",
    "../src/app/api/jobs/sealed-pricing-refresh/route.ts",
  ]) {
    const route = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(route, /scheduled: body\.scheduled === true/, `${relativePath} must retain scheduler provenance`);
  }
});
