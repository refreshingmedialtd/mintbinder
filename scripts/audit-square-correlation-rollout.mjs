import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

export const SQUARE_CORRELATION_ROLLOUT_BLOCKING_STATUSES = Object.freeze([
  "creating",
  "recoverable",
  "ready",
  "retiring",
  "paid_pending_subscription",
]);
export const SQUARE_CORRELATION_KNOWN_STATUSES = Object.freeze([
  ...SQUARE_CORRELATION_ROLLOUT_BLOCKING_STATUSES,
  "completed",
  "failed",
  "retired",
  "retired_payment_free",
]);

export const DEFAULT_SQUARE_CORRELATION_AUDIT_SAMPLE_LIMIT = 25;
export const MAX_SQUARE_CORRELATION_AUDIT_SAMPLE_LIMIT = 100;

const CHECKOUT_PROVIDER_STATE_PRESENT = Object.freeze([
  { checkoutUrl: { not: null } },
  { providerCheckoutId: { not: null } },
  { providerOrderId: { not: null } },
  { providerPaymentId: { not: null } },
]);
const FAILED_PROVIDER_STATE_PRESENT = Object.freeze([
  ...CHECKOUT_PROVIDER_STATE_PRESENT,
  { providerCustomerId: { not: null } },
]);
const FAILED_PROVIDER_STATE_WHERE = Object.freeze({
  status: "failed",
  OR: FAILED_PROVIDER_STATE_PRESENT,
});
const RETIRED_PROVIDER_STATE_WHERE = Object.freeze({
  status: "retired",
  OR: CHECKOUT_PROVIDER_STATE_PRESENT,
});
const MALFORMED_COMPLETED_WHERE = Object.freeze({
  status: "completed",
  OR: [
    { checkoutUrl: { not: null } },
    { providerOrderId: null },
    { providerOrderId: "" },
    { providerPaymentId: null },
    { providerPaymentId: "" },
  ],
});
const MALFORMED_PAYMENT_FREE_WHERE = Object.freeze({
  status: "retired_payment_free",
  OR: [
    { checkoutUrl: { not: null } },
    { providerCheckoutId: { not: null } },
    { providerOrderId: null },
    { providerOrderId: "" },
    { providerPaymentId: { not: null } },
  ],
});
const UNKNOWN_STATUS_WHERE = Object.freeze({
  status: { notIn: [...SQUARE_CORRELATION_KNOWN_STATUSES] },
});

export function squareCorrelationRolloutBlockerWhere() {
  return {
    provider: "square",
    OR: [
      { status: { in: [...SQUARE_CORRELATION_ROLLOUT_BLOCKING_STATUSES] } },
      {
        status: FAILED_PROVIDER_STATE_WHERE.status,
        OR: FAILED_PROVIDER_STATE_WHERE.OR.map((condition) => ({ ...condition })),
      },
      {
        status: RETIRED_PROVIDER_STATE_WHERE.status,
        OR: RETIRED_PROVIDER_STATE_WHERE.OR.map((condition) => ({ ...condition })),
      },
      { ...MALFORMED_COMPLETED_WHERE, OR: [...MALFORMED_COMPLETED_WHERE.OR] },
      { ...MALFORMED_PAYMENT_FREE_WHERE, OR: [...MALFORMED_PAYMENT_FREE_WHERE.OR] },
      { status: { notIn: [...SQUARE_CORRELATION_KNOWN_STATUSES] } },
    ],
  };
}

export function squareCorrelationAuditOptions(args = process.argv.slice(2)) {
  let sampleLimit = DEFAULT_SQUARE_CORRELATION_AUDIT_SAMPLE_LIMIT;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    let value;

    if (argument === "--sample-limit") {
      value = args[index + 1];
      index += 1;
    } else if (argument.startsWith("--sample-limit=")) {
      value = argument.slice("--sample-limit=".length);
    } else {
      throw new Error(`Unknown Square rollout audit option: ${argument}`);
    }

    if (!/^\d+$/.test(String(value ?? ""))) {
      throw new Error("--sample-limit must be a positive integer.");
    }
    sampleLimit = Number(value);
  }

  if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1) {
    throw new Error("--sample-limit must be a positive integer.");
  }

  return {
    sampleLimit: Math.min(sampleLimit, MAX_SQUARE_CORRELATION_AUDIT_SAMPLE_LIMIT),
  };
}

