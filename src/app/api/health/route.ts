import { NextResponse } from "next/server";
import { getDeploymentInfo } from "@/lib/deployment/build-info";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const environment = environmentChecks();
  const deployment = await getDeploymentInfo();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        checks: {
          auth: environment,
          database: "ok",
        },
        durationMs: Date.now() - startedAt,
        deployment,
        ok: true,
        service: "mintbinder",
        status: "ok",
        checkedAt,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        checks: {
          auth: environment,
          database: "failed",
        },
        durationMs: Date.now() - startedAt,
        deployment,
        error: error instanceof Error ? error.message : "Health check failed.",
        ok: false,
        service: "mintbinder",
        status: "degraded",
        checkedAt,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
        status: 503,
      },
    );
  }
}

function environmentChecks() {
  return {
    authSecretConfigured: Boolean(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || process.env.JOB_SECRET),
    authTrustHost: process.env.AUTH_TRUST_HOST === "true",
    authUrlConfigured: Boolean(process.env.AUTH_URL || process.env.NEXTAUTH_URL),
    nextPublicAppUrlConfigured: Boolean(process.env.NEXT_PUBLIC_APP_URL),
  };
}
