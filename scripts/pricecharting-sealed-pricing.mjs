import {
  ItemCondition,
  ItemType,
  PrismaClient,
} from "@prisma/client";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import {
  assertPriceChartingWriteAllowed,
  priceChartingLicenceConfirmed,
} from "../src/lib/pricing/provider-permissions.mjs";

const pricechartingBaseUrl = "https://www.pricecharting.com/api/product";
const sourceName = "pricecharting-sealed";

const productTypeNeedles = {
  BLISTER: ["blister"],
  BOOSTER_BOX: ["booster box", "half booster box"],
  BOOSTER_PACK: ["booster pack", "sleeved booster", "fun pack", "pack"],
  CASE: ["case"],
  COLLECTION_BOX: ["collection", "collector", "premium collection", "special collection", "box"],
  DECK: ["deck"],
  ELITE_TRAINER_BOX: ["elite trainer", "etb"],
  OTHER: [],
  TIN: ["tin"],
};

const stopWords = new Set([
  "and",
  "box",
  "card",
  "cards",
  "english",
  "pack",
  "pokemon",
  "sealed",
  "set",
  "tcg",
  "the",
  "trading",
]);

export function priceChartingSealedOptionsFromEnv(env = process.env) {
  return {
    licenceConfirmed: priceChartingLicenceConfirmed(env),
    limit: positiveInteger(env.PRICECHARTING_SEALED_LIMIT, 25),
    priceOnlyUnpriced: booleanSetting(env.PRICECHARTING_SEALED_PRICE_ONLY_UNPRICED, true),
    token: stringSetting(env.PRICECHARTING_API_TOKEN),
    usdToGbpRate: conversionRate(env.PRICECHARTING_USD_TO_GBP_RATE) ??
      conversionRate(env.TCGCSV_USD_TO_GBP_RATE) ??
      conversionRate(env.POKEMON_TCG_USD_TO_GBP_RATE),
    useNameSearch: booleanSetting(env.PRICECHARTING_SEALED_USE_NAME_SEARCH, true),
    waitMs: nonNegativeInteger(env.PRICECHARTING_SEALED_WAIT_MS, 1100),
    writePrices: booleanSetting(env.PRICECHARTING_SEALED_WRITE_PRICES, false),
  };
}

