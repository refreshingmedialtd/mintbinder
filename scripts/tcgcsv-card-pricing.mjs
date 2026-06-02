import {
  ItemCondition,
  ItemType,
  PrismaClient,
} from "@prisma/client";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import {
  bestTcgcsvPrice,
  extendedDataValue,
  isSealedProduct,
  matchTcgcsvGroupsToSets,
  tcgcsvPokemonCategoryId,
} from "./tcgcsv-sealed-products.mjs";

export function cardPricingOptionsFromEnv(env = process.env) {
  return {
    groupIds: idList(env.TCGCSV_CARD_GROUP_IDS),
    groupLimit: positiveInteger(env.TCGCSV_CARD_GROUP_LIMIT, Number.POSITIVE_INFINITY),
    priceOnlyUnpriced: booleanSetting(env.TCGCSV_CARD_PRICE_ONLY_UNPRICED, true),
    usdToGbpRate: conversionRate(env.TCGCSV_USD_TO_GBP_RATE) ?? conversionRate(env.POKEMON_TCG_USD_TO_GBP_RATE),
    writePrices: booleanSetting(env.TCGCSV_CARD_WRITE_PRICES, true),
  };
}

export async function syncTcgcsvCardPrices(options = {}) {
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
    throw new Error("TCGCSV_USD_TO_GBP_RATE or POKEMON_TCG_USD_TO_GBP_RATE must be set for card pricing.");
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
      cardProductsMatched: 0,
      cardProductsSkipped: 0,
      cardProductsUnmatched: 0,
      groupsAvailable: availableMatches.length,
      groupsMatched: matches.length,
      groupsProcessed: 0,
      priceOnlyUnpriced,
      pricingSnapshotsCreated: 0,
      productsFetched: 0,
      sampleUnmatchedProducts: [],
      writePrices,
    };

    for (const match of matches) {
      const groupSummary = await importCardGroup({
        fetchImpl,
        match,
        priceOnlyUnpriced,
        prisma,
        usdToGbp,
        writePrices,
      });

      summary.cardProductsMatched += groupSummary.cardProductsMatched;
      summary.cardProductsSkipped += groupSummary.cardProductsSkipped;
      summary.cardProductsUnmatched += groupSummary.cardProductsUnmatched;
      summary.groupsProcessed += 1;
      summary.pricingSnapshotsCreated += groupSummary.pricingSnapshotsCreated;
      summary.productsFetched += groupSummary.productsFetched;
      summary.sampleUnmatchedProducts.push(...groupSummary.sampleUnmatchedProducts);
      summary.sampleUnmatchedProducts = summary.sampleUnmatchedProducts.slice(0, 10);

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

export function matchTcgcsvCardProduct(product, cards) {
  const productNumber = normalizedCardNumber(extendedDataValue(product, "Number"));
  const productName = normalizedCardName(product.name);
  const byNumberAndName = cards.filter((card) =>
    normalizedCardNumber(card.number) === productNumber &&
    normalizedCardName(card.name) === productName);

  if (byNumberAndName.length === 1) {
    return byNumberAndName[0];
  }

  if (productNumber) {
    const byNumber = cards.filter((card) => normalizedCardNumber(card.number) === productNumber);

    if (byNumber.length === 1) {
      return byNumber[0];
    }
  }

  const byName = cards.filter((card) => normalizedCardName(card.name) === productName);

  return byName.length === 1 ? byName[0] : null;
}

export function isCardProduct(product) {
  if (!product || isSealedProduct(product)) {
    return false;
  }

  const name = String(product.name ?? "").toLowerCase();

  if (name.includes("code card") || name.includes("digital")) {
    return false;
  }

  return Boolean(extendedDataValue(product, "Number") || extendedDataValue(product, "Rarity"));
}

async function importCardGroup({
  fetchImpl,
  match,
  priceOnlyUnpriced,
  prisma,
  usdToGbp,
  writePrices,
}) {
  const { group, set } = match;
  const [productsResponse, pricesResponse, cards] = await Promise.all([
    fetchTcgcsv(`https://tcgcsv.com/tcgplayer/${tcgcsvPokemonCategoryId}/${group.groupId}/products`, fetchImpl),
    fetchTcgcsv(`https://tcgcsv.com/tcgplayer/${tcgcsvPokemonCategoryId}/${group.groupId}/prices`, fetchImpl),
    prisma.cardPrinting.findMany({
      select: {
        id: true,
        name: true,
        number: true,
      },
      where: {
        cardSetId: set.id,
      },
    }),
  ]);
  const pricesByProductId = new Map();
  const summary = {
    cardProductsMatched: 0,
    cardProductsSkipped: 0,
    cardProductsUnmatched: 0,
    pricingSnapshotsCreated: 0,
    productsFetched: productsResponse.results?.length ?? 0,
    sampleUnmatchedProducts: [],
  };

  for (const price of pricesResponse.results ?? []) {
    const productPrices = pricesByProductId.get(price.productId) ?? [];

    productPrices.push(price);
    pricesByProductId.set(price.productId, productPrices);
  }

  for (const product of productsResponse.results ?? []) {
    if (!isCardProduct(product)) {
      summary.cardProductsSkipped += 1;
      continue;
    }

    const card = matchTcgcsvCardProduct(product, cards);

    if (!card) {
      summary.cardProductsUnmatched += 1;
      summary.sampleUnmatchedProducts.push({
        groupId: group.groupId,
        name: product.name,
        number: extendedDataValue(product, "Number") ?? null,
        productId: product.productId,
      });
      summary.sampleUnmatchedProducts = summary.sampleUnmatchedProducts.slice(0, 10);
      continue;
    }

    summary.cardProductsMatched += 1;

    if (!writePrices || !usdToGbp || (priceOnlyUnpriced && await hasCardPriceSnapshot(prisma, card.id))) {
      continue;
    }

    const price = bestTcgcsvPrice(pricesByProductId.get(product.productId) ?? []);

    if (!price) {
      continue;
    }

    await prisma.priceSnapshot.create({
      data: {
        cardPrintingId: card.id,
        condition: ItemCondition.NEAR_MINT,
        confidenceScore: price.confidenceScore,
        currency: "GBP",
        itemType: ItemType.CARD,
        language: "en",
        metadata: {
          conversionRate: usdToGbp,
          groupId: group.groupId,
          groupName: group.name,
          originalCurrency: "USD",
          originalPrice: price.usd,
          priceSource: "TCGCSV TCGplayer market",
          subTypeName: price.subTypeName,
          tcgplayerUrl: product.url,
        },
        observedAt: new Date(),
        priceMinor: Math.round(price.usd * usdToGbp * 100),
        source: "tcgcsv-card",
        sourceRef: String(product.productId),
        variantLabel: price.subTypeName ?? "Normal",
      },
    });
    summary.pricingSnapshotsCreated += 1;
  }

  return summary;
}

async function fetchTcgcsv(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "user-agent": "PokeStopLocalImporter/0.1",
    },
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || !body.success) {
    throw new Error(`TCGCSV request failed for ${url}.`);
  }

  return body;
}

async function hasCardPriceSnapshot(prisma, cardPrintingId) {
  const snapshot = await prisma.priceSnapshot.findFirst({
    select: { id: true },
    where: {
      cardPrintingId,
      itemType: ItemType.CARD,
    },
  });

  return Boolean(snapshot);
}

function normalizedCardNumber(value) {
  return String(value ?? "")
    .toLowerCase()
    .split("/")[0]
    .replace(/^#/, "")
    .replace(/[^a-z0-9]+/g, "")
    .replace(/^([a-z]+)0+(?=\d)/, "$1")
    .replace(/^0+(?=\d)/, "");
}

function normalizedCardName(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

function idList(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function idSet(value) {
  return new Set(Array.isArray(value) ? value.map(String) : idList(value));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
