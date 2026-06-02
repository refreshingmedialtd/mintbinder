import { NextResponse } from "next/server";
import { buildCatalogueGapReport } from "@/lib/jobs/catalogue-gap-report";
import { catalogueStatus } from "@/lib/jobs/catalogue-status";
import { jobErrorStatus, requireJobSecret } from "@/lib/jobs/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    requireJobSecret(request);

    const { status } = await catalogueStatus();
    const report = buildCatalogueGapReport(status);

    return NextResponse.json(report, {
      headers: {
        "content-disposition": `attachment; filename="pokestop-catalogue-gaps-${report.generatedAt.slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to export catalogue gaps.";

    return NextResponse.json({ error: message }, { status: jobErrorStatus(error) });
  }
}
