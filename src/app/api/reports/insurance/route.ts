import { NextResponse } from "next/server";
import { CollectionEventType } from "@prisma/client";
import { auth } from "@/auth";
import { entitlementStatus, requireEntitlement } from "@/lib/entitlements";
import { getAppData } from "@/lib/db/app-data";
import { buildInsuranceReportHtml } from "@/lib/reports/insurance";
import { buildInsuranceReportPdf } from "@/lib/reports/insurance-pdf";
import { boundedInsuranceHistory } from "@/lib/reports/history";
import { prisma } from "@/lib/db/prisma";
import {
  assertInsuranceReportLotLimit,
  InsuranceReportTooLargeError,
} from "@/lib/reports/insurance-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    await requireEntitlement(session.user.id, "exports.insurance_report");

    const activeLotCount = await prisma.collectionItem.count({
      where: { userId: session.user.id, archivedAt: null },
    });
    assertInsuranceReportLotLimit(activeLotCount);

    const data = await getAppData(session.user.id, {
      catalogueScope: "referenced",
      eventLimit: 501,
      eventTypes: [
        CollectionEventType.SOLD,
        CollectionEventType.REMOVED,
        CollectionEventType.GRADED,
      ],
      fallback: "throw",
    });
    // Re-check the loaded snapshot so a concurrent insert cannot push PDF work
    // beyond the cap between the cheap count and the collection read.
    assertInsuranceReportLotLimit(data.collection.length);
    const history = boundedInsuranceHistory(data.events);
    const input = {
      data: { ...data, events: history.events },
      historyNotice: history.notice,
      ownerEmail: session.user.email ?? undefined,
      ownerName: session.user.name ?? undefined,
    };

    if (new URL(request.url).searchParams.get("format") === "html") {
      const html = buildInsuranceReportHtml(input);

      return new Response(html, {
        headers: {
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="mintbinder-insurance-report-${dateStamp()}.html"`,
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    const pdf = await buildInsuranceReportPdf(input);

    return new Response(Buffer.from(pdf), {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="mintbinder-insurance-report-${dateStamp()}.pdf"`,
        "content-type": "application/pdf",
      },
    });
  } catch (error) {
    if (error instanceof InsuranceReportTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const status = entitlementStatus(error);

    if (status === 500) {
      console.error("Unable to export insurance report.", error);
    }

    return NextResponse.json(
      { error: status === 403 ? "Plus subscription required." : "Unable to export insurance report." },
      { status },
    );
  }
}

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
