import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { assessCardTraderMarketPrice } from "./cardtrader-sealed-pricing.mjs";

export const cardTraderQuarantineSource = "cardtrader-sealed-quarantined";

const cardTraderSource = "cardtrader-sealed";
const referenceSource = "tcgcsv";
const defaultLimit = 500;
const maxLimit = 2_000;

export function cardTraderOutlierRepairOptions({
  args = process.argv.slice(2),
  env = process.env,
} = {}) {
  return {
    apply: args.includes("--confirm"),
    limit: boundedPositiveInteger(argumentValue(args, "--limit"), defaultLimit, maxLimit),
    maxOfferPriceRatio: positiveNumber(env.CARDTRADER_SEALED_MAX_OFFER_PRICE_RATIO, 4),
    maxReferencePriceRatio: positiveNumber(env.CARDTRADER_SEALED_MAX_REFERENCE_PRICE_RATIO, 4),
    minOfferCount: boundedPositiveInteger(env.CARDTRADER_SEALED_MIN_OFFERS, 3, 10),
    minReferenceDifferenceMinor: boundedPositiveInteger(
      env.CARDTRADER_SEALED_MIN_REFERENCE_DIFFERENCE_MINOR,
      5_000,
      1_000_000,
    ),
    referenceMaxAgeDays: boundedPositiveInteger(
      env.CARDTRADER_SEALED_REFERENCE_MAX_AGE_DAYS,
      14,
      90,
    ),
  };
}

export async function runCardTraderOutlierRepair({
  now = new Date(),
  options = cardTraderOutlierRepairOptions(),
  prisma = new PrismaClient(),
} = {}) {
  try {
    const snapshots = await loadActiveCardTraderSnapshots(prisma, options.limit);
    const observationTimes = snapshots
      .map((snapshot) => validDate(snapshot.observedAt).getTime())
      .filter(Number.isFinite);
    const earliestObservedAt = observationTimes.length
      ? new Date(observationTimes.reduce((earliest, value) => Math.min(earliest, value)))
      : validDate(now);
    const latestObservedAt = observationTimes.length
      ? new Date(observationTimes.reduce((latest, value) => Math.max(latest, value)))
      : validDate(now);
    const observedAfter = new Date(
      earliestObservedAt.getTime() - options.referenceMaxAgeDays * 24 * 60 * 60 * 1_000,
    );
    const productIds = [...new Set(snapshots.map((snapshot) => snapshot.sealedProductId).filter(Boolean))];
    const referenceRows = productIds.length
      ? await prisma.priceSnapshot.findMany({
          orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
          select: {
            observedAt: true,
            priceMinor: true,
            sealedProductId: true,
            source: true,
          },
          where: {
            itemType: "SEALED_PRODUCT",
            observedAt: { gte: observedAfter, lte: latestObservedAt },
            sealedProductId: { in: productIds },
            source: referenceSource,
          },
        })
      : [];
    const references = historicalReferencesBySnapshot(
      snapshots,
      referenceRows,
      options.referenceMaxAgeDays,
    );
    const operations = snapshots.flatMap((snapshot) => {
      const assessment = assessCardTraderMarketPrice(marketPriceFromSnapshot(snapshot), {
        maxOfferPriceRatio: options.maxOfferPriceRatio,
        maxReferencePriceRatio: options.maxReferencePriceRatio,
        minOfferCount: options.minOfferCount,
        minReferenceDifferenceMinor: options.minReferenceDifferenceMinor,
        referencePrice: references.get(snapshot.id),
      });

      return assessment.trusted ? [] : [{ assessment, snapshot }];
    });
    const report = {
      dryRun: !options.apply,
      pageSize: options.limit,
      quarantineSource: cardTraderQuarantineSource,
      scanned: snapshots.length,
      trusted: snapshots.length - operations.length,
      wouldQuarantine: operations.length,
      quarantineReasons: countReasons(operations),
      sampleOperations: operations.slice(0, 25).map(({ assessment, snapshot }) => ({
        id: snapshot.id,
        observedAt: snapshot.observedAt,
        observedPriceMinor: snapshot.priceMinor,
        reason: assessment.reason,
        referencePriceMinor: assessment.referencePriceMinor,
        sealedProductId: snapshot.sealedProductId,
        status: assessment.status,
      })),
    };

    if (!options.apply) {
      return { ...report, quarantined: 0 };
    }

    let quarantined = 0;

    for (const { assessment, snapshot } of operations) {
      const metadata = isObject(snapshot.metadata) ? snapshot.metadata : {};
      const result = await prisma.priceSnapshot.updateMany({
        data: {
          metadata: {
            ...metadata,
            quarantine: {
              originalSource: snapshot.source,
              quarantinedAt: validDate(now).toISOString(),
              reason: assessment.reason,
              referenceObservedAt: assessment.referenceObservedAt,
              referencePriceMinor: assessment.referencePriceMinor,
              referenceSource: assessment.referenceSource,
              status: assessment.status,
            },
          },
          source: cardTraderQuarantineSource,
        },
        where: {
          id: snapshot.id,
          source: cardTraderSource,
        },
      });

      quarantined += result.count;
    }

    return { ...report, quarantined };
  } finally {
    await prisma.$disconnect();
  }
}

