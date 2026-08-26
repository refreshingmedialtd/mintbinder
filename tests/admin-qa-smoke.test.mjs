import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  adminFailures,
  adminWarnings,
  catalogueWarnings,
  conversionRateWarnings,
  countWarnings,
  exchangeRateStatus,
  jobRunWarnings,
} from "../scripts/admin-qa-smoke.mjs";

test("admin QA sealed catalogue metrics exclude tenant-private products", async () => {
  const source = await readFile(new URL("../scripts/admin-qa-smoke.mjs", import.meta.url), "utf8");
  assert.match(source, /sealedProduct\.count\(\{ where: \{ visibility: "GLOBAL" \} \}\)/);
  assert.equal(
    (source.match(/visibility = 'global'::catalogue_visibility/g) ?? []).length >= 3,
    true,
  );
});

test("flags missing admin setup as launch-blocking", () => {
  assert.deepEqual(adminFailures("missing@example.com", null), [
    "Admin QA user missing@example.com was not found.",
  ]);
  assert.deepEqual(
    adminFailures("collector@example.com", {
      notificationPreference: null,
      passwordHash: "",
      role: "USER",
      subscriptions: [],
    }),
    [
      "Admin QA user collector@example.com does not have ADMIN role.",
      "Admin QA user collector@example.com does not have a password hash.",
      "Admin QA user collector@example.com has no notification preferences row.",
      "Admin QA user collector@example.com has no subscription row.",
    ],
  );
});

test("warns when the admin user cannot exercise Plus or audit flows", () => {
  assert.deepEqual(
    adminWarnings("liam@example.com", {
      _count: {
        collectionEvents: 0,
        storageLocations: 0,
      },
      subscriptions: [{ plan: "FREE", status: "ACTIVE" }],
    }),
    [
      "Admin QA user liam@example.com is not on an active Plus plan; complete billing/webhook QA before beta.",
      "Admin QA user liam@example.com has no storage locations.",
      "Admin QA user liam@example.com has no collection events.",
    ],
  );
});

test("summarizes catalogue coverage warnings conservatively", () => {
  assert.deepEqual(
    catalogueWarnings({
      cardImageCoveragePercent: 79,
      cardPricingCoveragePercent: 29,
      cardVariantMetadataCoveragePercent: 49,
      sealedImageCoveragePercent: 49,
      sealedPricingCoveragePercent: 19,
      sealedProductCount: 10,
    }),
    [
      "Card pricing coverage is 29%; run card pricing imports before beta.",
      "Card image coverage is 79%; run card image repair before beta.",
      "Card variant metadata coverage is 49%; run variant metadata repair before beta.",
      "Sealed pricing coverage is 19%; run sealed pricing imports before beta.",
      "Sealed image coverage is 49%; run sealed image repair before beta.",
    ],
  );
});

test("treats manual conversion rates as optional when automatic exchange rates are enabled", () => {
  assert.deepEqual(
    exchangeRateStatus({
      EXCHANGE_RATES_PROVIDER: "frankfurter",
      EXCHANGE_RATES_AUTO: "true",
    }),
    {
      allowEnvFallback: true,
      automatic: true,
      endpoint: "https://api.frankfurter.app/latest",
      provider: "frankfurter",
    },
  );
  assert.deepEqual(
    conversionRateWarnings([
      { key: "POKEMON_TCG_USD_TO_GBP_RATE", valid: false },
      { key: "POKEMON_TCG_EUR_TO_GBP_RATE", valid: false },
      { key: "TCGCSV_USD_TO_GBP_RATE", valid: false },
    ]),
    [],
  );
});

test("warns on missing manual conversion rates, audit rows, and job runs", () => {
  assert.deepEqual(
    conversionRateWarnings(
      [
        { key: "POKEMON_TCG_USD_TO_GBP_RATE", valid: false },
        { key: "POKEMON_TCG_EUR_TO_GBP_RATE", valid: false },
        { key: "TCGCSV_USD_TO_GBP_RATE", valid: false },
      ],
      { automaticExchangeRates: false },
    ),
    [
      "POKEMON_TCG_USD_TO_GBP_RATE is not configured with a positive number while automatic exchange rates are disabled; Pokemon card pricing jobs will fail.",
      "POKEMON_TCG_EUR_TO_GBP_RATE is not configured with a positive number while automatic exchange rates are disabled; Pokemon TCG API Cardmarket fallback prices will be skipped.",
      "TCGCSV_USD_TO_GBP_RATE is not configured and no Pokemon USD fallback is available while automatic exchange rates are disabled; sealed pricing jobs will fail.",
    ],
  );
  assert.deepEqual(
    countWarnings({
      collectionEvents: 1,
      collectionItems: 2,
      jobRuns: 0,
      sealedProducts: 0,
      storageLocations: 0,
      subscriptions: 1,
      users: 2,
      wishlistItems: 0,
    }),
    [
      "No sealed products exist.",
      "Collection event count is lower than collection item count; audit trail coverage may be incomplete.",
      "No storage locations exist.",
      "Some users have no subscription row.",
      "No wishlist items exist.",
      "No job runs have been recorded yet. Run an Operations job to verify job history.",
    ],
  );
  assert.deepEqual(
    jobRunWarnings({
      now: new Date("2026-06-03T10:00:00.000Z"),
      recentFailedJobRunReport: {
        runs: [
          {
            errorMessage: "Missing GBP conversion rate.",
            jobType: "PRICING_REFRESH",
            startedAt: "2026-06-03T09:15:00.000Z",
          },
        ],
        total: 1,
      },
      latestJobRunsByType: {
        CATALOGUE_REFRESH: null,
        PRICE_ALERTS: { status: "FAILED", errorMessage: "Email provider missing." },
        PRICING_REFRESH: { status: "SUCCEEDED", startedAt: "2026-06-03T09:20:00.000Z" },
        SEALED_PRICING_REFRESH: { status: "SUCCEEDED" },
      },
    }),
    [
      "1 job run failed in the last 24 hours; latest failed pricing refresh started 2026-06-03T09:15:00.000Z: Missing GBP conversion rate. Latest pricing refresh has since succeeded at 2026-06-03T09:20:00.000Z.",
      "No catalogue refresh job run has been recorded yet.",
      "Latest price alerts job run failed: Email provider missing.",
    ],
  );
});

test("warns when key scheduled jobs are stale", () => {
  assert.deepEqual(
    jobRunWarnings({
      now: new Date("2026-06-05T12:00:00.000Z"),
      recentFailedJobRunReport: {
        runs: [],
        total: 0,
      },
      latestJobRunsByType: {
        CATALOGUE_REFRESH: { status: "SUCCEEDED", startedAt: "2026-06-04T12:01:00.000Z" },
        PRICE_ALERTS: { status: "SUCCEEDED", startedAt: "2026-06-01T08:00:00.000Z" },
        PRICING_REFRESH: { status: "SUCCEEDED", startedAt: "2026-06-05T08:00:00.000Z" },
        SEALED_PRICING_REFRESH: { status: "SUCCEEDED", startedAt: "2026-06-01T09:00:00.000Z" },
      },
    }),
    [
      "Latest price alerts job run is stale: 2026-06-01T08:00:00.000Z is older than 36 hours.",
      "Latest catalogue refresh job run is stale: 2026-06-04T12:01:00.000Z is older than 14 hours.",
      "Latest pricing refresh job run is stale: 2026-06-05T08:00:00.000Z is older than 3 hours.",
      "Latest sealed pricing refresh job run is stale: 2026-06-01T09:00:00.000Z is older than 3 hours.",
    ],
  );
});
