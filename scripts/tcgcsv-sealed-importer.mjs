import {
  ItemCondition,
  ItemType,
  PrismaClient,
  SealedProductType,
} from "@prisma/client";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import { fetchJsonWithRetry } from "./provider-fetch.mjs";
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
    apiRetryAttempts: positiveInteger(env.TCGCSV_API_RETRY_ATTEMPTS, 3),
    apiRetryWaitMs: nonNegativeInteger(env.TCGCSV_API_RETRY_WAIT_MS, 500),
    apiTimeoutMs: positiveInteger(env.TCGCSV_API_TIMEOUT_MS, 10_000),
    groupIds: idList(env.TCGCSV_SEALED_GROUP_IDS),
    groupLimit: positiveInteger(env.TCGCSV_SEALED_GROUP_LIMIT, Number.POSITIVE_INFINITY),
    priceOnlyUnpriced: booleanSetting(env.TCGCSV_SEALED_PRICE_ONLY_UNPRICED, true),
    productLimit: positiveInteger(env.TCGCSV_SEALED_PRODUCT_LIMIT, Number.POSITIVE_INFINITY),
    usdToGbpRate: conversionRate(env.TCGCSV_USD_TO_GBP_RATE) ?? conversionRate(env.POKEMON_TCG_USD_TO_GBP_RATE),
    writePrices: booleanSetting(env.TCGCSV_SEALED_WRITE_PRICES, true),
  };
}

