import {
  ItemCondition,
  ItemType,
  PrismaClient,
} from "@prisma/client";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import { groupDisplayName, normalizedSetName } from "./tcgcsv-sealed-products.mjs";

const cardTraderBaseUrl = "https://api.cardtrader.com/api/v2";
const sourceName = "cardtrader-sealed";

export function cardTraderSealedOptionsFromEnv(env = process.env) {
  const token = stringSetting(env.CARDTRADER_API_TOKEN ?? env.CARDTRADER_TOKEN);

  return {
    enabled: booleanSetting(env.CARDTRADER_SEALED_ENABLED, Boolean(token)),
    eurToGbpRate: conversionRate(env.CARDTRADER_EUR_TO_GBP_RATE) ??
      conversionRate(env.POKEMON_TCG_EUR_TO_GBP_RATE),
    limit: positiveInteger(env.CARDTRADER_SEALED_PRODUCT_LIMIT, 5),
    priceOnlyUnpriced: booleanSetting(env.CARDTRADER_SEALED_PRICE_ONLY_UNPRICED, false),
    setLimit: positiveInteger(env.CARDTRADER_SEALED_SET_LIMIT, 1),
    token,
    usdToGbpRate: conversionRate(env.CARDTRADER_USD_TO_GBP_RATE) ??
      conversionRate(env.TCGCSV_USD_TO_GBP_RATE) ??
      conversionRate(env.POKEMON_TCG_USD_TO_GBP_RATE),
    waitMs: nonNegativeInteger(env.CARDTRADER_SEALED_WAIT_MS, 150),
    writePrices: booleanSetting(env.CARDTRADER_SEALED_WRITE_PRICES, true),
  };
}