export async function syncPriceChartingSealedPrices(options = {}) {
  const prisma = options.prisma ?? new PrismaClient();
  const shouldDisconnect = !options.prisma;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = positiveInteger(options.limit, 25);
  const licenceConfirmed = options.licenceConfirmed === true;
  const priceOnlyUnpriced = options.priceOnlyUnpriced ?? true;
  const token = stringSetting(options.token);
  const usdToGbp = conversionRate(options.usdToGbpRate);
  const useNameSearch = options.useNameSearch ?? true;
  const waitMs = nonNegativeInteger(options.waitMs, 1100);
  const writePrices = options.writePrices ?? false;
  const summary = {
    apiRequests: 0,
    candidatesChecked: 0,
    candidatesMatched: 0,
    candidatesSkipped: 0,
    candidatesUnmatched: 0,
    licenceConfirmed,
    priceOnlyUnpriced,
    pricingSnapshotsCreated: 0,
    sampleUnmatchedProducts: [],
    writePrices,
  };

  assertPriceChartingWriteAllowed({ licenceConfirmed, writePrices });

  if (!token) {
    throw new Error("PRICECHARTING_API_TOKEN must be set for PriceCharting sealed pricing.");
  }

  if (writePrices && !usdToGbp) {
    throw new Error("PRICECHARTING_USD_TO_GBP_RATE, TCGCSV_USD_TO_GBP_RATE, or POKEMON_TCG_USD_TO_GBP_RATE must be set.");
  }

  try {
    const candidates = await prisma.sealedProduct.findMany({
      orderBy: { updatedAt: "asc" },
      select: {
        id: true,
        metadata: true,
        name: true,
        productType: true,
        providerIds: true,
        relatedCardSet: {
          select: {
            name: true,
            series: true,
          },
        },
      },
      take: limit,
      where: {
        createdByUserId: null,
        visibility: "GLOBAL",
        ...(priceOnlyUnpriced ? {
          priceSnapshots: {
            none: {
              itemType: ItemType.SEALED_PRODUCT,
            },
          },
        } : {}),
      },
    });
    const request = async (params) => {
      if (summary.apiRequests > 0 && waitMs > 0) {
        await wait(waitMs);
      }

      summary.apiRequests += 1;

      return fetchPriceChartingProduct({ fetchImpl, params, token });
    };

    for (const product of candidates) {
      summary.candidatesChecked += 1;

      const match = await findPriceChartingMatch({ product, request, useNameSearch });

      if (!match) {
        summary.candidatesUnmatched += 1;
        summary.sampleUnmatchedProducts.push({
          id: product.id,
          name: product.name,
          productType: product.productType,
        });
        summary.sampleUnmatchedProducts = summary.sampleUnmatchedProducts.slice(0, 10);
        continue;
      }

      summary.candidatesMatched += 1;

      const price = bestPriceChartingSealedPrice(match.response);

      if (!price) {
        summary.candidatesSkipped += 1;
        continue;
      }

      if (!writePrices || !usdToGbp) {
        continue;
      }

      await prisma.priceSnapshot.create({
        data: {
          condition: ItemCondition.SEALED,
          confidenceScore: match.confidenceScore,
          currency: "GBP",
          itemType: ItemType.SEALED_PRODUCT,
          metadata: {
            consoleName: match.response["console-name"] ?? null,
            conversionRate: usdToGbp,
            genre: match.response.genre ?? null,
            matchScore: match.score,
            matchType: match.matchType,
            originalCurrency: "USD",
            originalPriceMinor: price.priceMinor,
            originalPrice: price.priceMinor / 100,
            priceChartingProductName: match.response["product-name"],
            priceField: price.field,
            priceSource: "PriceCharting Prices API",
            upc: match.response.upc ?? null,
          },
          observedAt: new Date(),
          priceMinor: Math.round(price.priceMinor * usdToGbp),
          sealedProductId: product.id,
          source: sourceName,
          sourceRef: String(match.response.id),
          variantLabel: "New / sealed",
        },
      });
      summary.pricingSnapshotsCreated += 1;
    }

    return summary;
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

export async function findPriceChartingMatch({ product, request, useNameSearch = true }) {
  const upcs = productUpcs(product);

  for (const upc of upcs) {
    const response = await request({ upc });

    if (!isPriceChartingSuccess(response) || !bestPriceChartingSealedPrice(response)) {
      continue;
    }

    const responseUpcs = upcValues(response.upc);

    if (!responseUpcs.length || responseUpcs.includes(normalizedUpc(upc))) {
      return {
        confidenceScore: 72,
        matchType: "upc",
        response,
        score: 1,
      };
    }
  }

  if (!useNameSearch) {
    return null;
  }

  const response = await request({ q: priceChartingQuery(product) });

  if (!isPriceChartingSuccess(response) || !bestPriceChartingSealedPrice(response)) {
    return null;
  }

  const score = priceChartingNameScore(product, response);

  if (score < 0.72) {
    return null;
  }

  return {
    confidenceScore: score >= 0.9 ? 66 : 58,
    matchType: "name",
    response,
    score,
  };
}

export function bestPriceChartingSealedPrice(response) {
  const priceMinor = positiveInteger(response?.["new-price"], undefined);

  return priceMinor ? { field: "new-price", priceMinor } : null;
}

export function priceChartingNameScore(product, response) {
  const productName = String(response?.["product-name"] ?? "");
  const productType = product.productType ?? "OTHER";
  const localTokens = meaningfulTokens(product.name);
  const remoteTokens = meaningfulTokens(productName);

  if (!matchesProductType(productType, productName)) {
    return 0;
  }

  if (!localTokens.length || !remoteTokens.length) {
    return 0;
  }

  const remoteSet = new Set(remoteTokens);
  const overlap = localTokens.filter((token) => remoteSet.has(token)).length / localTokens.length;

  if (normalizedText(productName).includes(normalizedText(product.name))) {
    return Math.max(overlap, 0.95);
  }

  return overlap;
}

async function fetchPriceChartingProduct({ fetchImpl, params, token }) {
  const url = new URL(pricechartingBaseUrl);

  url.searchParams.set("t", token);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetchImpl(url);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`PriceCharting request failed with HTTP ${response.status}.`);
  }

  if (body.status === "error") {
    return body;
  }

  return body;
}

function isPriceChartingSuccess(response) {
  return response?.status === "success" && response.id && response["product-name"];
}

function priceChartingQuery(product) {
  return [
    product.name,
    product.relatedCardSet?.name,
    product.relatedCardSet?.series,
    "Pokemon",
  ]
    .filter(Boolean)
    .join(" ");
}

function productUpcs(product) {
  const providerIds = isObject(product.providerIds) ? product.providerIds : {};
  const metadata = isObject(product.metadata) ? product.metadata : {};

  return [
    ...upcValues(metadata.upc),
    ...upcValues(providerIds.upc),
    ...upcValues(providerIds.gtin),
  ];
}

function upcValues(value) {
  if (Array.isArray(value)) {
    return value.flatMap(upcValues);
  }

  const normalized = normalizedUpc(value);

  return normalized ? [normalized] : [];
}

function normalizedUpc(value) {
  return String(value ?? "").replace(/\D+/g, "");
}

function matchesProductType(productType, productName) {
  const needles = productTypeNeedles[productType] ?? [];
  const normalizedName = normalizedText(productName);

  return needles.length === 0 || needles.some((needle) => normalizedName.includes(normalizedText(needle)));
}

function meaningfulTokens(value) {
  return normalizedText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function normalizedText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function conversionRate(value) {
  const rate = Number(value);

  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

function nonNegativeInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

function stringSetting(value) {
  const string = String(value ?? "").trim();

  return string || undefined;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
