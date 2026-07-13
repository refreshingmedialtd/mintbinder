import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { jobErrorStatus, requireJobSecret } from "@/lib/jobs/auth";
import { JobRunExecutionError, runTrackedJob } from "@/lib/jobs/runs";
import { ExchangeRateConfigError, resolveGbpRates } from "@/lib/pricing/exchange-rates";
import {
  japanCardPricingOptionsFromEnv,
  syncTcgcsvCardPrices,
  type TcgcsvCardPricingOptions,
} from "../../../../../scripts/tcgcsv-card-pricing.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type InternationalCardPricingBody = {
  categoryId?: number | string;
  groupIds?: string[] | string;
  groupLimit?: number | string;
  language?: string;
  minUnpricedCards?: number | string;
  onlyUnpricedGroups?: boolean;
  priceOnlyUnpriced?: boolean;
  source?: string;
  usdToGbpRate?: number | string;
  waitMs?: number | string;
  writePrices?: boolean;
};

export async function POST(request: Request) {
  try {
    requireJobSecret(request);

    const body = (await request.json().catch(() => ({}))) as InternationalCardPricingBody;
    const input = await internationalCardPricingInput(body);
    const { jobRun, result } = await runTrackedJob({
      input,
      type: "pricing_refresh",
      task: () =>
        syncTcgcsvCardPrices({
          ...japanCardPricingOptionsFromEnv(process.env),
          ...input,
          prisma,
        }),
    });

    return NextResponse.json({ ...result, jobRun });
  } catch (error) {
    const originalError = error instanceof JobRunExecutionError ? error.originalError : error;
    const message = originalError instanceof Error ? originalError.message : "Unable to refresh international card pricing.";
    const jobRun = error instanceof JobRunExecutionError ? error.jobRun : undefined;

    return NextResponse.json({
      error: message,
      jobRun,
    }, {
      status: originalError instanceof ExchangeRateConfigError ? 501 : jobErrorStatus(originalError),
    });
  }
}

async function internationalCardPricingInput(
  body: InternationalCardPricingBody,
): Promise<TcgcsvCardPricingOptions> {
  const input: TcgcsvCardPricingOptions = {};
  const categoryId = optionalPositiveInteger(body.categoryId);
  const groupIds = optionalGroupIds(body.groupIds);
  const groupLimit = optionalPositiveInteger(body.groupLimit);
  const minUnpricedCards = optionalPositiveInteger(body.minUnpricedCards);
  const usdToGbpRate = optionalRate(body.usdToGbpRate);
  const waitMs = optionalNonNegativeInteger(body.waitMs);
  const language = optionalString(body.language);
  const source = optionalString(body.source);

  if (categoryId !== undefined) {
    input.categoryId = categoryId;
  }

  if (groupIds?.length) {
    input.groupIds = groupIds;
  }

  if (groupLimit !== undefined) {
    input.groupLimit = groupLimit;
  }

  if (language) {
    input.language = language;
  }

  if (minUnpricedCards !== undefined) {
    input.minUnpricedCards = minUnpricedCards;
  }

  if (typeof body.onlyUnpricedGroups === "boolean") {
    input.onlyUnpricedGroups = body.onlyUnpricedGroups;
  }

  if (typeof body.priceOnlyUnpriced === "boolean") {
    input.priceOnlyUnpriced = body.priceOnlyUnpriced;
  }

  if (source) {
    input.source = source;
  }

  if (usdToGbpRate !== undefined) {
    input.usdToGbpRate = usdToGbpRate;
  }

  if (input.usdToGbpRate === undefined && body.writePrices !== false) {
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

function optionalNonNegativeInteger(value: number | string | undefined) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return undefined;
  }

  return Math.floor(number);
}

function optionalRate(value: number | string | undefined) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function optionalString(value: unknown) {
  const trimmed = String(value ?? "").trim();

  return trimmed || undefined;
}
