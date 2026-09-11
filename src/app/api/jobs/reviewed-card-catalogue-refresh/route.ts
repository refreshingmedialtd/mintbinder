import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { jobErrorStatus, requireJobAccess } from "@/lib/jobs/auth";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";
import { ExchangeRateConfigError, resolveGbpRates } from "@/lib/pricing/exchange-rates";
import { syncReviewedTcgcsvCardCatalogue } from "../../../../../scripts/reviewed-tcgcsv-card-catalogue.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ReviewedCardCatalogueBody = {
  categoryId?: number | string;
  groupId?: number | string;
  scheduled?: boolean;
  usdToGbpRate?: number | string;
  writePrices?: boolean;
};

export async function POST(request: Request) {
  try {
    await requireJobAccess(request);

    const body = (await request.json().catch(() => ({}))) as ReviewedCardCatalogueBody;
    const categoryId = positiveInteger(body.categoryId);
    const groupId = String(body.groupId ?? "").trim();
    const writePrices = body.writePrices !== false;

    if (!categoryId || !groupId) {
      return NextResponse.json({ error: "categoryId and groupId are required." }, { status: 400 });
    }

    let usdToGbpRate = positiveRate(body.usdToGbpRate);

    if (writePrices && !usdToGbpRate) {
      const rates = await resolveGbpRates({
        env: {
          ...process.env,
          TCGCSV_USD_TO_GBP_RATE:
            process.env.TCGCSV_JAPAN_USD_TO_GBP_RATE ||
            process.env.TCGCSV_USD_TO_GBP_RATE ||
            process.env.POKEMON_TCG_USD_TO_GBP_RATE,
        },
        fallbackEnvKeys: {
          EUR: "POKEMON_TCG_EUR_TO_GBP_RATE",
          USD: "TCGCSV_USD_TO_GBP_RATE",
        },
        optionalCurrencies: [],
        requiredCurrencies: ["USD"],
      });

      usdToGbpRate = rates.USD?.rate;
    }

    const input = {
      categoryId,
      groupId,
      provider: "tcgcsv-reviewed-catalogue",
      scheduled: body.scheduled === true,
      usdToGbpRate,
      writePrices,
    };
    const { jobRun, result } = await runTrackedJob({
      input,
      type: "catalogue_refresh",
      task: () => syncReviewedTcgcsvCardCatalogue({
        categoryId,
        groupId,
        prisma,
        usdToGbpRate,
        writePrices,
      }),
    });

    return NextResponse.json({ ...result, jobRun });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error
      ? originalError.message
      : "Unable to refresh the reviewed card catalogue.";
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;

    return NextResponse.json({ error: message, jobRun }, {
      status: originalError instanceof ExchangeRateConfigError ? 501 : jobErrorStatus(originalError),
    });
  }
}

function positiveInteger(value: unknown) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
}

function positiveRate(value: unknown) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : undefined;
}
