import { prisma } from "@/lib/db/prisma";
import type { ServiceHealthCheck } from "@/lib/health-response";

export async function checkServiceHealth(): Promise<ServiceHealthCheck> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return {
      checkedAt,
      database: "ok",
      durationMs: Date.now() - startedAt,
      ok: true,
    };
  } catch {
    return {
      checkedAt,
      database: "failed",
      durationMs: Date.now() - startedAt,
      ok: false,
    };
  }
}
