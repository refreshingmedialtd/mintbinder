import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { jobErrorStatus, requireJobAccess } from "@/lib/jobs/auth";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";
import { ExchangeRateConfigError, resolveGbpRates } from "@/lib/pricing/exchange-rates";
import {
  priceChartingGradedOptionsFromEnv,
  syncPriceChartingGradedCardPrices,
  type PriceChartingGradedOptions,
} from "../../../../../scripts/pricecharting-graded-card-pricing.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GradedCardPricingBody = {
  limit?: number | string;
  priceOnlyUnpriced?: boolean;
  scheduled?: boolean;
  retryAttempts?: number | string;
  retryWaitMs?: number | string;
  timeoutMs?: number | string;
  usdToGbpRate?: number | string;
  waitMs?: number | string;
  writePrices?: boolean;
};

export async function POST(request: Request) {
  try {
    await requireJobAccess(request);

    const body = (await request.json().catch(() => ({}))) as GradedCardPricingBody;
    const envOptions = priceChartingGradedOptionsFromEnv(process.env);
    const input = await gradedCardPricingInput(body, envOptions);
    const { jobRun, result } = await runTrackedJob({
      input: {
        ...input,
        provider: "pricecharting-graded-card",
        scheduled: body.scheduled === true,
      },
      type: "pricing_refresh",
      task: () => syncPriceChartingGradedCardPrices({
        ...envOptions,
        ...input,
        prisma,
      }),
    });

    return NextResponse.json({ ...result, jobRun });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error
      ? originalError.message
      : "Unable to refresh graded-card pricing.";
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;

    return NextResponse.json({ error: message, jobRun }, {
      status: originalError instanceof ExchangeRateConfigError ? 501 : jobErrorStatus(originalError),
    });
  }
}

async function gradedCardPricingInput(
  body: GradedCardPricingBody,
  envOptions: PriceChartingGradedOptions,
): Promise<PriceChartingGradedOptions> {
  const input: PriceChartingGradedOptions = {};
  const limit = optionalPositiveInteger(body.limit);
  const retryAttempts = optionalPositiveInteger(body.retryAttempts);
  const retryWaitMs = optionalNonNegativeInteger(body.retryWaitMs);
  const timeoutMs = optionalPositiveInteger(body.timeoutMs);
  const usdToGbpRate = optionalRate(body.usdToGbpRate);
  const waitMs = optionalNonNegativeInteger(body.waitMs);

  if (limit !== undefined) input.limit = limit;
  if (retryAttempts !== undefined) input.retryAttempts = retryAttempts;
  if (retryWaitMs !== undefined) input.retryWaitMs = retryWaitMs;
  if (timeoutMs !== undefined) input.timeoutMs = timeoutMs;
  if (usdToGbpRate !== undefined) input.usdToGbpRate = usdToGbpRate;
  if (waitMs !== undefined) input.waitMs = waitMs;
  if (typeof body.priceOnlyUnpriced === "boolean") input.priceOnlyUnpriced = body.priceOnlyUnpriced;
  if (typeof body.writePrices === "boolean") input.writePrices = body.writePrices;

  const effectiveWrite = input.writePrices ?? envOptions.writePrices ?? false;

  if (effectiveWrite && input.usdToGbpRate === undefined && envOptions.usdToGbpRate === undefined) {
    const rates = await resolveGbpRates({
      env: {
        ...process.env,
        PRICECHARTING_USD_TO_GBP_RATE:
          process.env.PRICECHARTING_USD_TO_GBP_RATE ||
          process.env.TCGCSV_USD_TO_GBP_RATE ||
          process.env.POKEMON_TCG_USD_TO_GBP_RATE,
      },
      fallbackEnvKeys: {
        EUR: "POKEMON_TCG_EUR_TO_GBP_RATE",
        USD: "PRICECHARTING_USD_TO_GBP_RATE",
      },
      optionalCurrencies: [],
      requiredCurrencies: ["USD"],
    });

    input.usdToGbpRate = rates.USD?.rate;
  }

  return input;
}

function optionalPositiveInteger(value: number | string | undefined) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
}

function optionalNonNegativeInteger(value: number | string | undefined) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined;
}

function optionalRate(value: number | string | undefined) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : undefined;
}
