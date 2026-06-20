import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobSecret } from "@/lib/jobs/auth";
import { JobRunExecutionError, recentJobRuns, runTrackedJob } from "@/lib/jobs/runs";
import { scheduledPricingInputFromSources, type ScheduledPricingBody } from "@/lib/jobs/scheduled-pricing";
import {
  PricingProviderConfigError,
  syncPokemonTcgCardPages,
} from "@/lib/pricing/pokemon-tcg-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    requireJobSecret(request);

    return NextResponse.json({
      next: await scheduledPricingInput(),
      ok: true,
      scheduled: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to preview scheduled pricing.";

    return NextResponse.json({ error: message }, { status: jobErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    requireJobSecret(request);

    const input = await scheduledPricingInput(await request.json().catch(() => ({})));
    const { jobRun, result } = await runTrackedJob({
      input: {
        ...input,
        scheduled: true,
        scheduler: "scheduled-pricing",
      },
      type: "pricing_refresh",
      task: () =>
        syncPokemonTcgCardPages({
          ...input,
          writePrices: true,
        }),
    });

    return NextResponse.json({
      ...result,
      jobRun,
      scheduled: true,
      selectedPage: input.page,
    });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error ? originalError.message : "Unable to run scheduled pricing.";
    const status = originalError instanceof PricingProviderConfigError ? 501 : jobErrorStatus(originalError);
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;

    return NextResponse.json({ error: message, jobRun }, { status });
  }
}

async function scheduledPricingInput(body: ScheduledPricingBody = {}) {
  const runs = await recentJobRuns({ limit: 50, type: "pricing_refresh" });

  return scheduledPricingInputFromSources({
    body,
    env: process.env,
    recentRuns: runs,
  });
}
