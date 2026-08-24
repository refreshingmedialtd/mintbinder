import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { priceSnapshotRetentionOptions } from "../scripts/price-snapshot-retention.mjs";

test("price snapshot retention is dry-run first with a 90-day safety floor", () => {
  assert.deepEqual(priceSnapshotRetentionOptions({ args: [], env: {} }), {
    allowDelete: false,
    batchSize: 5_000,
    confirm: false,
    retentionDays: 365,
  });
  assert.deepEqual(priceSnapshotRetentionOptions({
    args: ["--days=30", "--batch", "50000", "--confirm"],
    env: { PRICE_SNAPSHOT_RETENTION_ALLOW_DELETE: "true" },
  }), {
    allowDelete: true,
    batchSize: 25_000,
    confirm: true,
    retentionDays: 90,
  });
});

test("weekly retention partitions every currency stream independently", async () => {
  const source = await readFile(
    new URL("../scripts/price-snapshot-retention.mjs", import.meta.url),
    "utf8",
  );
  const partitions = [...source.matchAll(/PARTITION BY([\s\S]*?)ORDER BY observed_at/g)];

  assert.equal(partitions.length, 2);
  assert.equal(partitions.every((match) => /COALESCE\(currency, ''\)/.test(match[1])), true);
});
