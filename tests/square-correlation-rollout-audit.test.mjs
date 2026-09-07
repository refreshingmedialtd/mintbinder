import assert from "node:assert/strict";
import test from "node:test";
import {
  auditSquareCorrelationRollout,
  MAX_SQUARE_CORRELATION_AUDIT_SAMPLE_LIMIT,
  runSquareCorrelationRolloutAuditCli,
  SQUARE_CORRELATION_KNOWN_STATUSES,
  SQUARE_CORRELATION_ROLLOUT_BLOCKING_STATUSES,
  squareCorrelationAuditOptions,
  squareCorrelationRolloutBlockerWhere,
} from "../scripts/audit-square-correlation-rollout.mjs";

const NOW = new Date("2026-09-07T12:00:00.000Z");

test("audit passes only when no Square checkout can be retried or needs provider reconciliation", async () => {
  const prisma = checkoutAuditStore([
    intent({
      id: "completed-square",
      status: "completed",
      providerCheckoutId: "link-safe-completed",
      providerOrderId: "order-safe-completed",
      providerPaymentId: "payment-safe",
    }),
    intent({ id: "retired-square", status: "retired" }),
    intent({ id: "proved-payment-free", status: "retired_payment_free", providerOrderId: "order-safe" }),
    intent({ id: "reference-free-failure", status: "failed" }),
    intent({ id: "open-stripe", provider: "stripe", status: "ready" }),
  ]);

  const report = await auditSquareCorrelationRollout({ now: NOW, prisma });

  assert.equal(report.ok, true);
  assert.equal(report.blockerCount, 0);
  assert.deepEqual(report.intentSamples, []);
  assert.deepEqual(report.blockersByStatus, {
    creating: 0,
    recoverable: 0,
    ready: 0,
    retiring: 0,
    paid_pending_subscription: 0,
    malformed_completed: 0,
    failed_with_provider_state: 0,
    malformed_retired_payment_free: 0,
    retired_with_provider_state: 0,
    unknown_or_corrupt: 0,
  });
  assert.equal(prisma.calls.findMany, 1);
  assert.equal(prisma.calls.count, 11);
});

test("every retryable or unresolved Square status blocks signing-key introduction", async () => {
  const rows = SQUARE_CORRELATION_ROLLOUT_BLOCKING_STATUSES.map((status, index) => intent({
    id: `blocking-${index}`,
    status,
  }));
  const report = await auditSquareCorrelationRollout({ now: NOW, prisma: checkoutAuditStore(rows) });

  assert.equal(report.ok, false);
  assert.equal(report.blockerCount, SQUARE_CORRELATION_ROLLOUT_BLOCKING_STATUSES.length);
  assert.deepEqual(report.blockersByStatus, {
    creating: 1,
    recoverable: 1,
    ready: 1,
    retiring: 1,
    paid_pending_subscription: 1,
    malformed_completed: 0,
    failed_with_provider_state: 0,
    malformed_retired_payment_free: 0,
    retired_with_provider_state: 0,
    unknown_or_corrupt: 0,
  });
  assert.deepEqual(report.intentSamples.map((row) => row.intentId), rows.map((row) => row.id));
});

test("legacy retired references and unknown Square statuses remain rollout blockers", async () => {
  const rows = [
    intent({ id: "retired-link", status: "retired", providerCheckoutId: "link-secret" }),
    intent({ id: "retired-order", status: "retired", providerOrderId: "order-secret" }),
    intent({ id: "retired-payment", status: "retired", providerPaymentId: "payment-secret" }),
    intent({ id: "corrupt-status", status: "mystery_state" }),
  ];
  const report = await auditSquareCorrelationRollout({ now: NOW, prisma: checkoutAuditStore(rows) });

  assert.equal(report.ok, false);
  assert.equal(report.blockerCount, 4);
  assert.equal(report.blockersByStatus.retired_with_provider_state, 3);
  assert.equal(report.blockersByStatus.unknown_or_corrupt, 1);
  assert.deepEqual(report.intentSamples.map(({ intentId, status }) => ({ intentId, status })), [
    { intentId: "retired-link", status: "retired" },
    { intentId: "retired-order", status: "retired" },
    { intentId: "retired-payment", status: "retired" },
    { intentId: "corrupt-status", status: "mystery_state" },
  ]);
  assert.doesNotMatch(
    JSON.stringify(report),
    /customer-secret|link-secret|order-secret|payment-secret|user@example\.com/,
  );
});

