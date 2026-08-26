import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canUseOperationsForUser } from "@/lib/auth/roles";
import { catalogueStatus } from "@/lib/jobs/catalogue-status";
import { betaEnvironmentSnapshot, betaLaunchChecks } from "@/lib/jobs/beta-launch";
import { recentJobRuns } from "@/lib/jobs/runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id || !canUseOperationsForUser(session.user.role)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  try {
    const [catalogue, jobRuns] = await Promise.all([
      catalogueStatus(),
      recentJobRuns({ limit: 8 }),
    ]);
    const env = betaEnvironmentSnapshot(process.env);

    return NextResponse.json({
      catalogue,
      env,
      generatedAt: new Date().toISOString(),
      jobRuns,
      launchChecks: betaLaunchChecks({ catalogue: catalogue.status, env }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load beta status.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
