import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const environment = environmentChecks();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        checks: {
          auth: environment,
          database: "ok",
        },
        build: buildInfo(),
        durationMs: Date.now() - startedAt,
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
  } catch {
    return NextResponse.json(
      {
        checks: {
          auth: environment,
          database: "failed",
        },
        build: buildInfo(),
        durationMs: Date.now() - startedAt,
        error: "Database health check failed.",
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
    authSecretConfigured: Boolean(process.env.AUTH_SECRET),
    authTrustHost: process.env.AUTH_TRUST_HOST === "true",
    authUrlConfigured: Boolean(process.env.AUTH_URL || process.env.NEXTAUTH_URL),
    nextPublicAppUrlConfigured: Boolean(process.env.NEXT_PUBLIC_APP_URL),
  };
}

function buildInfo() {
  return {
    branch: process.env.MINTBINDER_RUNTIME_BRANCH || "unknown",
    commit: process.env.MINTBINDER_RUNTIME_COMMIT || "unknown",
    deployScriptVersion: process.env.MINTBINDER_RUNTIME_DEPLOY_SCRIPT_VERSION || "unknown",
    // app.js derives this from the directory actually passed to Next, after
    // matching root and release-local build metadata.
    distDir: process.env.MINTBINDER_RUNTIME_DIST_DIR || "unknown",
    generatedAt: process.env.MINTBINDER_RUNTIME_GENERATED_AT || undefined,
    nodeVersion: process.env.MINTBINDER_RUNTIME_NODE_VERSION || undefined,
  };
}
