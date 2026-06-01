import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { jobErrorResultPayload } from "@/lib/jobs/error-payload";
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

  try {
    const result = await task();
    const completedRun = await completeJobRun(jobRun.id, result);

    return { jobRun: completedRun, result };
  } catch (error) {
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
  const rows = await prisma.$queryRaw<DbJobRun[]>`
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

  return mapJobRun(rows[0]);
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

  return mapJobRun(rows[0]);
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