async function loadActiveCardTraderSnapshots(prisma, pageSize) {
  const snapshots = [];
  let afterId;

  while (true) {
    const page = await prisma.priceSnapshot.findMany({
      orderBy: { id: "asc" },
      select: {
        confidenceScore: true,
        createdAt: true,
        id: true,
        metadata: true,
        observedAt: true,
        priceMinor: true,
        sealedProductId: true,
        source: true,
        sourceRef: true,
      },
      take: pageSize,
      where: {
        ...(afterId ? { id: { gt: afterId } } : {}),
        itemType: "SEALED_PRODUCT",
        sealedProductId: { not: null },
        source: cardTraderSource,
      },
    });

    snapshots.push(...page);

    if (page.length < pageSize) {
      return snapshots;
    }

    afterId = page.at(-1)?.id;

    if (!afterId) {
      throw new Error("CardTrader outlier repair could not advance its stable snapshot cursor.");
    }
  }
}

function marketPriceFromSnapshot(snapshot) {
  const metadata = isObject(snapshot.metadata) ? snapshot.metadata : {};
  const samples = Array.isArray(metadata.convertedPriceSamplesMinor)
    ? metadata.convertedPriceSamplesMinor
        .map(Number)
        .filter((price) => Number.isFinite(price) && price > 0)
    : [];
  const samplePricesMinor = samples.length ? samples : [snapshot.priceMinor];
  const offerCount = positiveInteger(metadata.offerCountUsed, samplePricesMinor.length);

  return {
    confidenceScore: snapshot.confidenceScore,
    listingCount: positiveInteger(metadata.listingCount, offerCount),
    offerCount,
    priceMinor: snapshot.priceMinor,
    samplePricesMinor,
  };
}

function historicalReferencesBySnapshot(snapshots, rows, maxAgeDays) {
  const references = new Map();
  const byProduct = new Map();

  for (const row of rows) {
    const productRows = byProduct.get(row.sealedProductId) ?? [];

    productRows.push(row);
    byProduct.set(row.sealedProductId, productRows);
  }

  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1_000;

  for (const snapshot of snapshots) {
    const observedAtMs = validDate(snapshot.observedAt).getTime();
    const reference = (byProduct.get(snapshot.sealedProductId) ?? []).find((row) => {
      const referenceAtMs = validDate(row.observedAt).getTime();

      return referenceAtMs <= observedAtMs && observedAtMs - referenceAtMs <= maxAgeMs;
    });

    if (reference) {
      references.set(snapshot.id, reference);
    }
  }

  return references;
}

function countReasons(operations) {
  const counts = {};

  for (const { assessment } of operations) {
    counts[assessment.reasonKey] = (counts[assessment.reasonKey] ?? 0) + 1;
  }

  return counts;
}

function argumentValue(args, name) {
  const inline = args.find((argument) => argument.startsWith(`${name}=`));

  return inline?.slice(name.length + 1);
}

function boundedPositiveInteger(value, fallback, maximum) {
  const number = positiveInteger(value, fallback);

  return Math.min(number, maximum);
}

function positiveInteger(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("CardTrader outlier repair requires a valid current time.");
  }

  return date;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runCardTraderOutlierRepair();

  console.log(JSON.stringify(report, null, 2));
}
