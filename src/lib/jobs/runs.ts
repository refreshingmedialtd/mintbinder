import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { jobErrorResultPayload } from "@/lib/jobs/error-payload";
import { jobRunHeartbeatIntervalMs } from "@/lib/jobs/lease-policy.mjs";
import type { JobRunStatus, JobRunType } from "@/lib/jobs/types";

export type JobRunRecord = {
  id: string;
  jobType: JobRunType;
  status: JobRunStatus;
  requestPayload: unknown;
  resultPayload: unknown;
  errorMessage?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
};

type DbJobRun = {
  id: string;
  job_type: JobRunType;
  status: JobRunStatus;
  request_payload: unknown;
  result_payload: unknown;
  error_message: string | null;
  started_at: Date;
  finished_at: Date | null;
  duration_ms: number | null;
};

export class JobRunExecutionError extends Error {
  jobRun: JobRunRecord;
  originalError: unknown;

  constructor(originalError: unknown, jobRun: JobRunRecord) {
    super(originalError instanceof Error ? originalError.message : "Job execution failed.");
    this.name = "JobRunExecutionError";
    this.jobRun = jobRun;
    this.originalError = originalError;
  }
}

export class JobRunOverlapError extends Error {
  activeRun: JobRunRecord;
  leaseMinutes: number;

  constructor(activeRun: JobRunRecord, leaseMinutes: number) {
    super(
      `${activeRun.jobType} already has a running job started at ${activeRun.startedAt}; ` +
      `the ${leaseMinutes}-minute overlap lease has not expired.`,
    );
    this.name = "JobRunOverlapError";
    this.activeRun = activeRun;
    this.leaseMinutes = leaseMinutes;
  }
}

export async function runTrackedJob<T>({
  input,
  task,
  type,
}: {
  input: unknown;
  task: () => Promise<T>;
  type: JobRunType;
}) {
  const jobRun = await startJobRun(type, input);
  const heartbeat = startJobRunHeartbeat(jobRun.id);

  try {
    const result = await task();
    await heartbeat.stop();
    const completedRun = await completeJobRun(jobRun.id, result);

    return { jobRun: completedRun, result };
  } catch (error) {
    await heartbeat.stop().catch(() => undefined);
    const failedRun = await failJobRun(jobRun.id, error);

    throw new JobRunExecutionError(error, failedRun);
  }
}

export async function recentJobRuns({
  limit = 20,
  type,
}: {
  limit?: number;
  type?: JobRunType;
} = {}) {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const rows = type
    ? await prisma.$queryRaw<DbJobRun[]>`
        SELECT
          id,
          job_type,
          status,
          request_payload,
          result_payload,
          error_message,
          started_at,
          finished_at,
          duration_ms
        FROM job_runs
        WHERE job_type = ${type}::job_run_type
        ORDER BY started_at DESC
        LIMIT ${safeLimit}
      `
    : await prisma.$queryRaw<DbJobRun[]>`
        SELECT
          id,
          job_type,
          status,
          request_payload,
          result_payload,
          error_message,
          started_at,
          finished_at,
          duration_ms
        FROM job_runs
        ORDER BY started_at DESC
        LIMIT ${safeLimit}
      `;

  return rows.map(mapJobRun);
}

