import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPricingHealthReport,
  loadPricingHealthMetrics,
} from "../scripts/report-pricing-health.mjs";

test("reports healthy regular card and sealed pricing rotation", () => {
  const report = buildPricingHealthReport({
    cardLanguages: [
      { fresh: 20_400, language: "en", priced: 20_410, total: 20_420 },
      { fresh: 4_180, language: "ja", priced: 4_190, total: 6_240 },
      { fresh: 0, language: "zh-tw", priced: 0, total: 7_400 },
    ],
    collisionStreams: 0,
    generatedAt: new Date("2026-08-21T10:00:00.000Z"),
    sealed: { fresh: 1_500, priced: 1_600, total: 1_950 },
    sealedRotation: { availableSets: 136, jobs: 168, uniqueSets: 130, zeroOutputJobs: 12 },
    sealedSources: [{
      freshItems: 1_500,
      latestObservedAt: new Date("2026-08-21T09:30:00.000Z"),
      pricedItems: 1_600,
      snapshots: 8_000,
      source: "tcgcsv",
    }],
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.problems, []);
  assert.equal(report.cardLanguages[0].freshPricedPercent, 100);
  assert.equal(report.sealedRotation7d.coveragePercent, 95.6);
});

test("flags stale sealed prices, broken rotation, and provider identity collisions", () => {
  const report = buildPricingHealthReport({
    cardLanguages: [{ fresh: 19_500, language: "en", priced: 20_400, total: 20_420 }],
    collisionStreams: 3,
    generatedAt: new Date("2026-08-21T10:00:00.000Z"),
    sealed: { fresh: 195, priced: 1_553, total: 1_951 },
    sealedRotation: { availableSets: 136, jobs: 168, uniqueSets: 43, zeroOutputJobs: 20 },
    sealedSources: [{
      freshItems: 195,
      latestObservedAt: new Date("2026-08-21T09:30:00.000Z"),
      pricedItems: 1_553,
      snapshots: 8_000,
      source: "tcgcsv",
    }],
  });

  assert.equal(report.ok, false);
  assert.equal(report.problems.length, 5);
  assert.match(report.problems[0], /en card pricing freshness/);
  assert.match(report.problems[1], /Sealed pricing coverage/);
  assert.match(report.problems[2], /Sealed pricing freshness/);
  assert.match(report.problems[3], /visited 43 of 136 sets/);
  assert.match(report.problems[4], /3 TCGCSV card price stream/);
});

test("flags raw subtype collisions hidden under one TCGCSV product identity", () => {
  const report = buildPricingHealthReport({
    cardLanguages: [],
    collisionStreams: 0,
    generatedAt: new Date("2026-09-06T10:00:00.000Z"),
    rawSubtypeCollisionStreams: 2,
    sealed: { fresh: 0, priced: 0, total: 0 },
    sealedRotation: { availableSets: 0, jobs: 0, uniqueSets: 0, zeroOutputJobs: 0 },
    sealedSources: [],
  });

  assert.equal(report.ok, false);
  assert.equal(report.rawSubtypeCollisionStreams, 2);
  assert.match(report.problems.join(" "), /multiple raw subtypes under one provider product ID/);
});

test("loads same-sourceRef raw subtype collisions into pricing health metrics", async () => {
  const queries = [];
  const prisma = {
    $queryRaw: async (strings) => {
      const sql = strings.join("?");

      queries.push(sql);

      if (sql.includes("raw_subtype_collisions")) {
        return [{ count: 0, rawSubtypeCount: 2 }];
      }

      return [];
    },
  };
  const metrics = await loadPricingHealthMetrics({
    now: new Date("2026-09-06T10:00:00.000Z"),
    prisma,
  });
  const collisionQuery = queries.find((query) => query.includes("raw_subtype_collisions"));

  assert.equal(metrics.rawSubtypeCollisionStreams, 2);
  assert.match(collisionQuery, /GROUP BY card_printing_id, source, source_ref, variant_label/);
  assert.match(collisionQuery, /metadata->>'subTypeName'/);
});

test("degrades when configured CardTrader has no output and snapshot growth exceeds limits", () => {
  const report = buildPricingHealthReport({
    cardLanguages: [{ fresh: 100, language: "en", priced: 100, total: 100 }],
    collisionStreams: 0,
    generatedAt: new Date("2026-08-21T10:00:00.000Z"),
    sealed: { fresh: 90, priced: 90, total: 100 },
    sealedRotation: { availableSets: 10, jobs: 10, uniqueSets: 10, zeroOutputJobs: 0 },
    sealedSources: [{
      freshItems: 90,
      latestObservedAt: new Date("2026-08-21T09:30:00.000Z"),
      pricedItems: 90,
      snapshots: 300,
      source: "tcgcsv",
    }],
    snapshotGrowth: {
      created7d: 700,
      storageBytes: 1_000_000,
      total: 1_000,
    },
  }, {
    cardTraderExpected: true,
    maxSnapshotDailyGrowth: 50,
    maxSnapshotProjectedAnnualRows: 20_000,
  });

  assert.equal(report.ok, false);
  assert.equal(report.status, "degraded");
  assert.match(report.problems.join("\n"), /CardTrader sealed pricing is configured/);
  assert.match(report.problems.join("\n"), /growing by 100 rows\/day/);
  assert.match(report.problems.join("\n"), /projected to reach/);
  assert.equal(report.sealedSources.find((row) => row.source === "cardtrader-sealed").pricedItems, 0);
  assert.equal(report.snapshotGrowth.projectedTotalRowsOneYear, 37_500);
});

test("infers CardTrader expectation from the latest sealed job when the local token is unavailable", () => {
  const now = new Date("2026-08-21T10:00:00.000Z");
  const report = buildPricingHealthReport({
    cardTraderConfigured: true,
    cardLanguages: [],
    collisionStreams: 0,
    generatedAt: now,
    sealed: { fresh: 1, priced: 1, total: 1 },
    sealedRotation: { availableSets: 1, jobs: 1, uniqueSets: 1, zeroOutputJobs: 0 },
    sealedSources: [{
      freshItems: 1,
      latestObservedAt: now,
      pricedItems: 1,
      snapshots: 1,
      source: "tcgcsv",
    }],
  });

  assert.equal(report.ok, false);
  assert.match(report.problems.join(" "), /CardTrader sealed pricing is configured/);
});

test("does not treat token CardTrader output as meaningful second-source coverage", () => {
  const now = new Date("2026-08-21T10:00:00.000Z");
  const report = buildPricingHealthReport({
    cardLanguages: [],
    collisionStreams: 0,
    generatedAt: now,
    sealed: { fresh: 90, priced: 90, total: 100 },
    sealedRotation: { availableSets: 10, jobs: 10, uniqueSets: 10, zeroOutputJobs: 0 },
    sealedSources: [
      {
        freshItems: 90,
        latestObservedAt: now,
        pricedItems: 90,
        snapshots: 300,
        source: "tcgcsv",
      },
      {
        freshItems: 1,
        latestObservedAt: now,
        pricedItems: 1,
        snapshots: 1,
        source: "cardtrader-sealed",
      },
    ],
  }, { cardTraderExpected: true, minCardTraderCoveragePercent: 5 });

  assert.equal(report.ok, false);
  assert.match(report.problems.join(" "), /meaningful second source/);
  assert.equal(report.sealedSources.find((row) => row.source === "cardtrader-sealed").coveragePercent, 1);
  assert.equal(report.sealedSources.find((row) => row.source === "cardtrader-sealed").freshPricedPercent, 100);
});

test("uses aggregate CardTrader coverage and freshness instead of per-batch discovery yield", () => {
  const now = new Date("2026-09-05T14:00:00.000Z");
  const metrics = {
    cardLanguages: [],
    collisionStreams: 0,
    generatedAt: now,
    sealed: { fresh: 90, priced: 90, total: 100 },
    sealedRotation: { availableSets: 10, jobs: 10, uniqueSets: 10, zeroOutputJobs: 3 },
    sealedSources: [
      {
        freshItems: 90,
        latestObservedAt: now,
        pricedItems: 90,
        snapshots: 300,
        source: "tcgcsv",
      },
      {
        freshItems: 5,
        latestObservedAt: now,
        pricedItems: 5,
        snapshots: 5,
        source: "cardtrader-sealed",
      },
    ],
  };
  const healthy = buildPricingHealthReport(metrics, { cardTraderExpected: true });
  const stale = buildPricingHealthReport({
    ...metrics,
    generatedAt: new Date("2026-09-08T15:00:00.000Z"),
    sealedSources: metrics.sealedSources.map((source) => source.source === "tcgcsv"
      ? { ...source, latestObservedAt: new Date("2026-09-08T15:00:00.000Z") }
      : source),
  }, { cardTraderExpected: true });
  const insufficientFreshness = buildPricingHealthReport({
    ...metrics,
    sealedSources: metrics.sealedSources.map((source) => source.source === "cardtrader-sealed"
      ? { ...source, freshItems: 3 }
      : source),
  }, { cardTraderExpected: true });

  assert.equal(healthy.ok, true);
  assert.equal(healthy.sealedRotation7d.zeroOutputJobs, 3);
  assert.match(stale.problems.join(" "), /Latest CardTrader sealed evidence/);
  assert.match(insufficientFreshness.problems.join(" "), /CardTrader sealed freshness is 60%/);
});

test("reports exact variant coverage and freshness independently of card-level health", () => {
  const report = buildPricingHealthReport({
    cardLanguages: [{ fresh: 100, language: "en", priced: 100, total: 100 }],
    cardVariantStreams: [{ available: 200, fresh: 160, language: "en", priced: 180 }],
    collisionStreams: 0,
    generatedAt: new Date("2026-08-21T10:00:00.000Z"),
    sealed: { fresh: 0, priced: 0, total: 0 },
    sealedRotation: { availableSets: 0, jobs: 0, uniqueSets: 0, zeroOutputJobs: 0 },
    sealedSources: [],
  });

  assert.equal(report.ok, false);
  assert.equal(report.cardVariantStreams[0].coveragePercent, 90);
  assert.equal(report.cardVariantStreams[0].freshPricedPercent, 88.9);
  assert.match(report.problems.join(" "), /exact card-variant pricing coverage/);
  assert.match(report.problems.join(" "), /exact card-variant pricing freshness/);
});

test("degrades configured PriceCharting graded pricing on zero output and reports ambiguous-grade limitations", () => {
  const report = buildPricingHealthReport({
    cardLanguages: [],
    collisionStreams: 0,
    generatedAt: new Date("2026-08-24T12:00:00.000Z"),
    gradedPriceCharting: {
      freshTargets: 0,
      pricedTargets: 0,
      requestedTargets: 6,
      supportedTargets: 4,
      unsupportedTargets: 2,
    },
    priceChartingGradedConfigured: true,
    sealed: { fresh: 0, priced: 0, total: 0 },
    sealedRotation: { availableSets: 0, jobs: 0, uniqueSets: 0, zeroOutputJobs: 0 },
    sealedSources: [],
  });

  assert.equal(report.ok, false);
  assert.match(report.problems.join(" "), /has produced no company-specific snapshots/);
  assert.match(report.limitations.join(" "), /non-10 grade fields do not identify PSA, BGS, or CGC/);
  assert.equal(report.gradedPriceCharting.coveragePercent, 0);
});

test("reports healthy exact graded target coverage without treating unsupported grades as written", () => {
  const report = buildPricingHealthReport({
    cardLanguages: [],
    collisionStreams: 0,
    generatedAt: new Date("2026-08-24T12:00:00.000Z"),
    gradedPriceCharting: {
      freshTargets: 4,
      latestObservedAt: new Date("2026-08-24T10:00:00.000Z"),
      pricedTargets: 4,
      requestedTargets: 5,
      supportedTargets: 4,
      unsupportedTargets: 1,
    },
    priceChartingGradedConfigured: true,
    sealed: { fresh: 0, priced: 0, total: 0 },
    sealedRotation: { availableSets: 0, jobs: 0, uniqueSets: 0, zeroOutputJobs: 0 },
    sealedSources: [],
  });

  assert.equal(report.ok, true);
  assert.equal(report.gradedPriceCharting.coveragePercent, 100);
  assert.equal(report.gradedPriceCharting.freshPercent, 100);
  assert.equal(report.gradedPriceCharting.latestAgeHours, 2);
  assert.equal(report.limitations.length, 1);
});
