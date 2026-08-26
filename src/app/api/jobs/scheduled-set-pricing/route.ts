import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobAccess } from "@/lib/jobs/auth";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";
import {
  runScheduledSetPricing,
} from "@/lib/jobs/scheduled-set-pricing";
import {
  scheduledSetPricingInputFromSources,
  type ScheduledSetPricingBody,
} from "@/lib/jobs/scheduled-set-pricing-input";
import { PricingProviderConfigError } from "@/lib/pricing/pokemon-tcg-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireJobAccess(request);

    return NextResponse.json({
      next: scheduledSetPricingInputFromSources(),
      ok: true,
      scheduled: true,
      strategy: "set-rotation",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to preview scheduled set pricing.";

    return NextResponse.json({ error: message }, { status: jobErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    await requireJobAccess(request);

    const body = (await request.json().catch(() => ({}))) as ScheduledSetPricingBody & {
      scheduled?: boolean;
    };
    const input = scheduledSetPricingInputFromSources({ body });
    const { jobRun, result } = await runTrackedJob({
      input: {
        ...input,
        scheduled: body.scheduled === true,
        scheduler: "scheduled-set-pricing",
        strategy: "set-rotation",
        writePrices: true,
      },
      type: "pricing_refresh",
      task: () => runScheduledSetPricing(input),
    });

    return NextResponse.json({
      ...result,
      jobRun,
      scheduled: true,
    });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error ? originalError.message : "Unable to run scheduled set pricing.";
    const status = originalError instanceof PricingProviderConfigError ? 501 : jobErrorStatus(originalError);
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;

    return NextResponse.json({ error: message, jobRun }, { status });
  }
}
