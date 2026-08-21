import assert from "node:assert/strict";
import test from "node:test";
import { buildPricingHealthReport } from "../scripts/report-pricing-health.mjs";

test("reports healthy regular card and sealed pricing rotation", () => {
  const report = buildPricingHealthReport({
    cardLanguages: [
      { fresh: 20_400, language: "en", priced: 20_410, total: 20_420 },
      { fresh: 4_180, language: "ja", priced: 4_190, total: 6_240 },
      { fresh: 0, language: "zh-tw", priced: 0, total: 7_400 },
    ],
    collisionStreams: 0,
    generatedAt: new Date("2026-08-21T10:00:00.000Z"),
    sealed: { fresh: 1_500, priced: 1_550, total: 1_950 },
    sealedRotation: { availableSets: 136, jobs: 168, uniqueSets: 130, zeroOutputJobs: 12 },
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
  });

  assert.equal(report.ok, false);
  assert.equal(report.problems.length, 4);
  assert.match(report.problems[0], /en card pricing freshness/);
  assert.match(report.problems[1], /Sealed pricing freshness/);
  assert.match(report.problems[2], /visited 43 of 136 sets/);
  assert.match(report.problems[3], /3 TCGCSV card price stream/);
});
