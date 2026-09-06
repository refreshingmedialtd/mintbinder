import assert from "node:assert/strict";
import test from "node:test";
import {
  brokenSealedImageQuarantineOptions,
  runBrokenSealedImageQuarantine,
  sealedImageQuarantineDisposition,
} from "../scripts/quarantine-broken-sealed-images.mjs";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

test("sealed image quarantine is dry-run and bounded by default", () => {
  assert.deepEqual(brokenSealedImageQuarantineOptions({ args: [] }), {
    apply: false,
    broad: false,
    concurrency: 2,
    ids: [],
    limit: 100,
    maxApply: 25,
    timeoutMs: 5_000,
  });
  assert.deepEqual(
    brokenSealedImageQuarantineOptions({
      args: [
        "--confirm",
        "--ids",
        `${firstId}, ${firstId},${secondId}`,
        "--limit=99999",
        "--max-apply=999",
        "--concurrency=99",
        "--timeout-ms=99999",
      ],
      env: {},
    }),
    {
      apply: true,
      broad: false,
      concurrency: 10,
      ids: [firstId, secondId],
      limit: 2_000,
      maxApply: 100,
      timeoutMs: 15_000,
    },
  );
});

test("confirmation refuses malformed options and requires an explicit scope", () => {
  assert.throws(
    () => brokenSealedImageQuarantineOptions({ args: ["--confirm"] }),
    /requires the deliberate --broad flag/,
  );
  assert.throws(
    () => brokenSealedImageQuarantineOptions({ args: ["--confirm", `--id=${firstId}`] }),
    /Unknown or duplicate/,
  );
  assert.throws(
    () => brokenSealedImageQuarantineOptions({ args: ["--confirm", "--ids="] }),
    /requires a non-empty value/,
  );
  assert.throws(
    () => brokenSealedImageQuarantineOptions({ args: ["--confirm", "--ids=not-a-uuid"] }),
    /comma-separated UUIDs/,
  );
  assert.equal(
    brokenSealedImageQuarantineOptions({ args: ["--confirm", "--broad"] }).broad,
    true,
  );
});

test("broad scans leave HTTP 400 and 403 for explicit review", () => {
  assert.equal(sealedImageQuarantineDisposition(400, false), "review_required");
  assert.equal(sealedImageQuarantineDisposition(403, false), "review_required");
  assert.equal(sealedImageQuarantineDisposition(404, false), "eligible");
  assert.equal(sealedImageQuarantineDisposition(410, false), "eligible");
  assert.equal(sealedImageQuarantineDisposition(403, true), "eligible");
  assert.equal(sealedImageQuarantineDisposition(429, true), "not_permanent");
  assert.equal(sealedImageQuarantineDisposition(503, true), "not_permanent");
});

test("dry-run reports a broad HTTP 403 without changing the catalogue", async () => {
  const fixture = quarantineFixture({
    candidates: [sealedProduct("bad", "bad.jpg")],
    statusByUrl: new Map([[imageUrl("bad.jpg"), 403]]),
  });
  const report = await runBrokenSealedImageQuarantine({
    fetchImpl: fixture.fetchImpl,
    now: "2026-09-07T10:00:00.000Z",
    options: defaultOptions({ apply: false }),
    prisma: fixture.prisma,
  });

  assert.equal(report.dryRun, true);
  assert.equal(report.permanentFailures, 1);
  assert.equal(report.reviewRequired, 1);
  assert.equal(report.wouldQuarantine, 0);
  assert.equal(report.sealedImagesQuarantined, 0);
  assert.equal(fixture.updates.length, 0);
  assert.equal(fixture.disconnected(), true);
});

