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
      scheduled?: boolean;
    };
    const input = {
      batchSize: body.batchSize,
      scheduled: body.scheduled === true,
    };
    const { jobRun, result } = await runTrackedJob({
      input,
      type: "billing_checkout_retirement",
      task: async () => assertBillingCheckoutRetirementHealthy(await runBillingCheckoutRetirement({
        batchSize: input.batchSize,
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
