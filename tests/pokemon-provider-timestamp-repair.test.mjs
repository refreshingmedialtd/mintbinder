import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  pokemonProviderTimestampRepairOptions,
  runPokemonProviderTimestampRepair,
} from "../scripts/repair-pokemon-provider-timestamps.mjs";

test("provider timestamp repair is dry-run by default with bounded options", () => {
  assert.deepEqual(pokemonProviderTimestampRepairOptions({ args: [] }), {
    afterId: null,
    apply: false,
    batchSize: 5_000,
    maxBatches: 1_000,
  });
  assert.deepEqual(pokemonProviderTimestampRepairOptions({
    args: ["--apply", "--batch=999999", "--max-batches", "999999"],
  }), {
    afterId: null,
    apply: true,
    batchSize: 10_000,
    maxBatches: 1_000,
  });
  assert.throws(
    () => pokemonProviderTimestampRepairOptions({ args: ["--after-id=not-a-uuid"] }),
    /Invalid UUID cursor/,
  );
});

test("dry-run reports candidate counts and date ranges without updating", async () => {
  let calls = 0;
  const prisma = {
    async $disconnect() {},
    async $queryRawUnsafe(sql) {
      calls += 1;
      assert.match(sql, /GROUP BY source/);
      assert.doesNotMatch(sql, /UPDATE price_snapshots/);
      return [{
        candidateCount: 12,
        newestCorrectedObservedAt: new Date("2026-08-31T00:00:00.000Z"),
        newestOriginalObservedAt: new Date("2026-09-04T00:00:00.000Z"),
        oldestCorrectedObservedAt: new Date("2025-11-03T00:00:00.000Z"),
        oldestOriginalObservedAt: new Date("2026-08-20T00:00:00.000Z"),
        source: "pokemon-tcg-api-cardmarket",
      }];
    },
  };

  const report = await runPokemonProviderTimestampRepair({
    options: { afterId: null, apply: false, batchSize: 100, maxBatches: 10 },
    prisma,
  });

  assert.equal(calls, 1);
  assert.equal(report.dryRun, true);
  assert.equal(report.candidateCount, 12);
  assert.equal(report.timestampsRepaired, 0);
  assert.equal(report.sources[0].oldestCorrectedObservedAt, "2025-11-03T00:00:00.000Z");
  assert.match(report.nextCommand, /--apply/);
});

test("apply mode advances its UUID cursor even across pages with no repairs", async () => {
  let calls = 0;
  const cursors = [
    "00000000-0000-0000-0000-000000000002",
    "00000000-0000-0000-0000-000000000004",
    "00000000-0000-0000-0000-000000000005",
  ];
  const prisma = {
    async $disconnect() {},
    async $queryRawUnsafe(sql, cursor, batchSize) {
      calls += 1;

      if (calls === 1) {
        return [{
          candidateCount: 3,
          newestCorrectedObservedAt: new Date("2026-08-31T00:00:00.000Z"),
          newestOriginalObservedAt: new Date("2026-09-04T00:00:00.000Z"),
          oldestCorrectedObservedAt: new Date("2025-11-03T00:00:00.000Z"),
          oldestOriginalObservedAt: new Date("2026-08-20T00:00:00.000Z"),
          source: "pokemon-tcg-api-cardmarket",
        }];
      }

      const page = calls - 2;

      assert.equal(cursor, page === 0 ? null : cursors[page - 1]);
      assert.equal(batchSize, 2);
      assert.match(sql, /id > \$1::uuid/);
      assert.match(sql, /ORDER BY id/);
      assert.match(sql, /LIMIT \$2/);
      assert.match(sql, /snapshot\.observed_at > candidates\.provider_observed_at/);

      if (page === 0) {
        return [{ nextCursor: cursors[0], repairedCount: 0, scannedCount: 2, source: null }];
      }

      return page === 1
        ? [{ nextCursor: cursors[1], repairedCount: 2, scannedCount: 2, source: "pokemon-tcg-api-cardmarket" }]
        : [{ nextCursor: cursors[2], repairedCount: 1, scannedCount: 1, source: "pokemon-tcg-api-cardmarket" }];
    },
  };

  const report = await runPokemonProviderTimestampRepair({
    options: { afterId: null, apply: true, batchSize: 2, maxBatches: 10 },
    prisma,
  });

  assert.equal(calls, 4);
  assert.equal(report.dryRun, false);
  assert.equal(report.batchesRun, 3);
  assert.equal(report.rowsScanned, 5);
  assert.equal(report.timestampsRepaired, 3);
  assert.equal(report.remainingEstimate, 0);
  assert.equal(report.lastCursor, cursors[2]);
  assert.deepEqual(report.repairedBySource, { "pokemon-tcg-api-cardmarket": 3 });
});

test("apply mode resumes after an explicit committed UUID cursor", async () => {
  const afterId = "00000000-0000-0000-0000-000000000010";
  const nextId = "00000000-0000-0000-0000-000000000011";
  let calls = 0;
  const prisma = {
    async $disconnect() {},
    async $queryRawUnsafe(sql, cursor, batchSize) {
      calls += 1;

      if (calls === 1) {
        return [{ candidateCount: 1, source: "pokemon-tcg-api" }];
      }

      assert.equal(cursor, afterId);
      assert.equal(batchSize, 5_000);
      return [{
        nextCursor: nextId,
        repairedCount: 1,
        scannedCount: 1,
        source: "pokemon-tcg-api",
      }];
    },
  };

  const report = await runPokemonProviderTimestampRepair({
    options: { afterId, apply: true, batchSize: 5_000, maxBatches: 10 },
    prisma,
  });

  assert.equal(report.startAfterId, afterId);
  assert.equal(report.lastCursor, nextId);
  assert.equal(report.timestampsRepaired, 1);
});

test("repair SQL is restricted to exact Pokemon API sources and safe provider dates", async () => {
  const source = await readFile(
    new URL("../scripts/repair-pokemon-provider-timestamps.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /source IN \('pokemon-tcg-api', 'pokemon-tcg-api-cardmarket'\)/);
  assert.match(source, /provider_observed_at >= TIMESTAMP '2000-01-01 00:00:00'/);
  assert.match(source, /provider_observed_at <= created_at/);
  assert.match(source, /provider_observed_at < observed_at/);
  assert.match(source, /\(\$1::uuid IS NULL OR id > \$1::uuid\)/);
  assert.match(source, /ORDER BY id[\s\S]+?LIMIT \$2/);
  assert.match(source, /to_char\(to_date\([\s\S]+?\) = metadata->>'providerUpdatedAt'/);
  assert.equal((source.match(/UPDATE price_snapshots/g) ?? []).length, 1);
  assert.doesNotMatch(source, /source IN \([^)]*tcgcsv/);
});
