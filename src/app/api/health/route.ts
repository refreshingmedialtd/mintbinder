import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        checks: {
          database: "ok",
        },
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
  } catch (error) {
    return NextResponse.json(
      {
        checks: {
          database: "failed",
        },
        durationMs: Date.now() - startedAt,
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
