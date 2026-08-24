import { NextResponse } from "next/server";
import {
  assertBillingCheckoutRetirementHealthy,
  runBillingCheckoutRetirement,
} from "@/lib/billing/checkout-retirement";
import { jobErrorStatus, requireJobAccess } from "@/lib/jobs/auth";
import { jobErrorResultPayload } from "@/lib/jobs/error-payload";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireJobAccess(request);
    const body = (await request.json().catch(() => ({}))) as {
      batchSize?: number;
      now?: string;
      staleAfterMinutes?: number;
    };
    const { jobRun, result } = await runTrackedJob({
      input: body,
      type: "billing_checkout_retirement",
      task: async () => assertBillingCheckoutRetirementHealthy(await runBillingCheckoutRetirement({
        batchSize: body.batchSize,
        now: parseOptionalDate(body.now),
        staleAfterMs: body.staleAfterMinutes === undefined
          ? undefined
          : body.staleAfterMinutes * 60 * 1000,
      })),
    });

    return NextResponse.json({ ...result, jobRun });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error ? originalError.message : "Unable to retire stale billing checkouts.";
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;
    const result = jobErrorResultPayload(originalError);
    return NextResponse.json({ ...result, error: message, jobRun }, { status: jobErrorStatus(originalError) });
  }
}

function parseOptionalDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid billing checkout retirement timestamp.");
  return date;
}
