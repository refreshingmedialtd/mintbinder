import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  operationalRetentionOptions,
  runOperationalDataRetention,
} from "../scripts/operational-data-retention.mjs";

const NOW = new Date("2026-08-24T12:00:00.000Z");

test("privacy copy matches checkout-attempt retention defaults and floor", () => {
  const privacyCopy = readFileSync("src/app/legal/privacy/page.tsx", "utf8");
  assert.match(privacyCopy, /terminal checkout-attempt records 730 days/);
  assert.match(privacyCopy, /configurable 90-day floor/);
});

test("operational retention is dry-run by default with conservative safety floors", () => {
  assert.deepEqual(operationalRetentionOptions({ args: [], env: {} }), {
    accountTokenDays: 30,
    allowDelete: false,
    authThrottleDays: 30,
    batchSize: 1_000,
    billingCheckoutIntentDays: 730,
    billingWebhookDays: 730,
    confirm: false,
    jobRunDays: 365,
    notificationDeliveryDays: 365,
    passwordResetOutboxDays: 365,
    scheduled: false,
  });
  assert.deepEqual(operationalRetentionOptions({
    args: [
      "--account-token-days=0",
      "--auth-throttle-days", "1",
      "--billing-checkout-intent-days=0",
      "--billing-webhook-days=10",
      "--job-run-days=2",
      "--notification-delivery-days=2",
      "--password-reset-outbox-days=2",
      "--batch=50000",
      "--confirm",
    ],
    env: { OPERATIONAL_RETENTION_ALLOW_DELETE: "true" },
  }), {
    accountTokenDays: 30,
    allowDelete: true,
    authThrottleDays: 1,
    batchSize: 10_000,
    billingCheckoutIntentDays: 730,
    billingWebhookDays: 90,
    confirm: true,
    jobRunDays: 30,
    notificationDeliveryDays: 30,
    passwordResetOutboxDays: 30,
    scheduled: false,
  });
  assert.equal(operationalRetentionOptions({
    args: ["--scheduled"],
    env: { OPERATIONAL_RETENTION_CRON_CONFIRM: "true" },
  }).confirm, true);
  assert.equal(operationalRetentionOptions({
    args: ["--billing-checkout-intent-days=90", "--billing-webhook-days=365"],
    env: {},
  }).billingCheckoutIntentDays, 365);
  assert.deepEqual(
    operationalRetentionOptions({ args: ["--scheduled"], env: {} }),
    {
      accountTokenDays: 30,
      allowDelete: false,
      authThrottleDays: 30,
      batchSize: 1_000,
      billingCheckoutIntentDays: 730,
      billingWebhookDays: 730,
      confirm: false,
      jobRunDays: 365,
      notificationDeliveryDays: 365,
      passwordResetOutboxDays: 365,
      scheduled: true,
    },
  );
});

test("dry-run reports auditable counts without selecting or deleting rows", async () => {
  const prisma = prismaDouble({
    counts: {
      accountToken: 2,
      authThrottle: 3,
      billingCheckoutIntent: 1,
      billingWebhookEvent: 4,
      jobRun: 5,
      notificationDelivery: 6,
      passwordResetOutbox: 7,
    },
  });
  const report = await runOperationalDataRetention({
    now: NOW,
    prisma,
    runId: "retention-run-1",
    options: operationalRetentionOptions({ args: [], env: {} }),
  });

  assert.equal(report.runId, "retention-run-1");
  assert.equal(report.dryRun, true);
  assert.equal(report.candidateTotal, 28);
  assert.equal(report.deletedTotal, 0);
  assert.equal(report.datasets.accountTokens.cutoff, "2026-07-25T12:00:00.000Z");
  assert.equal(report.datasets.billingWebhookEvents.cutoff, "2024-08-24T12:00:00.000Z");
  assert.equal(prisma.calls.findMany.length, 0);
  assert.equal(prisma.calls.deleteMany.length, 0);

  const authWhere = prisma.calls.count.find((call) => call.delegate === "authThrottle").args.where;
  assert.deepEqual(authWhere.OR, [
    { blockedUntil: null },
    { blockedUntil: { lt: NOW } },
  ]);
  const jobWhere = prisma.calls.count.find((call) => call.delegate === "jobRun").args.where;
  assert.deepEqual(jobWhere.status.in, ["SUCCEEDED", "FAILED"]);
  assert.equal(jobWhere.status.in.includes("RUNNING"), false);
  const deliveryWhere = prisma.calls.count.find((call) => call.delegate === "notificationDelivery").args.where;
  assert.equal(deliveryWhere.status, "SENT");
  assert.equal(JSON.stringify(deliveryWhere).includes("AMBIGUOUS"), false);
  assert.equal(JSON.stringify(deliveryWhere).includes("CLAIMED"), false);
  const resetWhere = prisma.calls.count.find((call) => call.delegate === "passwordResetOutbox").args.where;
  assert.deepEqual(resetWhere.status.in, ["SENT", "DISCARDED"]);
  assert.equal(JSON.stringify(resetWhere).includes("QUEUED"), false);
  assert.equal(JSON.stringify(resetWhere).includes("CLAIMED"), false);
  assert.equal(JSON.stringify(resetWhere).includes("UNRESOLVED"), false);
  const billingWhere = prisma.calls.count.find((call) => call.delegate === "billingWebhookEvent").args.where;
  assert.deepEqual(billingWhere.status.in, ["SUCCEEDED", "FAILED"]);
  assert.equal(billingWhere.status.in.includes("PROCESSING"), false);
  const checkoutWhere = prisma.calls.count.find((call) => call.delegate === "billingCheckoutIntent").args.where;
  assert.deepEqual(checkoutWhere.status.in, ["completed", "failed", "retired"]);
  assert.equal(checkoutWhere.status.in.includes("ready"), false);
  assert.equal(checkoutWhere.status.in.includes("recoverable"), false);
});

