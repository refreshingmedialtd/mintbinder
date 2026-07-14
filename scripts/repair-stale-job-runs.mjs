import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const defaultStaleMinutes = 45;
const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const confirmed = args.has("--confirm");
const staleMinutes = positiveInteger(argValue("--minutes"), defaultStaleMinutes);
const limit = positiveInteger(argValue("--limit"), 100);
const now = new Date();
const staleBefore = new Date(now.getTime() - staleMinutes * 60 * 1000);

try {
  const staleRuns = await prisma.jobRun.findMany({
    orderBy: { startedAt: "asc" },
    select: {
      durationMs: true,
      errorMessage: true,
      id: true,
      jobType: true,
      requestPayload: true,
      resultPayload: true,
      startedAt: true,
      status: true,
    },
    take: limit,
    where: {
      finishedAt: null,
      startedAt: { lte: staleBefore },
      status: "RUNNING",
    },
  });

  if (!confirmed) {
    console.log(JSON.stringify({
      dryRun: true,
      matched: staleRuns.length,
      nextCommand: "npm run ops:repair-stale-jobs -- --confirm",
      staleBefore: staleBefore.toISOString(),
      staleMinutes,
      runs: staleRuns.map(summaryRow),
    }, null, 2));
    process.exit(0);
  }

  const repaired = [];

  for (const run of staleRuns) {
    const durationMs = Math.max(0, now.getTime() - run.startedAt.getTime());
    const errorMessage = `Marked failed by stale job repair after ${Math.round(durationMs / 60000)} minutes without a finish timestamp.`;
    const resultPayload = {
      ...(isObject(run.resultPayload) ? run.resultPayload : {}),
      repairedAt: now.toISOString(),
      repairReason: "stale_running_job",
    };
    const updated = await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        durationMs,
        errorMessage,
        finishedAt: now,
        resultPayload,
        status: "FAILED",
      },
      select: {
        durationMs: true,
        errorMessage: true,
        id: true,
        jobType: true,
        startedAt: true,
        status: true,
      },
    });

    repaired.push(summaryRow(updated));
  }

  console.log(JSON.stringify({
    dryRun: false,
    repaired: repaired.length,
    staleBefore: staleBefore.toISOString(),
    staleMinutes,
    runs: repaired,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}

function argValue(name) {
  const prefix = `${name}=`;
  const entry = process.argv.slice(2).find((arg) => arg.startsWith(prefix));

  return entry?.slice(prefix.length);
}

function positiveInteger(value, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.floor(number);
}

function summaryRow(run) {
  return {
    durationMs: run.durationMs,
    errorMessage: run.errorMessage,
    id: run.id,
    jobType: run.jobType,
    startedAt: run.startedAt.toISOString(),
    status: run.status,
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
