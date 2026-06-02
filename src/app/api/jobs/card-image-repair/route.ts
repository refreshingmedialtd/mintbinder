import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobSecret } from "@/lib/jobs/auth";
import { repairMissingPokemonTcgCardImages } from "@/lib/jobs/card-image-repair";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CardImageRepairBody = {
  dryRun?: boolean;
  limit?: number | string;
};

export async function POST(request: Request) {
  try {
    requireJobSecret(request);

    const body = (await request.json().catch(() => ({}))) as CardImageRepairBody;
    const input = cardImageRepairInput(body);
    const { jobRun, result } = await runTrackedJob({
      input: { ...input, job: "card_image_repair" },
      type: "catalogue_refresh",
      task: () => repairMissingPokemonTcgCardImages(input),
    });

    return NextResponse.json({ ...result, jobRun });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error ? originalError.message : "Unable to repair card images.";
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;

    return NextResponse.json({ error: message, jobRun }, { status: jobErrorStatus(originalError) });
  }
}

function cardImageRepairInput(body: CardImageRepairBody) {
  const limit = optionalPositiveInteger(body.limit);

  return {
    dryRun: typeof body.dryRun === "boolean" ? body.dryRun : false,
    limit: limit ?? undefined,
  };
}

function optionalPositiveInteger(value: number | string | undefined) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return undefined;
  }

  return Math.floor(number);
}