async function startJobRun(type: JobRunType, input: unknown) {
  const id = randomUUID();
  const inputJson = toJsonString(input);
  const leaseMinutes = positiveInteger(process.env.JOB_RUN_OVERLAP_LEASE_MINUTES, 45);
  const leaseStartedAt = new Date(Date.now() - leaseMinutes * 60 * 1_000);
  const rows = await prisma.$transaction(async (tx) => {
    // Serialize starters for this job type, then use the existing RUNNING row as
    // the bounded lease. The advisory lock only guards lease acquisition; the
    // durable job row remains visible while the task runs.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`mintbinder-job:${type}`}, 0))
    `;
    const activeRows = await tx.$queryRaw<DbJobRun[]>`
      SELECT
        id,
        job_type,
        status,
        request_payload,
        result_payload,
        error_message,
        started_at,
        finished_at,
        duration_ms
      FROM job_runs
      WHERE job_type = ${type}::job_run_type
        AND status = 'running'::job_run_status
        AND COALESCE(
          CASE
            WHEN result_payload->>'heartbeatEpochMs' ~ '^[0-9]+$'
              THEN TO_TIMESTAMP((result_payload->>'heartbeatEpochMs')::double precision / 1000)
            ELSE NULL
          END,
          started_at
        ) >= ${leaseStartedAt}
      ORDER BY started_at DESC
      LIMIT 1
    `;

    if (activeRows[0]) {
      throw new JobRunOverlapError(mapJobRun(activeRows[0]), leaseMinutes);
    }

    return tx.$queryRaw<DbJobRun[]>`
      INSERT INTO job_runs (
        id,
        job_type,
        status,
        request_payload
      )
      VALUES (
        ${id}::uuid,
        ${type}::job_run_type,
        'running'::job_run_status,
        ${inputJson}::jsonb
      )
      RETURNING
        id,
        job_type,
        status,
        request_payload,
        result_payload,
        error_message,
        started_at,
        finished_at,
        duration_ms
    `;
  });

  return mapJobRun(rows[0]);
}

function startJobRunHeartbeat(id: string) {
  const leaseMinutes = positiveInteger(process.env.JOB_RUN_OVERLAP_LEASE_MINUTES, 45);
  const intervalMs = jobRunHeartbeatIntervalMs(leaseMinutes);
  let stopped = false;
  let update = Promise.resolve();

  const tick = () => {
    if (stopped) return;

    update = update
      .catch(() => undefined)
      .then(() => heartbeatJobRun(id));
  };
  const timer = setInterval(tick, intervalMs);

  timer.unref?.();

  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await update;
    },
  };
}

async function heartbeatJobRun(id: string) {
  const now = new Date();

  await prisma.$executeRaw`
    UPDATE job_runs
    SET result_payload = COALESCE(result_payload, '{}'::jsonb) || jsonb_build_object(
      'heartbeatAt', ${now.toISOString()},
      'heartbeatEpochMs', ${now.getTime()}
    )
    WHERE id = ${id}::uuid
      AND status = 'running'::job_run_status
  `;
}


async function completeJobRun(id: string, result: unknown) {
  const resultJson = toJsonString(result);
  const rows = await prisma.$queryRaw<DbJobRun[]>`
    UPDATE job_runs
    SET
      status = 'succeeded'::job_run_status,
      result_payload = ${resultJson}::jsonb,
      finished_at = NOW(),
      duration_ms = FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::int
    WHERE id = ${id}::uuid
      AND status = 'running'::job_run_status
    RETURNING
      id,
      job_type,
      status,
      request_payload,
      result_payload,
      error_message,
      started_at,
      finished_at,
      duration_ms
  `;

  if (!rows[0]) {
    throw new Error(`Job run ${id} is no longer RUNNING and cannot be completed.`);
  }

  return mapJobRun(rows[0]);
}

async function failJobRun(id: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown job error.";
  const resultJson = toJsonString(jobErrorResultPayload(error));
  const rows = await prisma.$queryRaw<DbJobRun[]>`
    UPDATE job_runs
    SET
      status = 'failed'::job_run_status,
      result_payload = ${resultJson}::jsonb,
      error_message = ${message},
      finished_at = NOW(),
      duration_ms = FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::int
    WHERE id = ${id}::uuid
      AND status = 'running'::job_run_status
    RETURNING
      id,
      job_type,
      status,
      request_payload,
      result_payload,
      error_message,
      started_at,
      finished_at,
      duration_ms
  `;

  if (rows[0]) {
    return mapJobRun(rows[0]);
  }

  const existingRows = await prisma.$queryRaw<DbJobRun[]>`
    SELECT
      id,
      job_type,
      status,
      request_payload,
      result_payload,
      error_message,
      started_at,
      finished_at,
      duration_ms
    FROM job_runs
    WHERE id = ${id}::uuid
    LIMIT 1
  `;

  if (!existingRows[0]) {
    throw new Error(`Job run ${id} no longer exists.`);
  }

  return mapJobRun(existingRows[0]);
}

function mapJobRun(row: DbJobRun): JobRunRecord {
  return {
    id: row.id,
    jobType: row.job_type,
    status: row.status,
    requestPayload: row.request_payload,
    resultPayload: row.result_payload,
    errorMessage: row.error_message ?? undefined,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at?.toISOString(),
    durationMs: row.duration_ms ?? undefined,
  };
}

function toJsonString(value: unknown) {
  return JSON.stringify(value ?? {});
}

function positiveInteger(value: unknown, fallback: number) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
