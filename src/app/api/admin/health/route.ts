import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canUseOperationsForUser } from "@/lib/auth/roles";
import { checkServiceHealth } from "@/lib/health";
import { detailedHealthPayload } from "@/lib/health-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStoreHeaders = {
  "cache-control": "no-store",
};

export async function GET() {
  const session = await auth();

  if (!session?.user?.id || !canUseOperationsForUser(session.user.role)) {
    return NextResponse.json(
      { error: "Admin access required." },
      { headers: noStoreHeaders, status: 403 },
    );
  }

  const check = await checkServiceHealth();

  return NextResponse.json(detailedHealthPayload(check), {
    headers: noStoreHeaders,
    status: check.ok ? 200 : 503,
  });
}