test("failed Square rows block when any provider reference remains", async () => {
  const rows = [
    intent({ id: "failed-link", status: "failed", providerCheckoutId: "link-secret" }),
    intent({ id: "failed-customer", status: "failed", providerCustomerId: "customer-secret" }),
    intent({ id: "failed-order", status: "failed", providerOrderId: "order-secret" }),
    intent({ id: "failed-payment", status: "failed", providerPaymentId: "payment-secret" }),
    intent({ id: "failed-empty", status: "failed" }),
  ];
  const report = await auditSquareCorrelationRollout({ now: NOW, prisma: checkoutAuditStore(rows) });

  assert.equal(report.ok, false);
  assert.equal(report.blockerCount, 4);
  assert.equal(report.blockersByStatus.failed_with_provider_state, 4);
  assert.deepEqual(report.intentSamples, [
    { intentId: "failed-link", providerReferenceTypes: ["checkout"], status: "failed" },
    { intentId: "failed-customer", providerReferenceTypes: ["customer"], status: "failed" },
    { intentId: "failed-order", providerReferenceTypes: ["order"], status: "failed" },
    { intentId: "failed-payment", providerReferenceTypes: ["payment"], status: "failed" },
  ]);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /user@example\.com|customer-secret|link-secret|order-secret|payment-secret/);
});

test("URL-only legacy rows and malformed terminal shapes fail closed", async () => {
  const rows = [
    intent({ id: "failed-url", checkoutUrl: "https://checkout.example/failed", status: "failed" }),
    intent({ id: "retired-url", checkoutUrl: "https://checkout.example/retired", status: "retired" }),
    intent({ id: "completed-no-payment", status: "completed" }),
    intent({ id: "completed-empty-payment", providerPaymentId: "", status: "completed" }),
    intent({ id: "completed-no-order", providerPaymentId: "payment-hidden-completed", status: "completed" }),
    intent({
      id: "completed-empty-order",
      providerOrderId: "",
      providerPaymentId: "payment-hidden-empty-order",
      status: "completed",
    }),
    intent({
      id: "completed-live-url",
      checkoutUrl: "https://checkout.example/completed",
      providerOrderId: "order-hidden-completed",
      providerPaymentId: "payment-hidden-completed-2",
      status: "completed",
    }),
    intent({ id: "payment-free-no-order", status: "retired_payment_free" }),
    intent({
      id: "payment-free-with-checkout",
      providerCheckoutId: "checkout-hidden-payment-free",
      providerOrderId: "order-hidden-checkout",
      status: "retired_payment_free",
    }),
    intent({
      id: "payment-free-with-payment",
      providerOrderId: "order-hidden",
      providerPaymentId: "payment-hidden",
      status: "retired_payment_free",
    }),
    intent({
      id: "payment-free-live-url",
      checkoutUrl: "https://checkout.example/still-live",
      providerOrderId: "order-hidden-2",
      status: "retired_payment_free",
    }),
  ];
  const report = await auditSquareCorrelationRollout({ now: NOW, prisma: checkoutAuditStore(rows) });

  assert.equal(report.ok, false);
  assert.equal(report.blockerCount, rows.length);
  assert.equal(report.blockersByStatus.failed_with_provider_state, 1);
  assert.equal(report.blockersByStatus.retired_with_provider_state, 1);
  assert.equal(report.blockersByStatus.malformed_completed, 5);
  assert.equal(report.blockersByStatus.malformed_retired_payment_free, 4);
  assert.doesNotMatch(
    JSON.stringify(report),
    /checkout\.example|order-hidden|payment-hidden/,
  );
});

test("audit output remains bounded while reporting the exact blocker count", async () => {
  const rows = Array.from({ length: 125 }, (_, index) => intent({
    id: `ready-${index.toString().padStart(3, "0")}`,
    status: "ready",
  }));
  const prisma = checkoutAuditStore(rows);
  const report = await auditSquareCorrelationRollout({
    now: NOW,
    prisma,
    sampleLimit: 10_000,
  });

  assert.equal(report.ok, false);
  assert.equal(report.blockerCount, 125);
  assert.equal(report.sampleLimit, MAX_SQUARE_CORRELATION_AUDIT_SAMPLE_LIMIT);
  assert.equal(report.intentSamples.length, MAX_SQUARE_CORRELATION_AUDIT_SAMPLE_LIMIT);
  assert.equal(report.samplesTruncated, true);
  assert.equal(prisma.calls.take, MAX_SQUARE_CORRELATION_AUDIT_SAMPLE_LIMIT + 1);
});

