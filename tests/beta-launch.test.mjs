import assert from "node:assert/strict";
import test from "node:test";
import {
  betaEnvironmentSnapshot,
  betaLaunchChecks,
} from "../src/lib/jobs/beta-launch.ts";

const healthyCatalogue = {
  cardCount: 20_500,
  cardImageCoveragePercent: 100,
  pricingCoveragePercent: 99,
  sealedPricingCoveragePercent: 82,
};

test("does not report a dry-run job monitor as beta-ready", () => {
  const env = betaEnvironmentSnapshot({
    DATABASE_URL: "postgresql://production",
    EMAIL_SMOKE_TO: "ops@example.com",
    JOB_MONITOR_DRY_RUN: "true",
    JOB_SECRET: "job-secret",
    PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS: "false",
    PRICE_ALERT_DIGEST_DRY_RUN: "true",
    SQUARE_ENVIRONMENT: "sandbox",
  });
  const monitoring = betaLaunchChecks({ catalogue: healthyCatalogue, env })
    .find((entry) => entry.label === "Monitoring");

  assert.equal(monitoring?.passed, false);
  assert.equal(monitoring?.level, "watch");
  assert.match(monitoring?.detail ?? "", /dry-run/);
});

test("reports job-monitor readiness only with live mode and a recipient", () => {
  const env = betaEnvironmentSnapshot({
    DATABASE_URL: "postgresql://production",
    JOB_MONITOR_ALERT_TO: "ops@example.com",
    JOB_MONITOR_DRY_RUN: "false",
    JOB_SECRET: "job-secret",
    PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS: "false",
    PRICE_ALERT_DIGEST_DRY_RUN: "true",
    SQUARE_ENVIRONMENT: "production",
  });
  const monitoring = betaLaunchChecks({ catalogue: healthyCatalogue, env })
    .find((entry) => entry.label === "Monitoring");

  assert.equal(env.jobMonitorAlertToConfigured, true);
  assert.equal(monitoring?.passed, true);
  assert.equal(monitoring?.level, "good");
});

test("reports missing live monitor recipients explicitly", () => {
  const env = betaEnvironmentSnapshot({ JOB_MONITOR_DRY_RUN: "false" });
  const monitoring = betaLaunchChecks({ catalogue: healthyCatalogue, env })
    .find((entry) => entry.label === "Monitoring");

  assert.equal(monitoring?.passed, false);
  assert.match(monitoring?.detail ?? "", /no recipient/);
});
