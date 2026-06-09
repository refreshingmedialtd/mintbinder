import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobSecret } from "@/lib/jobs/auth";
import { duplicateProviderReview } from "@/lib/jobs/duplicate-provider-review";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    requireJobSecret(request);

    const params = new URL(request.url).searchParams;
    const limit = Number(params.get("limit") ?? 50);
    const report = await duplicateProviderReview({ limit });

    return NextResponse.json(report, {
      headers: {
        "content-disposition": `attachment; filename="mintbinder-duplicate-provider-review-${report.generatedAt.slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to review duplicate provider IDs.";

    return NextResponse.json({ error: message }, { status: jobErrorStatus(error) });
  }
}
