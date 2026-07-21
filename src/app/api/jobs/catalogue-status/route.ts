import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobAccess } from "@/lib/jobs/auth";
import { catalogueStatus } from "@/lib/jobs/catalogue-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireJobAccess(request);

    return NextResponse.json(await catalogueStatus());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load catalogue status.";

    return NextResponse.json({ error: message }, { status: jobErrorStatus(error) });
  }
}
