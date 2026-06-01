import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobSecret } from "@/lib/jobs/auth";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";
import { syncPokemonTcgCardPages } from "@/lib/pricing/pokemon-tcg-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireJobSecret(request);

    const body = (await request.json().catch(() => ({}))) as {
      page?: number;
      pageSize?: number;
      maxPages?: number;
      q?: string;
    };
    const { jobRun, result } = await runTrackedJob({
      input: body,
      type: "catalogue_refresh",
      task: () =>
        syncPokemonTcgCardPages({
          maxPages: body.maxPages,
          page: body.page,
          pageSize: body.pageSize,
          q: body.q,
          writePrices: false,
        }),
    });

    return NextResponse.json({ ...result, jobRun });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error ? originalError.message : "Unable to refresh catalogue.";
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;

    return NextResponse.json({ error: message, jobRun }, { status: jobErrorStatus(originalError) });
  }
}
