import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { jobErrorStatus, requireJobSecret } from "@/lib/jobs/auth";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";
import { ExchangeRateConfigError, resolveGbpRates } from "@/lib/pricing/exchange-rates";
import {
  sealedImportOptionsFromEnv,
  syncTcgcsvSealedProducts,
  type TcgcsvSealedImportOptions,
} from "../../../../../scripts/tcgcsv-sealed-importer.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SealedPricingBody = {
  groupIds?: string[] | string;
  groupLimit?: number | string;
  priceOnlyUnpriced?: boolean;
  usdToGbpRate?: number | string;
  waitMs?: number | string;
  writePrices?: boolean;
};

export async function POST(request: Request) {
  try {
    requireJobSecret(request);

    const body = (await request.json().catch(() => ({}))) as SealedPricingBody;
    const input = await sealedPricingInput(body);
    const { jobRun, result } = await runTrackedJob({
      input,
      type: "sealed_pricing_refresh",
      task: () =>
        syncTcgcsvSealedProducts({
          ...sealedImportOptionsFromEnv(process.env),
          ...input,
          prisma,
        }),
    });

    return NextResponse.json({ ...result, jobRun });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error ? originalError.message : "Unable to refresh sealed pricing.";
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;

    return NextResponse.json({
      error: message,
      jobRun,
    }, {
      status: originalError instanceof ExchangeRateConfigError ? 501 : jobErrorStatus(originalError),
    });
  }
}

async function sealedPricingInput(body: SealedPricingBody): Promise<TcgcsvSealedImportOptions> {
  const input: TcgcsvSealedImportOptions = {};
  const groupIds = optionalGroupIds(body.groupIds);
  const groupLimit = optionalPositiveInteger(body.groupLimit);
  const usdToGbpRate = optionalRate(body.usdToGbpRate);
  const waitMs = optionalPositiveInteger(body.waitMs);

  if (groupIds?.length) {
    input.groupIds = groupIds;
  }

  if (groupLimit !== undefined) {
    input.groupLimit = groupLimit;
  }

  if (typeof body.priceOnlyUnpriced === "boolean") {
    input.priceOnlyUnpriced = body.priceOnlyUnpriced;
  }

  if (usdToGbpRate !== undefined) {
    input.usdToGbpRate = usdToGbpRate;
  }

  if (input.usdToGbpRate === undefined && body.writePrices !== false) {
    const rates = await resolveGbpRates({
      env: {
        ...process.env,
        TCGCSV_USD_TO_GBP_RATE: process.env.TCGCSV_USD_TO_GBP_RATE || process.env.POKEMON_TCG_USD_TO_GBP_RATE,
      },
      fallbackEnvKeys: {
        EUR: "POKEMON_TCG_EUR_TO_GBP_RATE",
        USD: "TCGCSV_USD_TO_GBP_RATE",
      },
      optionalCurrencies: [],
      requiredCurrencies: ["USD"],
    });

    input.usdToGbpRate = rates.USD?.rate;
  }

  if (waitMs !== undefined) {
    input.waitMs = waitMs;
  }

  if (typeof body.writePrices === "boolean") {
    input.writePrices = body.writePrices;
  }

  return input;
}

function optionalGroupIds(value: string[] | string | undefined) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return undefined;
}

function optionalPositiveInteger(value: number | string | undefined) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return undefined;
  }

  return Math.floor(number);
}

function optionalRate(value: number | string | undefined) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : undefined;
}
