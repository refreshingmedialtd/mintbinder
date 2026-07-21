import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobAccess } from "@/lib/jobs/auth";
import { mergeDuplicateCard } from "@/lib/jobs/duplicate-card-merge";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DuplicateCardMergeBody = {
  duplicateCardId?: string;
  execute?: boolean;
  primaryCardId?: string;
};

export async function POST(request: Request) {
  try {
    await requireJobAccess(request);

    const body = (await request.json().catch(() => ({}))) as DuplicateCardMergeBody;
    const input = duplicateCardMergeInput(body);
    const { jobRun, result } = await runTrackedJob({
      input: { ...input, job: "duplicate_card_merge" },
      type: "catalogue_refresh",
      task: () => mergeDuplicateCard(input),
    });

    return NextResponse.json({ ...result, jobRun });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error ? originalError.message : "Unable to merge duplicate card.";
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;

    return NextResponse.json({ error: message, jobRun }, { status: jobErrorStatus(originalError) });
  }
}

function duplicateCardMergeInput(body: DuplicateCardMergeBody) {
  return {
    duplicateCardId: body.duplicateCardId ?? "",
    execute: body.execute === true,
    primaryCardId: body.primaryCardId ?? "",
  };
}
