import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { entitlementStatus, requireEntitlement } from "@/lib/entitlements";
import { getAppData } from "@/lib/db/app-data";
import { buildInsuranceReportHtml } from "@/lib/reports/insurance";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    await requireEntitlement(session.user.id, "exports.insurance_report");

    const data = await getAppData(session.user.id);
    const html = buildInsuranceReportHtml({
      data,
      ownerEmail: session.user.email ?? undefined,
      ownerName: session.user.name ?? undefined,
    });

    return new Response(html, {
      headers: {
        "content-disposition": `attachment; filename="mintbinder-insurance-report-${dateStamp()}.html"`,
        "content-type": "text/html; charset=utf-8",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to export insurance report.";

    return NextResponse.json({ error: message }, { status: entitlementStatus(error) });
  }
}

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
