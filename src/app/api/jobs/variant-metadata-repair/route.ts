import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobSecret } from "@/lib/jobs/auth";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";
import { repairMissingPokemonTcgVariantMetadata } from "@/lib/jobs/variant-metadata-repair";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type VariantMetadataRepairBody = {
  dryRun?: boolean;
  limit?: number | string;
  waitMs?: number | string;
};

export async function POST(request: Request) {
  try {
    requireJobSecret(request);

    const body = (await request.json().catch(() => ({}))) as VariantMetadataRepairBody;
    const input = variantMetadataRepairInput(body);
    const { jobRun, result } = await runTrackedJob({
      input: { ...input, job: "variant_metadata_repair" },
      type: "catalogue_refresh",
      task: () => repairMissingPokemonTcgVariantMetadata(input),
    });

    return NextResponse.json({ ...result, jobRun });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error ? originalError.message : "Unable to repair variant metadata.";
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;

    return NextResponse.json({ error: message, jobRun }, { status: jobErrorStatus(originalError) });
  }
}

function variantMetadataRepairInput(body: VariantMetadataRepairBody) {
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