test("audit CLI options reject unknown or unsafe values and cap samples", () => {
  assert.deepEqual(squareCorrelationAuditOptions([]), { sampleLimit: 25 });
  assert.deepEqual(squareCorrelationAuditOptions(["--sample-limit=7"]), { sampleLimit: 7 });
  assert.deepEqual(squareCorrelationAuditOptions(["--sample-limit", "500"]), { sampleLimit: 100 });
  assert.throws(() => squareCorrelationAuditOptions(["--sample-limit=0"]), /positive integer/);
  assert.throws(() => squareCorrelationAuditOptions(["--other"]), /Unknown/);
});

test("audit CLI returns nonzero for blockers or errors and emits only structured safe output", async () => {
  const output = [];
  const errors = [];
  const blockedExit = await runSquareCorrelationRolloutAuditCli({
    args: ["--sample-limit=3"],
    audit: async ({ sampleLimit }) => ({
      blockerCount: 1,
      intentSamples: [{ intentId: "safe-row-id", status: "ready" }],
      ok: false,
      sampleLimit,
    }),
    writeError: (value) => errors.push(value),
    writeOutput: (value) => output.push(value),
  });

  assert.equal(blockedExit, 1);
  assert.equal(JSON.parse(output[0]).sampleLimit, 3);
  assert.deepEqual(errors, []);

  const failedExit = await runSquareCorrelationRolloutAuditCli({
    audit: async () => { throw new Error("database-url-secret"); },
    writeError: (value) => errors.push(value),
    writeOutput: (value) => output.push(value),
  });
  assert.equal(failedExit, 1);
  assert.doesNotMatch(errors.at(-1), /database-url-secret/);

  const passedExit = await runSquareCorrelationRolloutAuditCli({
    audit: async () => ({ blockerCount: 0, intentSamples: [], ok: true }),
    writeError: (value) => errors.push(value),
    writeOutput: (value) => output.push(value),
  });
  assert.equal(passedExit, 0);
});

test("rollout blocker query is limited to Square and enumerates the fail-closed statuses", () => {
  assert.deepEqual(squareCorrelationRolloutBlockerWhere(), {
    provider: "square",
    OR: [
      { status: { in: [...SQUARE_CORRELATION_ROLLOUT_BLOCKING_STATUSES] } },
      {
        status: "failed",
        OR: [
          { checkoutUrl: { not: null } },
          { providerCheckoutId: { not: null } },
          { providerOrderId: { not: null } },
          { providerPaymentId: { not: null } },
          { providerCustomerId: { not: null } },
        ],
      },
      {
        status: "retired",
        OR: [
          { checkoutUrl: { not: null } },
          { providerCheckoutId: { not: null } },
          { providerOrderId: { not: null } },
          { providerPaymentId: { not: null } },
        ],
      },
      {
        status: "completed",
        OR: [
          { checkoutUrl: { not: null } },
          { providerOrderId: null },
          { providerOrderId: "" },
          { providerPaymentId: null },
          { providerPaymentId: "" },
        ],
      },
      {
        status: "retired_payment_free",
        OR: [
          { checkoutUrl: { not: null } },
          { providerCheckoutId: { not: null } },
          { providerOrderId: null },
          { providerOrderId: "" },
          { providerPaymentId: { not: null } },
        ],
      },
      { status: { notIn: [...SQUARE_CORRELATION_KNOWN_STATUSES] } },
    ],
  });
});

function intent(overrides = {}) {
  return {
    checkoutUrl: null,
    id: "intent-1",
    provider: "square",
    providerCheckoutId: null,
    providerCustomerId: null,
    providerOrderId: null,
    providerPaymentId: null,
    status: "completed",
    updatedAt: NOW,
    userEmail: "user@example.com",
    ...overrides,
  };
}

function checkoutAuditStore(rows) {
  const calls = { count: 0, findMany: 0, take: null };
  return {
    calls,
    billingCheckoutIntent: {
      async count({ where }) {
        calls.count += 1;
        return rows.filter((row) => matchesWhere(row, where)).length;
      },
      async findMany({ orderBy, take, where }) {
        calls.findMany += 1;
        calls.take = take;
        assert.deepEqual(orderBy, [{ updatedAt: "asc" }, { id: "asc" }]);
        return rows.filter((row) => matchesWhere(row, where)).slice(0, take);
      },
    },
  };
}

function matchesWhere(row, where) {
  return Object.entries(where).every(([field, expected]) => {
    if (field === "OR") return expected.some((condition) => matchesWhere(row, condition));
    if (expected && typeof expected === "object" && "in" in expected) {
      return expected.in.includes(row[field]);
    }
    if (expected && typeof expected === "object" && "notIn" in expected) {
      return !expected.notIn.includes(row[field]);
    }
    if (expected && typeof expected === "object" && "not" in expected) {
      return row[field] !== expected.not;
    }
    return row[field] === expected;
  });
}
