import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertUserResourceQuota,
  USER_RESOURCE_LIMITS,
  UserQuotaExceededError,
} from "../src/lib/db/user-quotas.ts";

test("resource quotas allow the last slot and reject any additional create", () => {
  for (const [resource, limit] of Object.entries(USER_RESOURCE_LIMITS)) {
    assert.doesNotThrow(() => assertUserResourceQuota(limit - 1, resource));
    assert.throws(
      () => assertUserResourceQuota(limit, resource),
      UserQuotaExceededError,
    );
  }
});

test("growth paths serialize quota count and create with transaction advisory locks", async () => {
  const [appData, binders, quotaLocks] = await Promise.all([
    readFile(new URL("../src/lib/db/app-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/db/binders.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/db/user-quotas.ts", import.meta.url), "utf8"),
  ]);

  for (const resource of ["collectionLots", "manualSealedProducts"]) {
    const lockAt = appData.indexOf(`lockUserResourceQuota(transaction, userId, "${resource}")`);
    const assertAt = appData.indexOf(`assertUserResourceQuota`, lockAt);
    const createAt = appData.indexOf("transaction.", assertAt);
    assert.ok(lockAt >= 0 && lockAt < assertAt && assertAt < createAt);
  }
  const binderLock = binders.indexOf('lockUserResourceQuota(transaction, userId, "binders")');
  const binderCount = binders.indexOf("transaction.binder.count", binderLock);
  const binderCreate = binders.indexOf("transaction.binder.create", binderCount);
  assert.ok(binderLock >= 0 && binderLock < binderCount && binderCount < binderCreate);

  // PostgreSQL advisory lock functions return `void`. Prisma cannot decode
  // that type through `$queryRaw` (P2010), so lock-only statements must use
  // the non-decoding execution API.
  assert.match(quotaLocks, /transaction\.\$executeRaw/);
  assert.doesNotMatch(quotaLocks, /transaction\.\$queryRaw/);
});
