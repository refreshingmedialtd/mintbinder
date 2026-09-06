import assert from "node:assert/strict";
import test from "node:test";
import {
  cardTraderOutlierRepairOptions,
  cardTraderQuarantineSource,
  runCardTraderOutlierRepair,
} from "../scripts/quarantine-cardtrader-sealed-outliers.mjs";

test("CardTrader historical repair is dry-run by default and requires --confirm to apply", () => {
  assert.equal(cardTraderOutlierRepairOptions({ args: [] }).apply, false);
  assert.equal(cardTraderOutlierRepairOptions({ args: ["--confirm", "--limit=50"] }).apply, true);
  assert.equal(cardTraderOutlierRepairOptions({ args: ["--limit=999999"] }).limit, 2_000);
});

test("dry-run identifies historical sparse and divergent asks without changing evidence", async () => {
  const fixture = repairFixture();
  const report = await runCardTraderOutlierRepair({
    now: "2026-09-06T12:00:00.000Z",
    options: { ...defaultOptions(), apply: false },
    prisma: fixture.prisma,
  });

  assert.equal(report.dryRun, true);
  assert.equal(report.scanned, 3);
  assert.equal(report.trusted, 1);
  assert.equal(report.wouldQuarantine, 2);
  assert.equal(report.quarantineReasons.sparseListings, 1);
  assert.equal(report.quarantineReasons.referenceDivergence, 1);
  assert.equal(report.quarantined, 0);
  assert.equal(fixture.updates.length, 0);
  assert.equal(fixture.disconnected(), true);
});

test("historical repair scans every stable page instead of stranding older rows", async () => {
  const fixture = repairFixture();
  const report = await runCardTraderOutlierRepair({
    now: "2026-09-06T12:00:00.000Z",
    options: { ...defaultOptions(), apply: false, limit: 2 },
    prisma: fixture.prisma,
  });

  assert.equal(report.pageSize, 2);
  assert.equal(report.scanned, 3);
  assert.equal(report.wouldQuarantine, 2);
});

test("historical repair never compares an old ask with a later market reference", async () => {
  const fixture = repairFixture({
    referenceObservedAt: "2026-09-06T10:00:00.000Z",
    snapshotObservedAt: "2026-08-01T10:00:00.000Z",
  });
  const report = await runCardTraderOutlierRepair({
    now: "2026-09-06T12:00:00.000Z",
    options: { ...defaultOptions(), apply: false },
    prisma: fixture.prisma,
  });

  assert.equal(report.wouldQuarantine, 1);
  assert.equal(report.quarantineReasons.sparseListings, 1);
  assert.equal(report.quarantineReasons.referenceDivergence, undefined);
});

test("confirmed repair re-sources only rejected snapshots and retains quarantine metadata", async () => {
  const fixture = repairFixture();
  const report = await runCardTraderOutlierRepair({
    now: "2026-09-06T12:00:00.000Z",
    options: { ...defaultOptions(), apply: true },
    prisma: fixture.prisma,
  });

  assert.equal(report.dryRun, false);
  assert.equal(report.quarantined, 2);
  assert.deepEqual(fixture.updates.map((update) => update.where.id).sort(), ["divergent", "sparse"]);
  assert.equal(fixture.updates.every((update) => update.data.source === cardTraderQuarantineSource), true);
  const sparseUpdate = fixture.updates.find((update) => update.where.id === "sparse");
  const divergentUpdate = fixture.updates.find((update) => update.where.id === "divergent");

  assert.equal(sparseUpdate.data.metadata.quarantine.originalSource, "cardtrader-sealed");
  assert.equal(sparseUpdate.data.metadata.quarantine.status, "quarantined_sparse_listings");
  assert.equal(divergentUpdate.data.metadata.quarantine.referencePriceMinor, 7_880);
  assert.equal(fixture.disconnected(), true);
});

test("confirmed historical quarantine is idempotent", async () => {
  const fixture = repairFixture();
  const request = {
    now: "2026-09-06T12:00:00.000Z",
    options: { ...defaultOptions(), apply: true },
    prisma: fixture.prisma,
  };
  const first = await runCardTraderOutlierRepair(request);
  const second = await runCardTraderOutlierRepair(request);

  assert.equal(first.quarantined, 2);
  assert.equal(second.scanned, 1);
  assert.equal(second.wouldQuarantine, 0);
  assert.equal(second.quarantined, 0);
  assert.equal(fixture.updates.length, 2);
});

function defaultOptions() {
  return {
    limit: 500,
    maxOfferPriceRatio: 4,
    maxReferencePriceRatio: 4,
    minOfferCount: 3,
    minReferenceDifferenceMinor: 5_000,
    referenceMaxAgeDays: 14,
  };
}

function repairFixture({
  referenceObservedAt = "2026-09-05T09:00:00.000Z",
  snapshotObservedAt = "2026-09-05T10:00:00.000Z",
} = {}) {
  const updates = [];
  let didDisconnect = false;
  const snapshots = [
    snapshot("sparse", "product-sparse", 942_981, [942_981], snapshotObservedAt),
    snapshot("normal", "product-normal", 12_000, [10_000, 12_000, 14_000], snapshotObservedAt),
    snapshot("divergent", "product-divergent", 942_981, [900_000, 942_981, 980_000], snapshotObservedAt),
  ];
  const references = [
    reference("product-sparse", 7_880, referenceObservedAt),
    reference("product-normal", 11_500, referenceObservedAt),
    reference("product-divergent", 7_880, referenceObservedAt),
  ];
  const prisma = {
    $disconnect: async () => {
      didDisconnect = true;
    },
    priceSnapshot: {
      findMany: async ({ take, where }) => where.source === "cardtrader-sealed"
        ? snapshots
            .filter((snapshot) => snapshot.source === "cardtrader-sealed")
            .filter((snapshot) => !where.id?.gt || snapshot.id > where.id.gt)
            .sort((left, right) => left.id.localeCompare(right.id))
            .slice(0, take)
        : references.filter((row) =>
            row.observedAt >= where.observedAt.gte && row.observedAt <= where.observedAt.lte
          ),
      updateMany: async (request) => {
        const snapshot = snapshots.find((candidate) =>
          candidate.id === request.where.id && candidate.source === request.where.source
        );

        if (!snapshot) {
          return { count: 0 };
        }

        updates.push(request);
        snapshot.metadata = request.data.metadata;
        snapshot.source = request.data.source;
        return { count: 1 };
      },
    },
  };

  return { disconnected: () => didDisconnect, prisma, updates };
}

function snapshot(id, sealedProductId, priceMinor, convertedPriceSamplesMinor, observedAt) {
  return {
    confidenceScore: convertedPriceSamplesMinor.length >= 3 ? 60 : 46,
    createdAt: new Date("2026-09-05T10:00:00.000Z"),
    id,
    metadata: {
      convertedPriceSamplesMinor,
      listingCount: convertedPriceSamplesMinor.length,
      offerCountUsed: convertedPriceSamplesMinor.length,
    },
    observedAt: new Date(observedAt),
    priceMinor,
    sealedProductId,
    source: "cardtrader-sealed",
    sourceRef: "20",
  };
}

function reference(sealedProductId, priceMinor, observedAt) {
  return {
    observedAt: new Date(observedAt),
    priceMinor,
    sealedProductId,
    source: "tcgcsv",
  };
}