test("probes the canonical provider image before deciding whether to quarantine it", async () => {
  const storedUrl = imageUrl("683003_200w.jpg");
  const canonicalUrl = imageUrl("683003_in_1000x1000.jpg");
  const fixture = quarantineFixture({
    candidates: [sealedProduct("bad", "683003_200w.jpg")],
    statusByUrl: new Map([
      [storedUrl, 403],
      [canonicalUrl, 200],
    ]),
  });
  const report = await runBrokenSealedImageQuarantine({
    fetchImpl: fixture.fetchImpl,
    options: defaultOptions({ ids: ["bad"] }),
    prisma: fixture.prisma,
  });

  assert.equal(report.permanentFailures, 0);
  assert.equal(report.wouldQuarantine, 0);
  assert.deepEqual(fixture.calls, [canonicalUrl]);
  assert.equal(fixture.updates.length, 0);
});

test("explicit confirmation re-probes, verifies a same-host control, and quarantines one HTTP 403", async () => {
  const bad = sealedProduct("bad", "bad.jpg");
  const fixture = quarantineFixture({
    candidates: [bad],
    controls: [sealedProduct("control", "good.jpg")],
    statusByUrl: new Map([
      [imageUrl("bad.jpg"), 403],
      [imageUrl("good.jpg"), 200],
    ]),
  });
  const report = await runBrokenSealedImageQuarantine({
    fetchImpl: fixture.fetchImpl,
    now: "2026-09-07T10:00:00.000Z",
    options: defaultOptions({ apply: true, ids: ["bad"] }),
    prisma: fixture.prisma,
  });

  assert.deepEqual(report.applyBlockedReasons, []);
  assert.equal(report.hostControls[0].success, true);
  assert.equal(report.sealedImagesQuarantined, 1);
  assert.equal(fixture.calls.filter((url) => url === imageUrl("bad.jpg")).length, 2);
  assert.equal(fixture.updates.length, 1);
  assert.deepEqual(fixture.updates[0].where, {
    id: "bad",
    imageUrl: imageUrl("bad.jpg"),
    updatedAt: bad.updatedAt,
  });
  assert.equal(fixture.updates[0].data.imageUrl, null);
  assert.deepEqual(fixture.updates[0].data.metadata.imageQuarantine, {
    checkedAt: "2026-09-07T10:00:00.000Z",
    reason: "permanent_http_status",
    source: "sealed_image_reachability_probe",
    status: 403,
    url: imageUrl("bad.jpg"),
  });
});

test("confirmation aborts when the affected provider host has no healthy control", async () => {
  const fixture = quarantineFixture({
    candidates: [sealedProduct("bad", "bad.jpg")],
    controls: [sealedProduct("control", "also-bad.jpg")],
    statusByUrl: new Map([
      [imageUrl("bad.jpg"), 403],
      [imageUrl("also-bad.jpg"), 403],
    ]),
  });
  const report = await runBrokenSealedImageQuarantine({
    fetchImpl: fixture.fetchImpl,
    options: defaultOptions({ apply: true, ids: ["bad"] }),
    prisma: fixture.prisma,
  });

  assert.match(report.applyBlockedReasons[0], /No successful same-host control image/);
  assert.equal(report.sealedImagesQuarantined, 0);
  assert.equal(fixture.updates.length, 0);
});

test("confirmation refuses to exceed the independent apply cap", async () => {
  const fixture = quarantineFixture({
    candidates: [sealedProduct("bad-1", "bad-1.jpg"), sealedProduct("bad-2", "bad-2.jpg")],
    controls: [sealedProduct("control", "good.jpg")],
    statusByUrl: new Map([
      [imageUrl("bad-1.jpg"), 403],
      [imageUrl("bad-2.jpg"), 403],
      [imageUrl("good.jpg"), 200],
    ]),
  });
  const report = await runBrokenSealedImageQuarantine({
    fetchImpl: fixture.fetchImpl,
    options: defaultOptions({
      apply: true,
      ids: ["bad-1", "bad-2"],
      maxApply: 1,
    }),
    prisma: fixture.prisma,
  });

  assert.match(report.applyBlockedReasons[0], /exceed the independent --max-apply cap/);
  assert.equal(report.sealedImagesQuarantined, 0);
  assert.equal(fixture.updates.length, 0);
});

