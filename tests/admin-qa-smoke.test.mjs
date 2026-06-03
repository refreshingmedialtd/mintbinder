import assert from "node:assert/strict";
import test from "node:test";
import {
  adminFailures,
  adminWarnings,
  catalogueWarnings,
  conversionRateWarnings,
  countWarnings,
  jobRunWarnings,
} from "../scripts/admin-qa-smoke.mjs";

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
      "Admin QA user liam@example.com is not on an active Plus plan; complete Stripe/webhook QA before beta.",
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

test("warns on missing conversion rates, audit rows, and job runs", () => {
  assert.deepEqual(
    conversionRateWarnings([
      { key: "POKEMON_TCG_USD_TO_GBP_RATE", valid: false },
      { key: "POKEMON_TCG_EUR_TO_GBP_RATE", valid: false },
      { key: "TCGCSV_USD_TO_GBP_RATE", valid: false },
    ]),
    [
      "POKEMON_TCG_USD_TO_GBP_RATE is not configured with a positive number; Pokemon card pricing jobs will fail.",
      "POKEMON_TCG_EUR_TO_GBP_RATE is not configured with a positive number; Cardmarket fallback pricing is disabled.",
      "TCGCSV_USD_TO_GBP_RATE is not configured and no Pokemon USD fallback is available; sealed pricing jobs will fail.",
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
      failedRecentJobRuns: 1,
      latestJobRunsByType: {
        CATALOGUE_REFRESH: null,
        PRICE_ALERTS: { status: "FAILED", errorMessage: "Email provider missing." },
        PRICING_REFRESH: { status: "SUCCEEDED" },
        SEALED_PRICING_REFRESH: { status: "SUCCEEDED" },
      },
    }),
    [
      "1 job run failed in the last 24 hours.",
      "No catalogue refresh job run has been recorded yet.",
      "Latest price alerts job run failed: Email provider missing.",
    ],
  );
});
