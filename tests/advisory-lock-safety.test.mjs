import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const lockSources = [
  "../src/lib/auth/rate-limit.ts",
  "../src/lib/billing/checkout-lock.ts",
  "../src/lib/db/user-quotas.ts",
  "../src/lib/jobs/runs.ts",
];

test("PostgreSQL void advisory locks use Prisma's non-decoding execution API", async () => {
  for (const relativePath of lockSources) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    const lockCalls = source.match(/pg_advisory_xact_lock/g) ?? [];
    const executeCalls = source.match(/\$executeRaw(?:\(|`)/g) ?? [];

    assert.ok(lockCalls.length > 0, `${relativePath} must acquire an advisory lock`);
    assert.ok(
      executeCalls.length >= lockCalls.length,
      `${relativePath} must execute every void-returning advisory lock without row decoding`,
    );
    assert.doesNotMatch(
      source,
      /\$queryRaw(?:<[^>]+>)?(?:\(|`)[\s\S]{0,180}?pg_advisory_xact_lock/,
      `${relativePath} must not deserialize PostgreSQL's unsupported void lock result`,
    );
  }
});
