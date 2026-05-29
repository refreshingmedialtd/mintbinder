import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobSecret } from "@/lib/jobs/auth";
import { recentJobRuns } from "@/lib/jobs/runs";
import { isJobRunType } from "@/lib/jobs/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    requireJobSecret(request);

    const params = new URL(request.url).searchParams;
    const type = params.get("type");
    const limit = Number(params.get("limit") ?? 20);
    const runs = await recentJobRuns({
      limit,
      type: isJobRunType(type) ? type : undefined,
    });

    return NextResponse.json({ runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load job runs.";

    return NextResponse.json({ error: message }, { status: jobErrorStatus(error) });
  }
}