export async function syncCardTraderSealedPrices(options = {}) {
  const prisma = options.prisma ?? new PrismaClient();
  const shouldDisconnect = !options.prisma;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = positiveInteger(options.limit, 5);
  const priceOnlyUnpriced = options.priceOnlyUnpriced ?? false;
  const setLimit = positiveInteger(options.setLimit, 1);
  const token = stringSetting(options.token);
  const waitMs = nonNegativeInteger(options.waitMs, 150);
  const writePrices = options.writePrices ?? true;
  const rates = {
    EUR: conversionRate(options.eurToGbpRate),
    GBP: 1,
    USD: conversionRate(options.usdToGbpRate),
  };
  const summary = {
    apiRequests: 0,
    blueprintsMatched: 0,
    candidatesAvailable: 0,
    candidatesChecked: 0,
    candidatesUnmatched: 0,
    listingOffersUsed: 0,
    priceOnlyUnpriced,
    pricingSnapshotsCreated: 0,
    pricingSnapshotsUpdated: 0,
    provider: sourceName,
    sampleUnmatchedProducts: [],
    setsChecked: 0,
    setsUnmatched: 0,
    status: "succeeded",
    writePrices,
  };

  if (!token) {
    throw new Error("CARDTRADER_API_TOKEN must be set for CardTrader sealed pricing.");
  }

  try {
    const products = await prisma.sealedProduct.findMany({
      select: {
        id: true,
        metadata: true,
        name: true,
        productType: true,
        providerIds: true,
        relatedCardSet: {
          select: {
            id: true,
            name: true,
          },
        },
        priceSnapshots: {
          orderBy: { observedAt: "desc" },
          select: { observedAt: true },
          take: 1,
          where: { source: sourceName },
        },
      },
      where: priceOnlyUnpriced ? {
        priceSnapshots: {
          none: { itemType: ItemType.SEALED_PRODUCT },
        },
      } : undefined,
    });
    const candidates = products
      .filter((product) => product.relatedCardSet?.id && tcgplayerProductId(product))
      .sort(compareCandidates);
    const selectedCandidates = selectCandidateSets(candidates, { limit, setLimit });

    summary.candidatesAvailable = candidates.length;

    if (!selectedCandidates.length) {
      return summary;
    }

    const request = async (path, params = {}) => {
      if (summary.apiRequests > 0 && waitMs > 0) {
        await wait(waitMs);
      }

      summary.apiRequests += 1;

      return fetchCardTrader({ fetchImpl, params, path, token });
    };
    const [games, expansions] = await Promise.all([
      request("/games"),
      request("/expansions"),
    ]);
    const pokemonGame = asArray(games).find((game) =>
      normalizedText(game.name ?? game.display_name) === "pokemon"
    );

    if (!pokemonGame?.id) {
      throw new Error("CardTrader did not return a Pokemon game identifier.");
    }

    const pokemonExpansions = asArray(expansions).filter((expansion) =>
      String(expansion.game_id) === String(pokemonGame.id)
    );
    const bySet = groupBy(selectedCandidates, (product) => product.relatedCardSet.id);

    for (const setCandidates of bySet.values()) {
      const set = setCandidates[0].relatedCardSet;
      const expansion = matchCardTraderExpansion(setCandidates, pokemonExpansions);

      summary.setsChecked += 1;

      if (!expansion) {
        summary.setsUnmatched += 1;

        for (const product of setCandidates) {
          summary.candidatesChecked += 1;
          summary.candidatesUnmatched += 1;
          await recordCardTraderAttempt(prisma, product, {
            error: `No CardTrader expansion matched ${set.name}.`,
          });
          addUnmatchedSample(summary, product, "expansion");
        }

        continue;
      }

      const blueprints = asArray(await request("/blueprints/export", {
        expansion_id: expansion.id,
      }));
      const blueprintByTcgplayerId = new Map(
        blueprints
          .filter((blueprint) => blueprint.tcg_player_id)
          .map((blueprint) => [String(blueprint.tcg_player_id), blueprint]),
      );

      for (const product of setCandidates) {
        summary.candidatesChecked += 1;
        const tcgplayerId = tcgplayerProductId(product);
        const blueprint = blueprintByTcgplayerId.get(tcgplayerId);

        if (!blueprint) {
          summary.candidatesUnmatched += 1;
          await recordCardTraderAttempt(prisma, product, {
            error: `No CardTrader blueprint carried TCGplayer ID ${tcgplayerId}.`,
            expansion,
          });
          addUnmatchedSample(summary, product, "blueprint");
          continue;
        }

        summary.blueprintsMatched += 1;
        const marketplace = await request("/marketplace/products", {
          blueprint_id: blueprint.id,
          language: "en",
        });
        const marketPrice = cardTraderMarketplacePrice(marketplace, rates);

        if (!marketPrice) {
          summary.candidatesUnmatched += 1;
          await recordCardTraderAttempt(prisma, product, {
            blueprint,
            error: "No eligible CardTrader sealed listings had a supported GBP, EUR, or USD price.",
            expansion,
          });
          addUnmatchedSample(summary, product, "listings");
          continue;
        }

        summary.listingOffersUsed += marketPrice.offerCount;
        await recordCardTraderAttempt(prisma, product, {
          blueprint,
          expansion,
          listingCount: marketPrice.listingCount,
          matched: true,
        });

        if (!writePrices) {
          continue;
        }

        const snapshotResult = await writeDailySnapshot(prisma, {
          condition: ItemCondition.SEALED,
          confidenceScore: marketPrice.confidenceScore,
          currency: "GBP",
          itemType: ItemType.SEALED_PRODUCT,
          metadata: {
            aggregation: "median of the five lowest eligible listings",
            blueprintName: blueprint.name,
            cardTraderExpansionId: String(expansion.id),
            cardTraderExpansionName: expansion.name,
            convertedPriceSamplesMinor: marketPrice.samplePricesMinor,
            listingCount: marketPrice.listingCount,
            offerCountUsed: marketPrice.offerCount,
            originalCurrencies: marketPrice.currencies,
            priceSource: "CardTrader European marketplace listings",
            tcgplayerProductId: tcgplayerId,
          },
          observedAt: new Date(),
          priceMinor: marketPrice.priceMinor,
          sealedProductId: product.id,
          source: sourceName,
          sourceRef: String(blueprint.id),
          variantLabel: "Unopened / sealed",
        });
        summary.pricingSnapshotsCreated += snapshotResult === "created" ? 1 : 0;
        summary.pricingSnapshotsUpdated += snapshotResult === "updated" ? 1 : 0;
      }
    }

    return summary;
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

export function cardTraderMarketplacePrice(response, rates = {}) {
  const offers = Object.values(isObject(response) ? response : {})
    .flatMap((value) => asArray(value))
    .filter((offer) =>
      !offer.graded &&
      !offer.on_vacation &&
      Number(offer.quantity ?? 0) > 0
    );
  const converted = offers
    .map((offer) => convertedListingPrice(offer, rates))
    .filter(Boolean)
    .sort((left, right) => left.priceMinor - right.priceMinor);

  if (!converted.length) {
    return null;
  }

  const sample = converted.slice(0, 5);

  return {
    confidenceScore: sample.length >= 5 ? 64 : sample.length >= 3 ? 60 : sample.length === 2 ? 54 : 46,
    currencies: [...new Set(sample.map((offer) => offer.currency))],
    listingCount: converted.length,
    offerCount: sample.length,
    priceMinor: median(sample.map((offer) => offer.priceMinor)),
    samplePricesMinor: sample.map((offer) => offer.priceMinor),
  };
}

export function matchCardTraderExpansion(products, expansions) {
  const names = new Set(products.flatMap((product) => [
    product.relatedCardSet?.name,
    isObject(product.metadata) ? product.metadata.groupName : undefined,
  ]).filter(Boolean).map(normalizedExpansionName));

  return expansions.find((expansion) => names.has(normalizedExpansionName(expansion.name)));
}

function selectCandidateSets(candidates, { limit, setLimit }) {
  const selected = [];
  const selectedSetIds = new Set();

  for (const candidate of candidates) {
    const setId = candidate.relatedCardSet.id;

    if (!selectedSetIds.has(setId) && selectedSetIds.size >= setLimit) {
      continue;
    }

    selectedSetIds.add(setId);
    selected.push(candidate);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function compareCandidates(left, right) {
  return cardTraderAttemptMs(left) - cardTraderAttemptMs(right) ||
    latestCardTraderPriceMs(left) - latestCardTraderPriceMs(right) ||
    left.name.localeCompare(right.name);
}

function cardTraderAttemptMs(product) {
  const value = isObject(product.metadata) ? product.metadata.cardTraderLastAttemptAt : undefined;
  const ms = value ? Date.parse(String(value)) : 0;

  return Number.isFinite(ms) ? ms : 0;
}

function latestCardTraderPriceMs(product) {
  const value = product.priceSnapshots?.[0]?.observedAt;
  const ms = value ? new Date(value).getTime() : 0;

  return Number.isFinite(ms) ? ms : 0;
}

async function recordCardTraderAttempt(prisma, product, {
  blueprint,
  error = null,
  expansion,
  listingCount = 0,
  matched = false,
}) {
  const attemptedAt = new Date().toISOString();
  const metadata = {
    ...(isObject(product.metadata) ? product.metadata : {}),
    cardTraderBlueprintId: blueprint?.id
      ? String(blueprint.id)
      : product.metadata?.cardTraderBlueprintId ?? null,
    cardTraderExpansionId: expansion?.id
      ? String(expansion.id)
      : product.metadata?.cardTraderExpansionId ?? null,
    cardTraderLastAttemptAt: attemptedAt,
    cardTraderLastError: error,
    cardTraderLastListingCount: listingCount,
    cardTraderLastMatchedAt: matched
      ? attemptedAt
      : product.metadata?.cardTraderLastMatchedAt ?? null,
  };
  const providerIds = {
    ...(isObject(product.providerIds) ? product.providerIds : {}),
    ...(blueprint?.id ? { cardtrader: String(blueprint.id) } : {}),
  };

  await prisma.sealedProduct.update({
    data: { metadata, providerIds },
    where: { id: product.id },
  });
  product.metadata = metadata;
  product.providerIds = providerIds;
}

async function writeDailySnapshot(prisma, data) {
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

async function fetchCardTrader({ fetchImpl, params, path, token }) {
  const url = new URL(`${cardTraderBaseUrl}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "user-agent": "MintBinder/0.1 sealed-pricing",
    },
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`CardTrader request failed with HTTP ${response.status} for ${path}.`);
  }

  return body;
}

function convertedListingPrice(offer, rates) {
  const cents = positiveInteger(offer.price?.cents ?? offer.price_cents, undefined);
  const currency = String(offer.price?.currency ?? offer.price_currency ?? "").toUpperCase();
  const rate = conversionRate(rates[currency]);

  if (!cents || !rate) {
    return null;
  }

  return {
    currency,
    priceMinor: Math.round(cents * rate),
  };
}

function tcgplayerProductId(product) {
  const providerIds = isObject(product.providerIds) ? product.providerIds : {};

  return stringSetting(providerIds.tcgplayer ?? providerIds.tcgcsv);
}

function normalizedExpansionName(value) {
  return normalizedSetName(groupDisplayName(value));
}

function normalizedText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);

  return ordered.length % 2 === 1
    ? ordered[middle]
    : Math.round((ordered[middle - 1] + ordered[middle]) / 2);
}

function addUnmatchedSample(summary, product, stage) {
  summary.sampleUnmatchedProducts.push({
    id: product.id,
    name: product.name,
    stage,
    tcgplayerProductId: tcgplayerProductId(product),
  });
  summary.sampleUnmatchedProducts = summary.sampleUnmatchedProducts.slice(0, 10);
}

function groupBy(values, keyForValue) {
  const result = new Map();

  for (const value of values) {
    const key = keyForValue(value);
    const group = result.get(key) ?? [];

    group.push(value);
    result.set(key, group);
  }

  return result;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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

  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function stringSetting(value) {
  const text = String(value ?? "").trim();

  return text || undefined;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