export async function syncTcgcsvSealedProducts(options = {}) {
  const prisma = options.prisma ?? new PrismaClient();
  const shouldDisconnect = !options.prisma;
  const fetchImpl = options.fetchImpl ?? fetch;
  const providerFetchOptions = {
    retryAttempts: positiveInteger(options.apiRetryAttempts, 3),
    retryWaitMs: nonNegativeInteger(options.apiRetryWaitMs, 500),
    timeoutMs: positiveInteger(options.apiTimeoutMs, 10_000),
  };
  const groupIds = idSet(options.groupIds);
  const groupLimit = positiveInteger(options.groupLimit, Number.POSITIVE_INFINITY);
  const priceOnlyUnpriced = options.priceOnlyUnpriced ?? true;
  const productLimit = positiveInteger(options.productLimit, Number.POSITIVE_INFINITY);
  const waitMs = nonNegativeInteger(options.waitMs, 120);
  const writePrices = options.writePrices ?? true;
  const usdToGbp = conversionRate(options.usdToGbpRate);

  if (writePrices && !usdToGbp) {
    throw new Error("TCGCSV_USD_TO_GBP_RATE or POKEMON_TCG_USD_TO_GBP_RATE must be set for sealed pricing.");
  }

  try {
    const [groups, sets] = await Promise.all([
      fetchTcgcsv(`https://tcgcsv.com/tcgplayer/${tcgcsvPokemonCategoryId}/groups`, fetchImpl, providerFetchOptions),
      prisma.cardSet.findMany({
        select: {
          id: true,
          metadata: true,
          name: true,
          providerIds: true,
          sealedProducts: {
            where: { collectionItems: { some: { archivedAt: null } } },
            select: {
              priceSnapshots: {
                where: { source: "tcgcsv" },
                orderBy: { observedAt: "desc" },
                take: 1,
                select: { observedAt: true },
              },
            },
          },
        },
      }),
    ]);
    const matchedGroups = matchTcgcsvGroupsToSets(groups.results ?? [], sets)
      .filter(({ group, set }) =>
        (groupIds.size === 0 || groupIds.has(String(group.groupId))) &&
        !sealedPricingRetryInFuture(set.metadata)
      );
    const deferredKnownEmptyGroups = groupIds.size === 0
      ? matchedGroups.filter(({ set }) => sealedPricingEmptyInFuture(set.metadata))
      : [];
    const availableMatches = orderSealedPricingMatches(
      matchedGroups.filter(({ set }) =>
        groupIds.size > 0 || !sealedPricingEmptyInFuture(set.metadata)
      ),
    );
    const matches = availableMatches.slice(0, groupLimit);
    const summary = {
      failedGroups: 0,
      groupResults: [],
      groupsAvailable: availableMatches.length,
      groupsDeferredKnownEmpty: deferredKnownEmptyGroups.length,
      groupsMatched: matches.length,
      groupsProcessed: 0,
      priceOnlyUnpriced,
      productLimit: Number.isFinite(productLimit) ? productLimit : null,
      productsProcessed: 0,
      pricingSnapshotsCreated: 0,
      pricingSnapshotsUpdated: 0,
      productsFetched: 0,
      sealedProductsSkipped: 0,
      sealedProductsUpserted: 0,
      warning: null,
      writePrices,
    };

    for (const match of matches) {
      try {
        const groupSummary = await importGroup({
          fetchImpl,
          match,
          priceOnlyUnpriced,
          prisma,
          providerFetchOptions,
          productLimit,
          usdToGbp,
          writePrices,
        });

        await recordSealedPricingProgress({
          groupSummary,
          match,
          prisma,
          productLimit,
        });

        summary.groupsProcessed += 1;
        summary.productsProcessed += groupSummary.productsProcessed;
        summary.pricingSnapshotsCreated += groupSummary.pricingSnapshotsCreated;
        summary.pricingSnapshotsUpdated += groupSummary.pricingSnapshotsUpdated;
        summary.productsFetched += groupSummary.productsFetched;
        summary.sealedProductsSkipped += groupSummary.sealedProductsSkipped;
        summary.sealedProductsUpserted += groupSummary.sealedProductsUpserted;
        summary.groupResults.push({
          complete: groupSummary.complete,
          groupId: String(match.group.groupId),
          groupName: match.group.name,
          nextProductIndex: groupSummary.nextProductIndex,
          pricingSnapshotsCreated: groupSummary.pricingSnapshotsCreated,
          pricingSnapshotsUpdated: groupSummary.pricingSnapshotsUpdated,
          productsFetched: groupSummary.productsFetched,
          productsProcessed: groupSummary.productsProcessed,
          sealedProductsAvailable: groupSummary.sealedProductsAvailable,
          sealedProductsUpserted: groupSummary.sealedProductsUpserted,
          setId: match.set.id,
          setName: match.set.name,
          status: "succeeded",
        });
      } catch (error) {
        if (!isSkippableSealedGroupError(error)) {
          throw error;
        }

        const message = error instanceof Error ? error.message : "Sealed group import failed.";

        await recordSealedPricingAttempt({
          errorMessage: message,
          match,
          prisma,
        });

        summary.failedGroups += 1;
        summary.groupResults.push({
          error: message,
          groupId: String(match.group.groupId),
          groupName: match.group.name,
          setId: match.set.id,
          setName: match.set.name,
          status: "failed",
        });
      }

      if (waitMs > 0) {
        await wait(waitMs);
      }
    }

    if (summary.failedGroups) {
      summary.warning = `Sealed pricing completed with ${summary.failedGroups} failed group(s).`;
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
  providerFetchOptions,
  productLimit,
  usdToGbp,
  writePrices,
}) {
  const { group, set } = match;
  const [productsResponse, pricesResponse] = await Promise.all([
    fetchTcgcsv(`https://tcgcsv.com/tcgplayer/${tcgcsvPokemonCategoryId}/${group.groupId}/products`, fetchImpl, providerFetchOptions),
    fetchTcgcsv(`https://tcgcsv.com/tcgplayer/${tcgcsvPokemonCategoryId}/${group.groupId}/prices`, fetchImpl, providerFetchOptions),
  ]);
  const pricesByProductId = new Map();
  const products = productsResponse.results ?? [];
  const productBatch = selectSealedProductBatch({
    metadata: set.metadata,
    productLimit,
    products,
  });
  const summary = {
    complete: productBatch.complete,
    nextProductIndex: productBatch.nextProductIndex,
    productBatchEndIndex: productBatch.endIndex,
    productBatchStartIndex: productBatch.startIndex,
    productLimit: Number.isFinite(productLimit) ? productLimit : null,
    productsProcessed: productBatch.products.length,
    pricingSnapshotsCreated: 0,
    pricingSnapshotsUpdated: 0,
    productsFetched: products.length,
    sealedProductsAvailable: productBatch.sealedProductsAvailable,
    sealedProductsSkipped: productBatch.sealedProductsSkipped,
    sealedProductsUpserted: 0,
  };

  for (const price of pricesResponse.results ?? []) {
    const productPrices = pricesByProductId.get(price.productId) ?? [];

    productPrices.push(price);
    pricesByProductId.set(price.productId, productPrices);
  }

  for (const product of productBatch.products) {
    const sealedProduct = await upsertSealedProduct({ group, product, prisma, set });

    summary.sealedProductsUpserted += 1;

    if (!writePrices || !usdToGbp || (priceOnlyUnpriced && await hasSealedPriceSnapshot(prisma, sealedProduct.id))) {
      continue;
    }

    const price = bestTcgcsvPrice(pricesByProductId.get(product.productId) ?? []);

    if (!price) {
      continue;
    }

    const snapshotResult = await writeDailySealedPriceSnapshot({
      prisma,
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
    summary.pricingSnapshotsCreated += snapshotResult === "created" ? 1 : 0;
    summary.pricingSnapshotsUpdated += snapshotResult === "updated" ? 1 : 0;
  }

  return summary;
}

async function recordSealedPricingProgress({
  groupSummary,
  match,
  prisma,
  productLimit,
}) {
  const attemptedAt = new Date().toISOString();
  await updateCardSetMetadata(prisma, match.set, {
    scheduledSealedPricingGroupId: String(match.group.groupId),
    scheduledSealedPricingLastAttemptAt: attemptedAt,
    scheduledSealedPricingLastError: null,
    scheduledSealedPricingLastProductIndex: groupSummary.productBatchStartIndex,
    scheduledSealedPricingLastProductLimit: Number.isFinite(productLimit) ? productLimit : null,
    scheduledSealedPricingLastSnapshotCount: groupSummary.pricingSnapshotsCreated,
    scheduledSealedPricingLastSnapshotUpdateCount: groupSummary.pricingSnapshotsUpdated,
    scheduledSealedPricingLastSucceededAt: attemptedAt,
    scheduledSealedPricingLastSealedProductCount: groupSummary.sealedProductsAvailable,
    scheduledSealedPricingLastTotalProducts: groupSummary.productsFetched,
    scheduledSealedPricingCursorVersion: 2,
    scheduledSealedPricingNextProductIndex: groupSummary.nextProductIndex,
    scheduledSealedPricingEmptyUntil: groupSummary.complete && groupSummary.sealedProductsAvailable === 0
      ? new Date(Date.parse(attemptedAt) + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null,
    scheduledSealedPricingRetryAfter: null,
  });
}

async function recordSealedPricingAttempt({
  errorMessage,
  match,
  prisma,
}) {
  const attemptedAt = new Date().toISOString();
  const status = providerErrorStatus(errorMessage);
  await updateCardSetMetadata(prisma, match.set, {
    scheduledSealedPricingGroupId: String(match.group.groupId),
    scheduledSealedPricingLastAttemptAt: attemptedAt,
    scheduledSealedPricingLastError: errorMessage,
    scheduledSealedPricingLastErrorStatus: status,
    scheduledSealedPricingRetryAfter: retryAfterForProviderStatus(status, attemptedAt),
  });
}

async function updateCardSetMetadata(prisma, set, patch) {
  const metadata = {
    ...(isObject(set.metadata) ? set.metadata : {}),
    ...patch,
  };

  await prisma.cardSet.update({
    data: { metadata },
    where: { id: set.id },
  });

  set.metadata = metadata;
}

async function upsertSealedProduct({ group, product, prisma, set }) {
  const id = deterministicUuid(`tcgcsv-sealed-product:${product.productId}`);
  const existing = await prisma.sealedProduct.findFirst({
    select: {
      id: true,
      metadata: true,
      providerIds: true,
    },
    where: {
      createdByUserId: null,
      visibility: "GLOBAL",
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
    createdByUserId: null,
    imageUrl: upgradedImageUrl(product.imageUrl),
    metadata: {
      ...(isObject(existing?.metadata) ? existing.metadata : {}),
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
    visibility: "GLOBAL",
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

async function fetchTcgcsv(url, fetchImpl, providerFetchOptions) {
  const result = await fetchJsonWithRetry({
    fetchImpl,
    init: {
      headers: {
        accept: "application/json",
        "user-agent": "MintBinderLocalImporter/0.1",
      },
    },
    maxResponseBytes: 32 * 1024 * 1024,
    provider: "TCGCSV",
    retryAttempts: providerFetchOptions.retryAttempts,
    retryInvalidResponse: true,
    retryWaitMs: providerFetchOptions.retryWaitMs,
    timeoutMs: providerFetchOptions.timeoutMs,
    url,
    validate: (body) => body?.success === true,
  });

  return result.body;
}

export function orderSealedPricingMatches(matches) {
  return [...matches].sort((left, right) =>
    sealedOwnedRefreshPriority(left.set) - sealedOwnedRefreshPriority(right.set) ||
    sealedPricingCursorPriority(left.set.metadata) - sealedPricingCursorPriority(right.set.metadata) ||
    sealedPricingLastAttemptMs(left.set.metadata) - sealedPricingLastAttemptMs(right.set.metadata) ||
    String(left.group.name ?? "").localeCompare(String(right.group.name ?? "")) ||
    String(left.group.groupId ?? "").localeCompare(String(right.group.groupId ?? "")),
  );
}

function sealedOwnedRefreshPriority(set) {
  const ownedProducts = Array.isArray(set.sealedProducts) ? set.sealedProducts : [];

  if (!ownedProducts.length) {
    return 1;
  }

  const oldestLatest = ownedProducts.reduce((oldestMs, product) => {
    const observedAt = product.priceSnapshots?.[0]?.observedAt;
    const observedMs = observedAt ? new Date(observedAt).getTime() : 0;

    return Math.min(oldestMs, Number.isFinite(observedMs) ? observedMs : 0);
  }, Number.POSITIVE_INFINITY);

  return oldestLatest < Date.now() - 20 * 60 * 60 * 1000 ? 0 : 1;
}

function sealedPricingCursorPriority(metadata) {
  return sealedPricingNextProductIndex(metadata) > 0 ? 0 : 1;
}

function sealedPricingLastAttemptMs(metadata) {
  const value = isObject(metadata) ? metadata.scheduledSealedPricingLastAttemptAt : null;
  const ms = value ? Date.parse(String(value)) : 0;

  return Number.isFinite(ms) ? ms : 0;
}

function sealedPricingRetryInFuture(metadata) {
  const value = isObject(metadata) ? metadata.scheduledSealedPricingRetryAfter : null;
  const ms = value ? Date.parse(String(value)) : NaN;

  return Number.isFinite(ms) && ms > Date.now();
}

function sealedPricingEmptyInFuture(metadata) {
  const value = isObject(metadata) ? metadata.scheduledSealedPricingEmptyUntil : null;
  const ms = value ? Date.parse(String(value)) : NaN;

  return Number.isFinite(ms) && ms > Date.now();
}

function sealedPricingNextProductIndex(metadata, productCount = Number.POSITIVE_INFINITY) {
  if (!isObject(metadata) || metadata.scheduledSealedPricingCursorVersion !== 2) {
    return 0;
  }

  const value = isObject(metadata) ? metadata.scheduledSealedPricingNextProductIndex : undefined;
  const index = nonNegativeInteger(value, 0);

  if (!Number.isFinite(productCount)) {
    return index;
  }

  if (productCount <= 0) {
    return 0;
  }

  return Math.min(index, productCount - 1);
}

function selectProductBatch({ productLimit, products, startIndex }) {
  const limit = Number.isFinite(productLimit) ? productLimit : products.length;
  const normalizedStart = products.length ? Math.min(startIndex, products.length - 1) : 0;
  const endIndex = Math.min(products.length, normalizedStart + limit);
  const nextProductIndex = endIndex >= products.length ? 0 : endIndex;

  return {
    complete: nextProductIndex === 0,
    endIndex,
    nextProductIndex,
    products: products.slice(normalizedStart, endIndex),
    startIndex: normalizedStart,
  };
}

export function selectSealedProductBatch({ metadata, productLimit, products }) {
  const sealedProducts = products.filter(isSealedProduct);

  return {
    ...selectProductBatch({
      productLimit,
      products: sealedProducts,
      startIndex: sealedPricingNextProductIndex(metadata, sealedProducts.length),
    }),
    sealedProductsAvailable: sealedProducts.length,
    sealedProductsSkipped: products.length - sealedProducts.length,
  };
}

function providerErrorStatus(message) {
  const match = message.match(/\b(4\d\d|5\d\d)\b/);

  return match ? Number(match[1]) : undefined;
}

function retryAfterForProviderStatus(status, attemptedAt) {
  if (status !== 404) {
    return null;
  }

  return new Date(Date.parse(attemptedAt) + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function isSkippableSealedGroupError(error) {
  if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) {
    return true;
  }

  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return true;
  }

  return error instanceof Error && /TCGCSV request failed/i.test(error.message);
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

async function writeDailySealedPriceSnapshot({ data, prisma }) {
  const observedAt = data.observedAt instanceof Date ? data.observedAt : new Date(data.observedAt);
  const dayStart = new Date(Date.UTC(
    observedAt.getUTCFullYear(),
    observedAt.getUTCMonth(),
    observedAt.getUTCDate(),
  ));
  const nextDay = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const existing = await prisma.priceSnapshot.findFirst({
    select: { id: true },
    where: {
      itemType: data.itemType,
      observedAt: { gte: dayStart, lt: nextDay },
      sealedProductId: data.sealedProductId,
      source: data.source,
      sourceRef: data.sourceRef,
      variantLabel: data.variantLabel,
    },
  });

  if (existing) {
    await prisma.priceSnapshot.update({ data, where: { id: existing.id } });
    return "updated";
  }

  await prisma.priceSnapshot.create({ data });
  return "created";
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
