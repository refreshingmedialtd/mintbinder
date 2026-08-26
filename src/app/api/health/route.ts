import { NextResponse } from "next/server";
import { checkServiceHealth } from "@/lib/health";
import { detailedHealthPayload, publicHealthPayload } from "@/lib/health-response";
import { requireJobSecret } from "@/lib/jobs/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const check = await checkServiceHealth();
  const payload = hasDiagnosticAccess(request)
    ? detailedHealthPayload(check)
    : publicHealthPayload(check);

  return NextResponse.json(payload, {
    headers: {
      "cache-control": "no-store",
    },
    status: check.ok ? 200 : 503,
  });
}

function hasDiagnosticAccess(request: Request) {
  try {
    requireJobSecret(request);
    return true;
  } catch {
    return false;
  }
}
