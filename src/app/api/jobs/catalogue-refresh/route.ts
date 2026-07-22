import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobAccess } from "@/lib/jobs/auth";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";
import { syncPokemonTcgCardPages, syncPokemonTcgSets } from "@/lib/pricing/pokemon-tcg-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireJobAccess(request);

    const body = (await request.json().catch(() => ({}))) as {
      page?: number;
      pageSize?: number;
      maxPages?: number;
      q?: string;
      backfillNewestMissingSet?: boolean;
      setPageSize?: number;
      setsOnly?: boolean;
    };
    const { jobRun, result } = await runTrackedJob({
      input: body,
      type: "catalogue_refresh",
      task: async () => {
        if (body.setsOnly) {
          const setResult = await syncPokemonTcgSets({ pageSize: body.setPageSize });

          if (!body.backfillNewestMissingSet || !setResult.catalogueBackfillSet) {
            return setResult;
          }

          const cardResult = await syncPokemonTcgCardPages({
            maxPages: 1,
            page: setResult.catalogueBackfillSet.nextPage,
            pageSize: 250,
            q: `set.id:${setResult.catalogueBackfillSet.providerId}`,
            writePrices: false,
          });

          return {
            ...setResult,
            cardsFetched: cardResult.cardsFetched,
            cardsUpserted: cardResult.cardsUpserted,
            catalogueBackfillComplete: cardResult.complete,
            catalogueBackfillNextPage: cardResult.nextPage,
          };
        }

        return syncPokemonTcgCardPages({
          maxPages: body.maxPages,
          page: body.page,
          pageSize: body.pageSize,
          q: body.q,
          writePrices: false,
        });
      },
    });

    return NextResponse.json({ ...result, jobRun });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error ? originalError.message : "Unable to refresh catalogue.";
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;

    return NextResponse.json({ error: message, jobRun }, { status: jobErrorStatus(originalError) });
  }
}
