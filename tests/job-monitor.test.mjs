import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJobMonitorEmail,
  buildJobMonitorReport,
  shouldSendJobMonitorAlert,
} from "../scripts/monitor-job-runs.mjs";

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
