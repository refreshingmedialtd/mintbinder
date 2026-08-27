import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const guardedRoutes = new Map([
  ["../src/app/api/billing/checkout/route.ts", 1],
  ["../src/app/api/billing/portal/route.ts", 1],
  ["../src/app/api/billing/subscription/route.ts", 1],
  ["../src/app/api/binders/route.ts", 1],
  ["../src/app/api/binders/[id]/route.ts", 2],
  ["../src/app/api/binders/[id]/layout/route.ts", 1],
  ["../src/app/api/collection-items/route.ts", 1],
  ["../src/app/api/collection-items/[id]/route.ts", 2],
  ["../src/app/api/collection-items/[id]/sale/route.ts", 1],
  ["../src/app/api/notification-preferences/route.ts", 1],
  ["../src/app/api/sealed-products/route.ts", 2],
  ["../src/app/api/set-goal/route.ts", 2],
  ["../src/app/api/set-goal/wishlist/route.ts", 1],
  ["../src/app/api/storage-locations/route.ts", 1],
  ["../src/app/api/storage-locations/[id]/route.ts", 2],
  ["../src/app/api/wishlist-items/route.ts", 3],
]);

test("the shared mutation guard verifies before consuming persistent throttle capacity", async () => {
  const source = await readFile(new URL("../src/lib/auth/mutation-guard.ts", import.meta.url), "utf8");
  assert.equal(
    source.indexOf("const verificationError = emailVerificationRequiredResponse")
      < source.indexOf("await consumeUserMutationAttempt"),
    true,
  );
  assert.match(source, /status: 429/);
  assert.match(source, /retry-after/);
});

test("every signed-in account-data write passes the shared verification and persistent throttle guard", async () => {
  for (const [relativePath, expectedCalls] of guardedRoutes) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.equal(
      (source.match(/accountMutationGuard\(\{/g) ?? []).length,
      expectedCalls,
      `${relativePath} must guard every write handler`,
    );
  }

  const limiter = await readFile(new URL("../src/lib/auth/rate-limit.ts", import.meta.url), "utf8");
  assert.match(limiter, /USER_MUTATION_LIMIT = 600/);
  assert.match(limiter, /IP_MUTATION_LIMIT = 3_000/);
  assert.match(limiter, /throttleHash\(action, "user", userId\)/);
  assert.match(limiter, /transaction\.\$executeRaw\(Prisma\.sql/);
  assert.doesNotMatch(limiter, /transaction\.\$queryRaw\(Prisma\.sql`\s*SELECT pg_advisory_xact_lock/);
});
