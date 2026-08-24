import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobAccess } from "@/lib/jobs/auth";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";
import {
  assertPriceAlertDigestHealthy,
  sendPriceAlertDigests,
} from "@/lib/notifications/price-alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireJobAccess(request);

    const body = (await request.json().catch(() => ({}))) as {
      dryRun?: boolean;
      now?: string;
      testRecipient?: string;
    };
    const now = parseOptionalDate(body.now);
    const { jobRun, result } = await runTrackedJob({
      input: {
        dryRun: body.dryRun === true,
        now: body.now,
        testRecipientConfigured: Boolean(body.testRecipient?.trim()),
      },
      type: "price_alerts",
      task: async () => assertPriceAlertDigestHealthy(await sendPriceAlertDigests({
        dryRun: body.dryRun === true,
        now,
        testRecipient: body.testRecipient,
      })),
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
