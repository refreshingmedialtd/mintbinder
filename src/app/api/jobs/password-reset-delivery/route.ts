import { NextResponse } from "next/server";
import {
  runPasswordResetDelivery,
} from "@/lib/auth/password-reset-outbox";
import { jobErrorStatus, requireJobAccess } from "@/lib/jobs/auth";
import { jobErrorResultPayload } from "@/lib/jobs/error-payload";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireJobAccess(request);
    const body = (await request.json().catch(() => ({}))) as {
      batchSize?: unknown;
      now?: unknown;
      staleAfterMinutes?: unknown;
    };
    const input = {
      batchSize: optionalPositiveNumber(body.batchSize),
      now: optionalDate(body.now),
      staleAfterMs: optionalPositiveNumber(body.staleAfterMinutes) === undefined
        ? undefined
        : optionalPositiveNumber(body.staleAfterMinutes)! * 60 * 1_000,
    };
    const { jobRun, result } = await runTrackedJob({
      input: {
        batchSize: input.batchSize ?? null,
        now: input.now?.toISOString() ?? null,
        staleAfterMinutes: input.staleAfterMs === undefined ? null : input.staleAfterMs / 60_000,
      },
      type: "password_reset_delivery",
      task: () => runPasswordResetDelivery(input),
    });

    return NextResponse.json({ ...result, jobRun });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error
      ? originalError.message
      : "Unable to deliver queued password-reset emails.";
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;
    const result = jobErrorResultPayload(originalError);
    return NextResponse.json({ ...result, error: message, jobRun }, { status: jobErrorStatus(originalError) });
  }
}

function optionalPositiveNumber(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Password-reset delivery limits must be positive numbers.");
  }
  return value;
}

function optionalDate(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("Password-reset delivery timestamp must be an ISO string.");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Password-reset delivery timestamp must be valid.");
  return date;
}
