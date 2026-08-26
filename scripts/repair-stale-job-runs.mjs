import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { boundedJobDurationMs } from "./job-run-repair-utils.mjs";

const defaultStaleMinutes = 45;
const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const confirmed = args.has("--confirm");
const staleMinutes = positiveInteger(argValue("--minutes"), defaultStaleMinutes);
const limit = positiveInteger(argValue("--limit"), 100);
const now = new Date();
const staleBefore = new Date(now.getTime() - staleMinutes * 60 * 1000);

try {
  const staleRuns = await prisma.$queryRaw`
    SELECT
      duration_ms AS "durationMs",
      error_message AS "errorMessage",
      id,
      job_type AS "jobType",
      request_payload AS "requestPayload",
      result_payload AS "resultPayload",
      started_at AS "startedAt",
      status
    FROM job_runs
    WHERE status = 'running'::job_run_status
      AND finished_at IS NULL
      AND COALESCE(
        CASE
          WHEN result_payload->>'heartbeatEpochMs' ~ '^[0-9]+$'
            THEN TO_TIMESTAMP((result_payload->>'heartbeatEpochMs')::double precision / 1000)
          ELSE NULL
        END,
        started_at
      ) <= ${staleBefore}
    ORDER BY started_at ASC
    LIMIT ${limit}
  `;

  if (!confirmed) {
    console.log(JSON.stringify({
      dryRun: true,
      matched: staleRuns.length,
      nextCommand: "npm run ops:repair-stale-jobs -- --confirm",
      staleBefore: staleBefore.toISOString(),
      staleMinutes,
      runs: staleRuns.map(summaryRow),
    }, null, 2));
    process.exit(0);
  }

  const repaired = [];

  for (const run of staleRuns) {
    const duration = boundedJobDurationMs(run.startedAt, now);
    const errorMessage = `Marked failed by stale job repair after ${Math.round(duration.actualDurationMs / 60000)} minutes without a finish timestamp.`;
    const resultPayload = {
      ...(isObject(run.resultPayload) ? run.resultPayload : {}),
      actualDurationMs: duration.actualDurationMs,
      durationWasCapped: duration.durationWasCapped,
      repairedAt: now.toISOString(),
      repairReason: "stale_running_job",
    };
    const resultPayloadJson = JSON.stringify(resultPayload);
    const updatedRows = await prisma.$queryRaw`
      UPDATE job_runs
      SET
        duration_ms = ${duration.durationMs},
        error_message = ${errorMessage},
        finished_at = ${now},
        result_payload = ${resultPayloadJson}::jsonb,
        status = 'failed'::job_run_status
      WHERE id = ${run.id}::uuid
        AND status = 'running'::job_run_status
        AND finished_at IS NULL
        AND COALESCE(
          CASE
            WHEN result_payload->>'heartbeatEpochMs' ~ '^[0-9]+$'
              THEN TO_TIMESTAMP((result_payload->>'heartbeatEpochMs')::double precision / 1000)
            ELSE NULL
          END,
          started_at
        ) <= ${staleBefore}
      RETURNING
        duration_ms AS "durationMs",
        error_message AS "errorMessage",
        id,
        job_type AS "jobType",
        started_at AS "startedAt",
        status
    `;

    if (updatedRows[0]) {
      repaired.push(summaryRow(updatedRows[0]));
    }
  }

  console.log(JSON.stringify({
    dryRun: false,
    repaired: repaired.length,
    staleBefore: staleBefore.toISOString(),
    staleMinutes,
    runs: repaired,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}

function argValue(name) {
  const prefix = `${name}=`;
  const entry = process.argv.slice(2).find((arg) => arg.startsWith(prefix));

  return entry?.slice(prefix.length);
}

function positiveInteger(value, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.floor(number);
}

function summaryRow(run) {
  return {
    durationMs: run.durationMs,
    errorMessage: run.errorMessage,
    id: run.id,
    jobType: run.jobType,
    startedAt: run.startedAt.toISOString(),
    status: run.status,
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
