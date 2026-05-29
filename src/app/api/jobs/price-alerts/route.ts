import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobSecret } from "@/lib/jobs/auth";
import { sendPriceAlertDigests } from "@/lib/notifications/price-alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireJobSecret(request);

    const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
    const result = await sendPriceAlertDigests({ dryRun: body.dryRun === true });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run price alert job.";

    return NextResponse.json({ error: message }, { status: jobErrorStatus(error) });
  }
}