export async function auditSquareCorrelationRollout({
  now = new Date(),
  prisma,
  sampleLimit = DEFAULT_SQUARE_CORRELATION_AUDIT_SAMPLE_LIMIT,
} = {}) {
  assertValidDate(now);
  const boundedSampleLimit = normalizeSampleLimit(sampleLimit);
  const client = prisma ?? new PrismaClient();
  const ownsClient = !prisma;
  const blockerWhere = squareCorrelationRolloutBlockerWhere();

  try {
    const [blockerCount, ...remainingResults] = await Promise.all([
      client.billingCheckoutIntent.count({ where: blockerWhere }),
      ...SQUARE_CORRELATION_ROLLOUT_BLOCKING_STATUSES.map((status) => (
        client.billingCheckoutIntent.count({ where: { provider: "square", status } })
      )),
      client.billingCheckoutIntent.count({
        where: {
          provider: "square",
          status: FAILED_PROVIDER_STATE_WHERE.status,
          OR: FAILED_PROVIDER_STATE_WHERE.OR,
        },
      }),
      client.billingCheckoutIntent.count({
        where: {
          provider: "square",
          status: RETIRED_PROVIDER_STATE_WHERE.status,
          OR: RETIRED_PROVIDER_STATE_WHERE.OR,
        },
      }),
      client.billingCheckoutIntent.count({
        where: { provider: "square", ...MALFORMED_COMPLETED_WHERE },
      }),
      client.billingCheckoutIntent.count({
        where: { provider: "square", ...MALFORMED_PAYMENT_FREE_WHERE },
      }),
      client.billingCheckoutIntent.count({
        where: { provider: "square", ...UNKNOWN_STATUS_WHERE },
      }),
      client.billingCheckoutIntent.findMany({
        where: blockerWhere,
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          checkoutUrl: true,
          providerCheckoutId: true,
          providerCustomerId: true,
          providerOrderId: true,
          providerPaymentId: true,
          status: true,
        },
        take: boundedSampleLimit + 1,
      }),
    ]);
    const rows = remainingResults.pop() ?? [];
    const unknownOrCorrupt = numberValue(remainingResults.pop());
    const malformedRetiredPaymentFree = numberValue(remainingResults.pop());
    const malformedCompleted = numberValue(remainingResults.pop());
    const retiredWithProviderState = numberValue(remainingResults.pop());
    const failedWithProviderState = numberValue(remainingResults.pop());
    const statusCounts = Object.fromEntries(
      SQUARE_CORRELATION_ROLLOUT_BLOCKING_STATUSES.map((status, index) => [
        status,
        numberValue(remainingResults[index]),
      ]),
    );
    const sampledRows = rows.slice(0, boundedSampleLimit);
    const exactBlockerCount = numberValue(blockerCount);
    const observedBlockerCount = Math.max(exactBlockerCount, sampledRows.length);

    return {
      blockerCount: observedBlockerCount,
      blockersByStatus: {
        ...statusCounts,
        malformed_completed: malformedCompleted,
        failed_with_provider_state: failedWithProviderState,
        malformed_retired_payment_free: malformedRetiredPaymentFree,
        retired_with_provider_state: retiredWithProviderState,
        unknown_or_corrupt: unknownOrCorrupt,
      },
      generatedAt: now.toISOString(),
      intentSamples: sampledRows.map(safeIntentSample),
      ok: observedBlockerCount === 0,
      readOnly: true,
      sampleLimit: boundedSampleLimit,
      samplesTruncated: rows.length > boundedSampleLimit || exactBlockerCount > boundedSampleLimit,
      scope: "square_checkout_correlation_signing_key_rollout",
    };
  } finally {
    if (ownsClient) await client.$disconnect();
  }
}

export async function runSquareCorrelationRolloutAuditCli({
  args = process.argv.slice(2),
  audit = auditSquareCorrelationRollout,
  writeError = (value) => console.error(value),
  writeOutput = (value) => console.log(value),
} = {}) {
  try {
    const report = await audit(squareCorrelationAuditOptions(args));
    writeOutput(JSON.stringify(report, null, 2));
    return report.ok === true ? 0 : 1;
  } catch {
    writeError(JSON.stringify({
      error: "Square correlation rollout audit could not complete.",
      ok: false,
      readOnly: true,
      scope: "square_checkout_correlation_signing_key_rollout",
    }, null, 2));
    return 1;
  }
}

function safeIntentSample(row) {
  const providerReferenceTypes = [];
  if (row.checkoutUrl !== null) providerReferenceTypes.push("checkout_url");
  if (row.providerCheckoutId !== null) providerReferenceTypes.push("checkout");
  if (row.providerCustomerId !== null) providerReferenceTypes.push("customer");
  if (row.providerOrderId !== null) providerReferenceTypes.push("order");
  if (row.providerPaymentId !== null) providerReferenceTypes.push("payment");

  return {
    intentId: String(row.id),
    providerReferenceTypes,
    status: String(row.status),
  };
}

function normalizeSampleLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Square rollout audit sampleLimit must be a positive integer.");
  }
  return Math.min(value, MAX_SQUARE_CORRELATION_AUDIT_SAMPLE_LIMIT);
}

function assertValidDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Square rollout audit timestamp is invalid.");
  }
}

function numberValue(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runSquareCorrelationRolloutAuditCli();
}
