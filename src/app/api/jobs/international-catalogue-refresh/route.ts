import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobAccess } from "@/lib/jobs/auth";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";
import { syncTcgdexCardPages } from "@/lib/pricing/tcgdex";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireJobAccess(request);

    const body = (await request.json().catch(() => ({}))) as {
      language?: string;
      maxPages?: number;
      page?: number;
      pageSize?: number;
    };
    const { jobRun, result } = await runTrackedJob({
      input: { ...body, provider: "tcgdex" },
      type: "catalogue_refresh",
      task: () =>
        syncTcgdexCardPages({
          language: body.language,
          maxPages: body.maxPages,
          page: body.page,
          pageSize: body.pageSize,
        }),
    });

    return NextResponse.json({ ...result, jobRun });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error ? originalError.message : "Unable to refresh international catalogue.";
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;

    return NextResponse.json({ error: message, jobRun }, { status: jobErrorStatus(originalError) });
  }
}
