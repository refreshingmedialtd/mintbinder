import {
  ItemCondition,
  ItemType,
  PrismaClient,
} from "@prisma/client";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import { fetchJsonWithRetry } from "./provider-fetch.mjs";
import { groupDisplayName, normalizedSetName } from "./tcgcsv-sealed-products.mjs";

const cardTraderBaseUrl = "https://api.cardtrader.com/api/v2";
const pokemonGameId = 5;
const maxTargetedProductIds = 20;
const sourceName = "cardtrader-sealed";

export function cardTraderSealedOptionsFromEnv(env = process.env) {
  const token = stringSetting(env.CARDTRADER_API_TOKEN ?? env.CARDTRADER_TOKEN);

  return {
    apiRetryAttempts: positiveInteger(env.CARDTRADER_API_RETRY_ATTEMPTS, 3),
    apiRetryWaitMs: nonNegativeInteger(env.CARDTRADER_API_RETRY_WAIT_MS, 500),
    apiTimeoutMs: positiveInteger(env.CARDTRADER_API_TIMEOUT_MS, 10_000),
    enabled: booleanSetting(env.CARDTRADER_SEALED_ENABLED, Boolean(token)),
    eurToGbpRate: conversionRate(env.CARDTRADER_EUR_TO_GBP_RATE) ??
      conversionRate(env.POKEMON_TCG_EUR_TO_GBP_RATE),
    limit: positiveInteger(env.CARDTRADER_SEALED_PRODUCT_LIMIT, 5),
    manualAliases: stringSetting(env.CARDTRADER_SEALED_ALIASES_JSON),
    priceOnlyUnpriced: booleanSetting(env.CARDTRADER_SEALED_PRICE_ONLY_UNPRICED, false),
    setLimit: positiveInteger(env.CARDTRADER_SEALED_SET_LIMIT, 1),
    token,
    usdToGbpRate: conversionRate(env.CARDTRADER_USD_TO_GBP_RATE) ??
      conversionRate(env.TCGCSV_USD_TO_GBP_RATE) ??
      conversionRate(env.POKEMON_TCG_USD_TO_GBP_RATE),
    waitMs: nonNegativeInteger(env.CARDTRADER_SEALED_WAIT_MS, 1_000),
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
  const waitMs = nonNegativeInteger(options.waitMs, 1_000);
  const writePrices = options.writePrices ?? true;
  const rates = {
    EUR: conversionRate(options.eurToGbpRate),
    GBP: 1,
    USD: conversionRate(options.usdToGbpRate),
  };
  const apiRetryAttempts = positiveInteger(options.apiRetryAttempts, 3);
  const apiRetryWaitMs = nonNegativeInteger(options.apiRetryWaitMs, 500);
  const apiTimeoutMs = positiveInteger(options.apiTimeoutMs, 10_000);
  const manualAliases = normalizeManualAliases(options.manualAliases);
  const productIds = normalizeCardTraderProductIds(options.productIds);
  const summary = {
    ambiguousMatches: 0,
    apiAttempts: 0,
    apiRequests: 0,
    blueprintsAvailable: 0,
    blueprintsMatched: 0,
    blueprintsWithIdentifiers: 0,
    blueprintsWithTcgplayerId: 0,
    candidatesAvailable: 0,
    candidatesChecked: 0,
    candidatesUnmatched: 0,
    listingOffersUsed: 0,
    mappingCoveragePercent: 0,
    mappingMethods: {
      identifier: 0,
      manualAlias: 0,
      normalizedNameType: 0,
      normalizedTokenType: 0,
      tcgplayerId: 0,
    },
    mappingReview: [],
    marketplaceMatches: 0,
    priceOnlyUnpriced,
    pricingSnapshotsCreated: 0,
    pricingSnapshotsUpdated: 0,
    provider: sourceName,
    sampleUnmatchedProducts: [],
    setsChecked: 0,
    setsUnmatched: 0,
    status: "succeeded",
    targetedProductCount: productIds.length,
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
      where: {
        createdByUserId: null,
        visibility: "GLOBAL",
        ...(productIds.length ? { id: { in: productIds } } : {}),
        ...(priceOnlyUnpriced ? {
          priceSnapshots: {
            none: { itemType: ItemType.SEALED_PRODUCT },
          },
        } : {}),
      },
    });
    const candidates = products
      .filter((product) => product.relatedCardSet?.id)
      .sort(compareCandidates);
    const selectedCandidates = selectCandidateSets(candidates, { limit, setLimit });

    summary.candidatesAvailable = candidates.length;

    if (!selectedCandidates.length) {
      summary.status = "degraded";
      return summary;
    }

    const request = async (path, params = {}) => {
      if (summary.apiRequests > 0 && waitMs > 0) {
        await wait(waitMs);
      }

      summary.apiRequests += 1;

      return fetchCardTrader({
        apiRetryAttempts,
        apiRetryWaitMs,
        apiTimeoutMs,
        fetchImpl,
        onAttempt: () => {
          summary.apiAttempts += 1;
        },
        params,
        path,
        token,
      });
    };
    const [games, expansions] = await Promise.all([
      request("/games"),
      request("/expansions"),
    ]);
    const availableGames = cardTraderCollection(games, "games");
    const pokemonGame = availableGames.find((game) =>
      [game.name, game.display_name].some((value) => normalizedText(value) === "pokemon")
    ) ?? availableGames.find((game) => String(game.id) === String(pokemonGameId));
    const resolvedPokemonGameId = pokemonGame?.id ?? pokemonGameId;
    const pokemonExpansions = cardTraderCollection(expansions, "expansions").filter((expansion) =>
      String(expansion.game_id) === String(resolvedPokemonGameId)
    );

    if (!pokemonExpansions.length) {
      throw new Error(
        `CardTrader did not return Pokemon expansions (games: ${jsonShape(games)}; expansions: ${jsonShape(expansions)}).`,
      );
    }
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

      const blueprints = cardTraderCollection(await request("/blueprints/export", {
        expansion_id: expansion.id,
      }), "blueprints");
      const blueprintIndex = buildCardTraderBlueprintIndex(blueprints);

      summary.blueprintsAvailable += blueprints.length;
      summary.blueprintsWithIdentifiers += blueprintIndex.blueprintsWithIdentifiers;
      summary.blueprintsWithTcgplayerId += blueprintIndex.blueprintsWithTcgplayerId;

      for (const product of setCandidates) {
        summary.candidatesChecked += 1;
        const tcgplayerId = tcgplayerProductId(product);
        const mapping = resolveCardTraderBlueprint(product, blueprintIndex, manualAliases);
        const blueprint = mapping.blueprint;

        if (!blueprint) {
          summary.candidatesUnmatched += 1;
          summary.ambiguousMatches += mapping.ambiguous ? 1 : 0;
          await recordCardTraderAttempt(prisma, product, {
            error: mapping.reason,
            expansion,
          });
          addUnmatchedSample(summary, product, "blueprint", mapping.reason);
          addMappingReview(summary, product, mapping);
          continue;
        }

        summary.blueprintsMatched += 1;
        summary.mappingMethods[mapping.method] += 1;
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

        summary.marketplaceMatches += 1;
        summary.listingOffersUsed += marketPrice.offerCount;
        await recordCardTraderAttempt(prisma, product, {
          blueprint,
          expansion,
          listingCount: marketPrice.listingCount,
          mappingMethod: mapping.method,
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
            mappingMethod: mapping.method,
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

    summary.mappingCoveragePercent = percent(summary.blueprintsMatched, summary.candidatesChecked);
    if (summary.candidatesChecked > 0 && summary.marketplaceMatches === 0) {
      summary.status = "degraded";
    }

    return summary;
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

export function normalizeCardTraderProductIds(value) {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  const values = Array.isArray(value) ? value : String(value).split(",");
  const productIds = uniqueValues(values.map((entry) => String(entry).trim()).filter(Boolean));

  if (productIds.length > maxTargetedProductIds) {
    throw new Error(`CardTrader targeted imports support at most ${maxTargetedProductIds} product IDs.`);
  }

  if (productIds.some((id) => !isUuid(id))) {
    throw new Error("CardTrader targeted product IDs must all be valid UUIDs.");
  }

  return productIds;
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

export function buildCardTraderBlueprintIndex(blueprints) {
  const index = {
    blueprints: [...blueprints],
    blueprintsWithIdentifiers: 0,
    blueprintsWithTcgplayerId: 0,
    byId: new Map(),
    byIdentifier: new Map(),
    byNameType: new Map(),
    byTokenType: new Map(),
    byTcgplayerId: new Map(),
  };

  for (const blueprint of blueprints) {
    addIndexValue(index.byId, String(blueprint.id ?? ""), blueprint);

    const tcgplayerId = stringSetting(blueprint.tcg_player_id ?? blueprint.tcgplayer_id);

    if (tcgplayerId) {
      index.blueprintsWithTcgplayerId += 1;
      addIndexValue(index.byTcgplayerId, tcgplayerId, blueprint);
    }

    const identifiers = cardTraderProductIdentifiers(blueprint);

    if (identifiers.length) {
      index.blueprintsWithIdentifiers += 1;
      for (const identifier of identifiers) {
        addIndexValue(index.byIdentifier, identifier, blueprint);
      }
    }

    const nameTypeKey = normalizedProductNameTypeKey(blueprintName(blueprint), blueprintProductType(blueprint));

    if (nameTypeKey) {
      addIndexValue(index.byNameType, nameTypeKey, blueprint);
    }

    const tokenTypeKey = normalizedProductTokenTypeKey(
      blueprintName(blueprint),
      blueprintProductType(blueprint),
    );

    if (tokenTypeKey) {
      addIndexValue(index.byTokenType, tokenTypeKey, blueprint);
    }
  }

  return index;
}

export function resolveCardTraderBlueprint(product, blueprintIndex, aliases = new Map()) {
  const manualTargets = uniqueValues(manualAliasKeys(product)
    .map((key) => aliases.get(key))
    .filter(Boolean));

  if (manualTargets.length > 1) {
    return unresolvedBlueprint(
      `Multiple manual CardTrader aliases are configured for ${product.name}.`,
      manualTargets.flatMap((id) => blueprintIndex.byId.get(String(id)) ?? []),
      true,
    );
  }

  if (manualTargets.length === 1) {
    const candidates = blueprintIndex.byId.get(String(manualTargets[0])) ?? [];

    if (candidates.length === 1) {
      return resolvedBlueprint(candidates[0], "manualAlias");
    }

    if (candidates.length > 1) {
      return unresolvedBlueprint(
        `Manual CardTrader alias ${manualTargets[0]} is ambiguous inside the matched expansion.`,
        candidates,
        true,
      );
    }
  }

  const tcgplayerId = tcgplayerProductId(product);
  const directCandidates = tcgplayerId ? blueprintIndex.byTcgplayerId.get(tcgplayerId) ?? [] : [];

  if (directCandidates.length === 1) {
    return resolvedBlueprint(directCandidates[0], "tcgplayerId");
  }

  if (directCandidates.length > 1) {
    return unresolvedBlueprint(
      `Multiple CardTrader blueprints carried TCGplayer ID ${tcgplayerId}.`,
      directCandidates,
      true,
    );
  }

  const identifiers = localProductIdentifiers(product);
  const identifierCandidates = uniqueBlueprints(identifiers.flatMap((identifier) =>
    blueprintIndex.byIdentifier.get(identifier) ?? []
  ));

  if (identifierCandidates.length === 1) {
    return resolvedBlueprint(identifierCandidates[0], "identifier");
  }

  if (identifierCandidates.length > 1) {
    return unresolvedBlueprint(
      `Multiple CardTrader blueprints matched product identifier ${identifiers.join(", ")}.`,
      identifierCandidates,
      true,
    );
  }

  const nameTypeKey = normalizedProductNameTypeKey(product.name, localProductType(product));
  const nameCandidates = nameTypeKey ? blueprintIndex.byNameType.get(nameTypeKey) ?? [] : [];

  if (nameCandidates.length === 1) {
    return resolvedBlueprint(nameCandidates[0], "normalizedNameType");
  }

  if (nameCandidates.length > 1) {
    return unresolvedBlueprint(
      `Multiple CardTrader blueprints matched the normalized name and product type for ${product.name}.`,
      nameCandidates,
      true,
    );
  }

  const tokenTypeKey = normalizedProductTokenTypeKey(product.name, localProductType(product));
  const tokenCandidates = tokenTypeKey ? blueprintIndex.byTokenType.get(tokenTypeKey) ?? [] : [];

  if (tokenCandidates.length === 1) {
    return resolvedBlueprint(tokenCandidates[0], "normalizedTokenType");
  }

  if (tokenCandidates.length > 1) {
    return unresolvedBlueprint(
      `Multiple CardTrader blueprints matched the normalized name tokens and product type for ${product.name}.`,
      tokenCandidates,
      true,
    );
  }

  const staleManualAlias = manualTargets.length === 1
    ? ` Manual alias ${manualTargets[0]} was not present in the matched expansion.`
    : "";

  return unresolvedBlueprint(
    `No unique CardTrader blueprint matched ${product.name} by TCGplayer ID, UPC/EAN, normalized name and type, or normalized name tokens and type.${staleManualAlias}`,
  );
}

export function normalizeManualAliases(value) {
  if (value instanceof Map) {
    return new Map([...value.entries()].map(([key, blueprintId]) => [
      normalizeManualAliasKey(key),
      String(blueprintId),
    ]));
  }

  if (typeof value === "string") {
    try {
      return normalizeManualAliases(JSON.parse(value));
    } catch (error) {
      throw new Error(
        `CARDTRADER_SEALED_ALIASES_JSON must contain valid JSON: ${error instanceof Error ? error.message : "invalid JSON"}.`,
      );
    }
  }

  if (Array.isArray(value)) {
    return new Map(value.map((entry) => {
      const key = entry?.localKey ?? entry?.key;
      const blueprintId = entry?.blueprintId ?? entry?.cardTraderBlueprintId;

      if (!key || !blueprintId) {
        throw new Error("Each CardTrader alias entry needs localKey and blueprintId.");
      }

      return [normalizeManualAliasKey(key), String(blueprintId)];
    }));
  }

  if (isObject(value)) {
    return new Map(Object.entries(value).map(([key, target]) => {
      const blueprintId = isObject(target)
        ? target.blueprintId ?? target.cardTraderBlueprintId
        : target;

      if (!blueprintId) {
        throw new Error(`CardTrader alias ${key} needs a blueprint ID.`);
      }

      return [normalizeManualAliasKey(key), String(blueprintId)];
    }));
  }

  return new Map();
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
  mappingMethod,
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
    cardTraderMappingMethod: mappingMethod ?? product.metadata?.cardTraderMappingMethod ?? null,
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

async function fetchCardTrader({
  apiRetryAttempts,
  apiRetryWaitMs,
  apiTimeoutMs,
  fetchImpl,
  onAttempt,
  params,
  path,
  token,
}) {
  const url = new URL(`${cardTraderBaseUrl}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const result = await fetchJsonWithRetry({
      fetchImpl,
      init: {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "user-agent": "MintBinder/0.1 sealed-pricing",
        },
      },
      maxResponseBytes: 16 * 1024 * 1024,
      onAttempt,
      provider: `CardTrader ${path}`,
      retryAttempts: apiRetryAttempts,
      retryInvalidResponse: true,
      retryWaitMs: apiRetryWaitMs,
      timeoutMs: apiTimeoutMs,
      url,
    });

    return result.body;
  } catch (error) {
    const message = error instanceof Error ? error.message : "CardTrader request failed.";

    throw new Error(`${message.replace(/\.$/, "")} for ${path}.`);
  }
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

function localProductIdentifiers(product) {
  return uniqueValues([
    ...cardTraderProductIdentifiers(product.metadata),
    ...cardTraderProductIdentifiers(product.providerIds),
  ]);
}

function cardTraderProductIdentifiers(value) {
  const identifiers = new Set();

  collectProductIdentifiers(value, identifiers);

  return [...identifiers];
}

function collectProductIdentifiers(value, identifiers, keyHint = "", depth = 0) {
  if (depth > 5 || value === null || value === undefined) {
    return;
  }

  if (["string", "number"].includes(typeof value)) {
    if (isIdentifierKey(keyHint)) {
      const identifier = normalizedProductIdentifier(value);

      if (identifier) {
        identifiers.add(identifier);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectProductIdentifiers(entry, identifiers, keyHint, depth + 1);
    }
    return;
  }

  if (!isObject(value)) {
    return;
  }

  const propertyName = String(value.name ?? value.label ?? value.key ?? "");

  if (isIdentifierKey(propertyName)) {
    for (const propertyValue of [value.value, value.values, value.text]) {
      collectProductIdentifiers(propertyValue, identifiers, propertyName, depth + 1);
    }
  }

  for (const [key, entry] of Object.entries(value)) {
    collectProductIdentifiers(entry, identifiers, key, depth + 1);
  }
}

function normalizedProductIdentifier(value) {
  const digits = String(value ?? "").replace(/\D+/g, "");

  return digits.length >= 8 && digits.length <= 14 ? digits : undefined;
}

function isIdentifierKey(value) {
  return /(?:^|[^a-z])(?:upc|ean|gtin|barcode)(?:[^a-z]|$)/i.test(String(value ?? "").replace(/_/g, " "));
}

function blueprintName(blueprint) {
  return String(blueprint.name ?? blueprint.display_name ?? blueprint.displayName ?? "");
}

function localProductType(product) {
  return normalizedProductType(product.productType, product.name);
}

function blueprintProductType(blueprint) {
  const explicit = [
    blueprint.product_type,
    blueprint.productType,
    blueprint.category_name,
    blueprint.category?.name,
    blueprint.category,
  ].filter((value) => typeof value === "string").join(" ");

  return normalizedProductType(explicit, blueprintName(blueprint));
}

function normalizedProductType(explicitValue, name) {
  const explicit = normalizedWords(explicitValue).replace(/\s+/g, "_");

  if ([
    "blister",
    "booster_box",
    "booster_pack",
    "case",
    "collection_box",
    "deck",
    "elite_trainer_box",
    "other",
    "tin",
  ].includes(explicit)) {
    return explicit;
  }

  const words = normalizedWords(`${explicitValue ?? ""} ${name ?? ""}`);

  if (/\bcase\b/.test(words)) return "case";
  if (/\belite trainer box\b|\betb\b/.test(words)) return "elite_trainer_box";
  if (/\bbooster (?:display )?box\b|\bdisplay box\b/.test(words)) return "booster_box";
  if (/\bbooster pack\b|\bsleeved booster\b/.test(words)) return "booster_pack";
  if (/\bblister\b/.test(words)) return "blister";
  if (/\btin\b|\bcollector chest\b/.test(words)) return "tin";
  if (/\bdeck\b/.test(words)) return "deck";
  if (/\bcollection\b|\bbox\b|\bbundle\b/.test(words)) return "collection_box";

  return explicit === "other" ? "other" : undefined;
}

function normalizedProductNameTypeKey(name, productType) {
  const normalizedName = normalizedProductName(name);

  return normalizedName && productType ? `${normalizedName}|${productType}` : undefined;
}

function normalizedProductTokenTypeKey(name, productType) {
  const normalizedName = normalizedProductName(name);
  const tokenSignature = normalizedName
    ? normalizedName.split(" ").filter(Boolean).sort().join(" ")
    : "";

  return tokenSignature && productType ? `${tokenSignature}|${productType}` : undefined;
}

function normalizedProductName(value) {
  return normalizedWords(value)
    .replace(/\b(?:pokemon tcg|trading card game|pokemon)\b/g, " ")
    .replace(/\b(?:the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedWords(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function manualAliasKeys(product) {
  return uniqueValues([
    `id:${product.id}`,
    tcgplayerProductId(product) ? `tcgplayer:${tcgplayerProductId(product)}` : undefined,
    ...localProductIdentifiers(product).map((identifier) => `upc:${identifier}`),
    `name:${normalizedProductName(product.name)}`,
  ].filter(Boolean).map(normalizeManualAliasKey));
}

function normalizeManualAliasKey(value) {
  const text = String(value ?? "").trim();
  const separator = text.indexOf(":");

  if (separator < 1) {
    return `id:${text.toLowerCase()}`;
  }

  const prefix = text.slice(0, separator).trim().toLowerCase();
  const rawValue = text.slice(separator + 1).trim();

  const normalizedValue = prefix === "name"
    ? normalizedProductName(rawValue)
    : ["upc", "ean", "gtin", "barcode"].includes(prefix)
      ? normalizedProductIdentifier(rawValue) ?? rawValue.toLowerCase()
      : rawValue.toLowerCase();

  return `${prefix}:${normalizedValue}`;
}

function resolvedBlueprint(blueprint, method) {
  return {
    ambiguous: false,
    blueprint,
    candidates: [blueprint],
    method,
    reason: null,
  };
}

function unresolvedBlueprint(reason, candidates = [], ambiguous = false) {
  return {
    ambiguous,
    blueprint: null,
    candidates: uniqueBlueprints(candidates),
    method: null,
    reason,
  };
}

function addIndexValue(index, key, value) {
  if (!key) {
    return;
  }

  const values = index.get(key) ?? [];

  values.push(value);
  index.set(key, values);
}

function uniqueBlueprints(values) {
  const byId = new Map();

  for (const value of values) {
    byId.set(String(value.id), value);
  }

  return [...byId.values()];
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
}

function normalizedExpansionName(value) {
  return normalizedSetName(groupDisplayName(value));
}

function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value));
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);

  return ordered.length % 2 === 1
    ? ordered[middle]
    : Math.round((ordered[middle - 1] + ordered[middle]) / 2);
}

function addUnmatchedSample(summary, product, stage, reason) {
  summary.sampleUnmatchedProducts.push({
    id: product.id,
    name: product.name,
    reason,
    stage,
    tcgplayerProductId: tcgplayerProductId(product),
  });
  summary.sampleUnmatchedProducts = summary.sampleUnmatchedProducts.slice(0, 10);
}

function addMappingReview(summary, product, mapping) {
  summary.mappingReview.push({
    ambiguous: mapping.ambiguous,
    candidateBlueprints: (mapping.candidates ?? []).slice(0, 5).map((blueprint) => ({
      id: String(blueprint.id),
      name: blueprintName(blueprint),
    })),
    localIdentifiers: localProductIdentifiers(product),
    name: product.name,
    productId: product.id,
    productType: localProductType(product),
    reason: mapping.reason,
    tcgplayerProductId: tcgplayerProductId(product),
  });
  summary.mappingReview = summary.mappingReview.slice(0, 25);
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

function cardTraderCollection(value, resourceName) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!isObject(value)) {
    return [];
  }

  for (const key of [resourceName, "data", "results", "items"]) {
    if (Array.isArray(value[key])) {
      return value[key];
    }
  }

  const values = Object.values(value);

  return values.length > 0 && values.every(isObject) ? values : [];
}

function jsonShape(value) {
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }

  if (isObject(value)) {
    const keys = Object.keys(value).slice(0, 8);

    return `object(${keys.join(",") || "no keys"})`;
  }

  return value === null ? "null" : typeof value;
}

function conversionRate(value) {
  const rate = Number(value);

  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

function percent(value, total) {
  return total > 0 ? Math.round((value / total) * 1_000) / 10 : 0;
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