test("the optimistic URL and timestamp guard reports a concurrent-change skip", async () => {
  const fixture = quarantineFixture({
    candidates: [sealedProduct("bad", "bad.jpg")],
    controls: [sealedProduct("control", "good.jpg")],
    statusByUrl: new Map([
      [imageUrl("bad.jpg"), 403],
      [imageUrl("good.jpg"), 200],
    ]),
    updateCount: 0,
  });
  const report = await runBrokenSealedImageQuarantine({
    fetchImpl: fixture.fetchImpl,
    options: defaultOptions({ apply: true, ids: ["bad"] }),
    prisma: fixture.prisma,
  });

  assert.equal(report.sealedImagesQuarantined, 0);
  assert.equal(report.quarantineRaceSkipped, 1);
  assert.equal(fixture.updates.length, 1);
});

test("broad confirmation aborts on an anomalously high permanent-failure ratio", async () => {
  const fixture = quarantineFixture({
    candidates: [
      sealedProduct("bad", "bad.jpg"),
      sealedProduct("good-1", "good-1.jpg"),
      sealedProduct("good-2", "good-2.jpg"),
    ],
    statusByUrl: new Map([
      [imageUrl("bad.jpg"), 404],
      [imageUrl("good-1.jpg"), 200],
      [imageUrl("good-2.jpg"), 200],
    ]),
  });
  const report = await runBrokenSealedImageQuarantine({
    fetchImpl: fixture.fetchImpl,
    options: defaultOptions({ apply: true, broad: true }),
    prisma: fixture.prisma,
  });

  assert.equal(report.hostControls[0].success, true);
  assert.match(report.applyBlockedReasons[0], /permanent-failure ratio exceeded 25%/);
  assert.equal(report.sealedImagesQuarantined, 0);
});

test("targeted transient provider failures are never quarantine candidates", async () => {
  for (const status of [429, 500, 503]) {
    const fixture = quarantineFixture({
      candidates: [sealedProduct("bad", "bad.jpg")],
      statusByUrl: new Map([[imageUrl("bad.jpg"), status]]),
    });
    const report = await runBrokenSealedImageQuarantine({
      fetchImpl: fixture.fetchImpl,
      options: defaultOptions({ apply: true, ids: ["bad"] }),
      prisma: fixture.prisma,
    });

    assert.equal(report.wouldQuarantine, 0);
    assert.equal(report.sealedImagesQuarantined, 0);
    assert.equal(fixture.updates.length, 0);
  }
});

function defaultOptions(overrides = {}) {
  return {
    apply: false,
    broad: false,
    concurrency: 2,
    ids: [],
    limit: 100,
    maxApply: 25,
    timeoutMs: 100,
    ...overrides,
  };
}

function imageUrl(file) {
  return `https://tcgplayer-cdn.tcgplayer.com/product/${file}`;
}

function quarantineFixture({ candidates, controls = [], statusByUrl, updateCount = 1 }) {
  const calls = [];
  const updates = [];
  let disconnected = false;
  let findManyCall = 0;
  const prisma = {
    $disconnect: async () => {
      disconnected = true;
    },
    sealedProduct: {
      findMany: async () => findManyCall++ === 0 ? candidates : controls,
      updateMany: async (request) => {
        updates.push(request);
        return { count: updateCount };
      },
    },
  };
  const fetchImpl = async (url) => {
    const value = String(url);
    const status = statusByUrl.get(value) ?? 500;

    calls.push(value);

    return {
      body: { cancel: async () => undefined },
      headers: { get: () => status === 200 ? "image/jpeg" : "text/html" },
      ok: status >= 200 && status < 300,
      status,
    };
  };

  return {
    calls,
    disconnected: () => disconnected,
    fetchImpl,
    prisma,
    updates,
  };
}

function sealedProduct(id, file) {
  return {
    id,
    imageUrl: imageUrl(file),
    metadata: { groupId: 2701 },
    name: `Product ${id}`,
    updatedAt: new Date("2026-09-07T09:00:00.000Z"),
  };
}
