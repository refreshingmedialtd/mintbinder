import {
  ItemCondition,
  ItemType,
  PrismaClient,
  SealedProductType,
} from "@prisma/client";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import {
  bestTcgcsvPrice,
  deterministicUuid,
  extendedDataValue,
  isSealedProduct,
  matchTcgcsvGroupsToSets,
  sealedProductType,
  tcgcsvPokemonCategoryId,
  upgradedImageUrl,
} from "./tcgcsv-sealed-products.mjs";

export function sealedImportOptionsFromEnv(env = process.env) {
  return {
    groupIds: idList(env.TCGCSV_SEALED_GROUP_IDS),
    groupLimit: positiveInteger(env.TCGCSV_SEALED_GROUP_LIMIT, Number.POSITIVE_INFINITY),
    priceOnlyUnpriced: booleanSetting(env.TCGCSV_SEALED_PRICE_ONLY_UNPRICED, true),
    usdToGbpRate: conversionRate(env.TCGCSV_USD_TO_GBP_RATE) ?? conversionRate(env.POKEMON_TCG_USD_TO_GBP_RATE),
    writePrices: booleanSetting(env.TCGCSV_SEALED_WRITE_PRICES, true),
  };
}

export async function syncTcgcsvSealedProducts(options = {}) {
  const prisma = options.prisma ?? new PrismaClient();
  const shouldDisconnect = !options.prisma;
  const fetchImpl = options.fetchImpl ?? fetch;
  const groupIds = idSet(options.groupIds);
  const groupLimit = positiveInteger(options.groupLimit, Number.POSITIVE_INFINITY);
  const priceOnlyUnpriced = options.priceOnlyUnpriced ?? true;
  const waitMs = nonNegativeInteger(options.waitMs, 120);
  const writePrices = options.writePrices ?? true;
  const usdToGbp = conversionRate(options.usdToGbpRate);

  if (writePrices && !usdToGbp) {
    throw new Error("TCGCSV_USD_TO_GBP_RATE or POKEMON_TCG_USD_TO_GBP_RATE must be set for sealed pricing.");
  }

  try {
    const [groups, sets] = await Promise.all([
      fetchTcgcsv(`https://tcgcsv.com/tcgplayer/${tcgcsvPokemonCategoryId}/groups`, fetchImpl),
      prisma.cardSet.findMany({
        select: {
          id: true,
          name: true,
          providerIds: true,
        },
      }),
    ]);
    const availableMatches = matchTcgcsvGroupsToSets(groups.results ?? [], sets)
      .filter(({ group }) => groupIds.size === 0 || groupIds.has(String(group.groupId)));
    const matches = availableMatches.slice(0, groupLimit);
    const summary = {
      groupsAvailable: availableMatches.length,
      groupsMatched: matches.length,
      groupsProcessed: 0,
      priceOnlyUnpriced,
      pricingSnapshotsCreated: 0,
      productsFetched: 0,
      sealedProductsSkipped: 0,
      sealedProductsUpserted: 0,
      writePrices,
    };

    for (const match of matches) {
      const groupSummary = await importGroup({
        fetchImpl,
        match,
        priceOnlyUnpriced,
        prisma,
        usdToGbp,
        writePrices,
      });

      summary.groupsProcessed += 1;
      summary.pricingSnapshotsCreated += groupSummary.pricingSnapshotsCreated;
      summary.productsFetched += groupSummary.productsFetched;
      summary.sealedProductsSkipped += groupSummary.sealedProductsSkipped;
      summary.sealedProductsUpserted += groupSummary.sealedProductsUpserted;

      if (waitMs > 0) {
        await wait(waitMs);
      }
    }

    return summary;
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

async function importGroup({
  fetchImpl,
  match,
  priceOnlyUnpriced,
  prisma,
  usdToGbp,
  writePrices,
}) {
  const { group, set } = match;
  const [productsResponse, pricesResponse] = await Promise.all([
    fetchTcgcsv(`https://tcgcsv.com/tcgplayer/${tcgcsvPokemonCategoryId}/${group.groupId}/products`, fetchImpl),
    fetchTcgcsv(`https://tcgcsv.com/tcgplayer/${tcgcsvPokemonCategoryId}/${group.groupId}/prices`, fetchImpl),
  ]);
  const pricesByProductId = new Map();
  const summary = {
    pricingSnapshotsCreated: 0,
    productsFetched: productsResponse.results?.length ?? 0,
    sealedProductsSkipped: 0,
    sealedProductsUpserted: 0,
  };

  for (const price of pricesResponse.results ?? []) {
    const productPrices = pricesByProductId.get(price.productId) ?? [];

    productPrices.push(price);
    pricesByProductId.set(price.productId, productPrices);
  }

  for (const product of productsResponse.results ?? []) {
    if (!isSealedProduct(product)) {
      summary.sealedProductsSkipped += 1;
      continue;
    }

    const sealedProduct = await upsertSealedProduct({ group, product, prisma, set });

    summary.sealedProductsUpserted += 1;

    if (!writePrices || !usdToGbp || (priceOnlyUnpriced && await hasSealedPriceSnapshot(prisma, sealedProduct.id))) {
      continue;
    }

    const price = bestTcgcsvPrice(pricesByProductId.get(product.productId) ?? []);

    if (!price) {
      continue;
    }

    await prisma.priceSnapshot.create({
      data: {
        condition: ItemCondition.SEALED,
        confidenceScore: price.confidenceScore,
        currency: "GBP",
        itemType: ItemType.SEALED_PRODUCT,
        metadata: {
          conversionRate: usdToGbp,
          originalCurrency: "USD",
          originalPrice: price.usd,
          priceSource: "TCGCSV TCGplayer market",
          subTypeName: price.subTypeName,
        },
        observedAt: new Date(),
        priceMinor: Math.round(price.usd * usdToGbp * 100),
        sealedProductId: sealedProduct.id,
        source: "tcgcsv",
        sourceRef: String(product.productId),
        variantLabel: price.subTypeName ?? "Factory sealed",
      },
    });
    summary.pricingSnapshotsCreated += 1;
  }

  return summary;
}

async function upsertSealedProduct({ group, product, prisma, set }) {
  const id = deterministicUuid(`tcgcsv-sealed-product:${product.productId}`);
  const existing = await prisma.sealedProduct.findFirst({
    select: {
      id: true,
      providerIds: true,
    },
    where: {
      OR: [
        { id },
        {
          name: product.name,
          relatedCardSetId: set.id,
        },
      ],
    },
  });
  const sealedProductId = existing?.id ?? id;
  const providerIds = {
    ...(isObject(existing?.providerIds) ? existing.providerIds : {}),
    tcgcsv: String(product.productId),
    tcgplayer: String(product.productId),
  };
  const data = {
    imageUrl: upgradedImageUrl(product.imageUrl),
    metadata: {
      groupId: group.groupId,
      groupName: group.name,
      provider: "tcgcsv",
      providerUpdatedAt: product.modifiedOn,
      tcgplayerUrl: product.url,
      upc: extendedDataValue(product, "UPC"),
    },
    name: product.name,
    notes: undefined,
    productType: SealedProductType[sealedProductType(product.name)] ?? SealedProductType.OTHER,
    providerIds,
    relatedCardSetId: set.id,
    releaseDate: parseDate(product.presaleInfo?.releasedOn ?? group.publishedOn),
  };

  return prisma.sealedProduct.upsert({
    create: {
      id: sealedProductId,
      ...data,
    },
    update: data,
    where: { id: sealedProductId },
  });
}

async function fetchTcgcsv(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "user-agent": "MintBinderLocalImporter/0.1",
    },
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || !body.success) {
    throw new Error(`TCGCSV request failed for ${url}.`);
  }

  return body;
}

async function hasSealedPriceSnapshot(prisma, sealedProductId) {
  const snapshot = await prisma.priceSnapshot.findFirst({
    select: { id: true },
    where: {
      itemType: ItemType.SEALED_PRODUCT,
      sealedProductId,
    },
  });

  return Boolean(snapshot);
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

function idList(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function idSet(value) {
  return new Set(Array.isArray(value) ? value.map(String) : idList(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDate(value) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