test("confirmed retention still refuses deletion without the environment opt-in", async () => {
  const prisma = prismaDouble({ counts: { accountToken: 1 } });
  const options = operationalRetentionOptions({ args: ["--confirm"], env: {} });

  await assert.rejects(
    runOperationalDataRetention({ now: NOW, options, prisma, runId: "retention-run-2" }),
    /OPERATIONAL_RETENTION_ALLOW_DELETE=true/,
  );
  assert.equal(prisma.calls.findMany.length, 0);
  assert.equal(prisma.calls.deleteMany.length, 0);
});

test("confirmed retention deletes only bounded selected candidates and reports actual counts", async () => {
  const prisma = prismaDouble({
    counts: {
      accountToken: 3,
      authThrottle: 1,
      billingCheckoutIntent: 1,
      billingWebhookEvent: 0,
      jobRun: 2,
      notificationDelivery: 1,
      passwordResetOutbox: 1,
    },
    rows: {
      accountToken: [{ id: "token-1" }, { id: "token-2" }],
      authThrottle: [{ keyHash: "throttle-1" }],
      billingCheckoutIntent: [{ id: "checkout-1" }],
      billingWebhookEvent: [],
      jobRun: [{ id: "job-1" }, { id: "job-2" }],
      notificationDelivery: [{ id: "delivery-1" }],
      passwordResetOutbox: [{ id: "reset-1" }],
    },
    deleted: {
      accountToken: 2,
      authThrottle: 1,
      billingCheckoutIntent: 1,
      jobRun: 2,
      notificationDelivery: 1,
      passwordResetOutbox: 1,
    },
  });
  const options = operationalRetentionOptions({
    args: ["--batch=2", "--confirm"],
    env: { OPERATIONAL_RETENTION_ALLOW_DELETE: "true" },
  });
  const report = await runOperationalDataRetention({
    now: NOW,
    options,
    prisma,
    runId: "retention-run-3",
  });

  assert.equal(report.dryRun, false);
  assert.equal(report.deletedTotal, 8);
  assert.equal(report.datasets.billingCheckoutIntents.deleted, 1);
  assert.equal(report.datasets.accountTokens.remainingEstimate, 1);
  assert.equal(report.datasets.billingWebhookEvents.deleted, 0);
  assert.equal(JSON.stringify(report).includes("token-1"), false);
  assert.equal(prisma.calls.transaction, 1);
  assert.equal(prisma.calls.findMany.every((call) => call.args.take === 2), true);

  const accountDelete = prisma.calls.deleteMany.find((call) => call.delegate === "accountToken");
  assert.deepEqual(accountDelete.args.where.AND[1], { id: { in: ["token-1", "token-2"] } });
  const accountSelection = prisma.calls.findMany.find((call) => call.delegate === "accountToken");
  assert.deepEqual(accountSelection.args.orderBy[0], { expiresAt: "asc" });
  const throttleDelete = prisma.calls.deleteMany.find((call) => call.delegate === "authThrottle");
  assert.deepEqual(throttleDelete.args.where.AND[1], { keyHash: { in: ["throttle-1"] } });
});

function prismaDouble({ counts = {}, rows = {}, deleted = {} } = {}) {
  const calls = {
    count: [],
    deleteMany: [],
    findMany: [],
    transaction: 0,
  };
  const prisma = {
    calls,
    async $transaction(operations) {
      calls.transaction += 1;
      return Promise.all(operations);
    },
  };

  for (const delegate of ["accountToken", "authThrottle", "billingCheckoutIntent", "billingWebhookEvent", "notificationDelivery", "passwordResetOutbox", "jobRun"]) {
    prisma[delegate] = {
      async count(args) {
        calls.count.push({ delegate, args });
        return counts[delegate] ?? 0;
      },
      async findMany(args) {
        calls.findMany.push({ delegate, args });
        return rows[delegate] ?? [];
      },
      async deleteMany(args) {
        calls.deleteMany.push({ delegate, args });
        return { count: deleted[delegate] ?? 0 };
      },
    };
  }

  return prisma;
}
