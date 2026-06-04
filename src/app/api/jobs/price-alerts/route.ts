import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobSecret } from "@/lib/jobs/auth";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";
import { sendPriceAlertDigests } from "@/lib/notifications/price-alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireJobSecret(request);

    const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean; now?: string };
    const now = parseOptionalDate(body.now);
    const { jobRun, result } = await runTrackedJob({
      input: body,
      type: "price_alerts",
      task: () => sendPriceAlertDigests({ dryRun: body.dryRun === true, now }),
    });

    return NextResponse.json({ ...result, jobRun });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error ? originalError.message : "Unable to run price alert job.";
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;

    return NextResponse.json({ error: message, jobRun }, { status: jobErrorStatus(originalError) });
  }
}

function parseOptionalDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid price alert digest timestamp.");
  }

  return date;
}
