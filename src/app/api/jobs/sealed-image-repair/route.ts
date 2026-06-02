import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobSecret } from "@/lib/jobs/auth";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";
import { repairMissingTcgcsvSealedImages } from "@/lib/jobs/sealed-image-repair";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SealedImageRepairBody = {
  dryRun?: boolean;
  limit?: number | string;
  waitMs?: number | string;
};

export async function POST(request: Request) {
  try {
    requireJobSecret(request);

    const body = (await request.json().catch(() => ({}))) as SealedImageRepairBody;
    const input = sealedImageRepairInput(body);
    const { jobRun, result } = await runTrackedJob({
      input: { ...input, job: "sealed_image_repair" },
      type: "catalogue_refresh",
      task: () => repairMissingTcgcsvSealedImages(input),
    });

    return NextResponse.json({ ...result, jobRun });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error ? originalError.message : "Unable to repair sealed images.";
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;

    return NextResponse.json({ error: message, jobRun }, { status: jobErrorStatus(originalError) });
  }
}

function sealedImageRepairInput(body: SealedImageRepairBody) {
  const limit = optionalPositiveInteger(body.limit);
  const waitMs = optionalNonNegativeInteger(body.waitMs);

  return {
    dryRun: typeof body.dryRun === "boolean" ? body.dryRun : false,
    limit: limit ?? undefined,
    waitMs: waitMs ?? undefined,
  };
}

function optionalPositiveInteger(value: number | string | undefined) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return undefined;
  }

  return Math.floor(number);
}

function optionalNonNegativeInteger(value: number | string | undefined) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return undefined;
  }

  return Math.floor(number);
}
