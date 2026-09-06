import {
  ItemCondition,
  ItemType,
  PrismaClient,
} from "@prisma/client";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import { fetchJsonWithRetry } from "./provider-fetch.mjs";
import {
  extendedDataValue,
  isSealedProduct,
  matchTcgcsvGroupsToSets,
  tcgcsvPokemonJapanCategoryId,
  tcgcsvPokemonCategoryId,
} from "./tcgcsv-sealed-products.mjs";

const cardGroupProviderAliases = new Map([
  ["1542", ["tk2a", "tk2b"]],
  ["1543", ["tk1a", "tk1b"]],
  ["1418", ["basep"]],
  ["1421", ["dpp"]],
  ["1423", ["np"]],
  ["1451", ["xyp"]],
  ["1453", ["hsp"]],
  ["1861", ["smp"]],
  ["2545", ["swshp"]],
  ["1407", ["bwp"]],
]);

const cardGroupNameProviderAliases = new Map([
  ["blackandwhitepromos", ["bwp"]],
  ["diamondandpearlpromos", ["dpp"]],
  ["extrainerkit1latiaslatios", ["tk1a", "tk1b"]],
  ["extrainerkit2plusleminun", ["tk2a", "tk2b"]],
  ["hgsspromos", ["hsp"]],
  ["nintendopromos", ["np"]],
  ["smpromos", ["smp"]],
  ["swshswordshieldpromocards", ["swshp"]],
  ["wotcpromo", ["basep"]],
  ["xypromos", ["xyp"]],
]);

// These set names differ substantially between Pokemon TCG API and TCGplayer.
// Keep the reviewed aliases tied to both the immutable TCGplayer group ID and
// its normalized name: if either identity changes, the importer leaves the
// group unmatched instead of guessing.
const reviewedCardGroupProviderAliases = new Map([
  ["1375:expedition", ["ecard1"]],
  ["1381:triumphant", ["hgss4"]],
  ["1387:xybaseset", ["xy1"]],
  ["1399:unleashed", ["hgss2"]],
  ["1402:heartgoldsoulsilver", ["hgss1"]],
  ["1403:undaunted", ["hgss3"]],
  ["1455:bestofpromos", ["bp"]],
  ["2782:mcdonalds25thanniversarypromos", ["mcd21"]],
  ["22873:sv01scarletvioletbaseset", ["sv1"]],
  ["23237:svscarletviolet151", ["sv3pt5"]],
]);

// TCGplayer splits a small number of set subsets into separate groups while
// the source catalogue models them under their parent set. These reviewed
// identities are intentionally supplemental: unlike the exclusive aliases
// above, they must not prevent the parent group from continuing to feed the
// same local set.
const supplementalReviewedCardGroupProviderAliases = new Map([
  ["1465:legendarytreasuresradiantcollection", ["bw11"]],
  ["1729:generationsradiantcollection", ["g1"]],
]);

// TCGplayer models both Aquapolis Porygon artworks as separate products while
// the source catalogue exposes a single collector-number 103 printing. Keep
// this exception tied to immutable provider product IDs rather than stripping
// an a/b suffix from every collector number.
const reviewedCardProductNumberAliases = new Map([
  ["88306", "103"],
  ["88307", "103"],
]);
const {
  ambiguousProviderCodes: ambiguousReviewedProviderCodes,
  ownerByProviderCode: reviewedOwnerByProviderCode,
} = buildReviewedProviderOwnership(reviewedCardGroupProviderAliases);

export function cardPricingOptionsFromEnv(env = process.env) {
  const language = optionalString(env.TCGCSV_CARD_LANGUAGE);
  const categoryId = positiveInteger(env.TCGCSV_CARD_CATEGORY_ID, categoryIdForLanguage(language));

  return {
    apiRetryAttempts: positiveInteger(env.TCGCSV_API_RETRY_ATTEMPTS, 3),
    apiRetryWaitMs: nonNegativeInteger(env.TCGCSV_API_RETRY_WAIT_MS, 500),
    apiTimeoutMs: positiveInteger(env.TCGCSV_API_TIMEOUT_MS, 10_000),
    categoryId,
    groupIds: idList(env.TCGCSV_CARD_GROUP_IDS),
    groupLimit: positiveInteger(env.TCGCSV_CARD_GROUP_LIMIT, Number.POSITIVE_INFINITY),
    language: language ?? languageForCategory(categoryId),
    minUnpricedCards: positiveInteger(env.TCGCSV_CARD_MIN_UNPRICED, 1),
    onlyUnpricedGroups: booleanSetting(env.TCGCSV_CARD_ONLY_UNPRICED_GROUPS, false),
    priceOnlyUnpriced: booleanSetting(env.TCGCSV_CARD_PRICE_ONLY_UNPRICED, true),
    source: sourceForCategory(categoryId),
    usdToGbpRate: conversionRate(env.TCGCSV_USD_TO_GBP_RATE) ?? conversionRate(env.POKEMON_TCG_USD_TO_GBP_RATE),
    writePrices: booleanSetting(env.TCGCSV_CARD_WRITE_PRICES, true),
  };
}

export function japanCardPricingOptionsFromEnv(env = process.env) {
  return {
    apiRetryAttempts: positiveInteger(env.TCGCSV_API_RETRY_ATTEMPTS, 3),
    apiRetryWaitMs: nonNegativeInteger(env.TCGCSV_API_RETRY_WAIT_MS, 500),
    apiTimeoutMs: positiveInteger(env.TCGCSV_API_TIMEOUT_MS, 10_000),
    categoryId: positiveInteger(env.TCGCSV_JAPAN_CARD_CATEGORY_ID, tcgcsvPokemonJapanCategoryId),
    groupIds: idList(env.TCGCSV_JAPAN_CARD_GROUP_IDS),
    groupLimit: positiveInteger(env.TCGCSV_JAPAN_CARD_GROUP_LIMIT, 1),
    language: optionalString(env.TCGCSV_JAPAN_CARD_LANGUAGE) ?? "ja",
    minUnpricedCards: positiveInteger(env.TCGCSV_JAPAN_CARD_MIN_UNPRICED, 1),
    onlyUnpricedGroups: booleanSetting(env.TCGCSV_JAPAN_CARD_ONLY_UNPRICED_GROUPS, false),
    priceOnlyUnpriced: booleanSetting(env.TCGCSV_JAPAN_CARD_PRICE_ONLY_UNPRICED, false),
    source: optionalString(env.TCGCSV_JAPAN_CARD_SOURCE) ?? "tcgcsv-japan-card",
    usdToGbpRate:
      conversionRate(env.TCGCSV_JAPAN_USD_TO_GBP_RATE) ??
      conversionRate(env.TCGCSV_USD_TO_GBP_RATE) ??
      conversionRate(env.POKEMON_TCG_USD_TO_GBP_RATE),
    waitMs: nonNegativeInteger(env.TCGCSV_JAPAN_CARD_WAIT_MS, 120),
    writePrices: booleanSetting(env.TCGCSV_JAPAN_CARD_WRITE_PRICES, true),
  };
}

export async function syncTcgcsvCardPrices(options = {}) {
  const prisma = options.prisma ?? new PrismaClient();
  const shouldDisconnect = !options.prisma;
  const fetchImpl = options.fetchImpl ?? fetch;
  const providerFetchOptions = {
    retryAttempts: positiveInteger(options.apiRetryAttempts, 3),
    retryWaitMs: nonNegativeInteger(options.apiRetryWaitMs, 500),
    timeoutMs: positiveInteger(options.apiTimeoutMs, 10_000),
  };
  const categoryId = positiveInteger(options.categoryId, tcgcsvPokemonCategoryId);
  const groupIds = idSet(options.groupIds);
  const groupLimit = positiveInteger(options.groupLimit, Number.POSITIVE_INFINITY);
  const language = normalizedLanguage(options.language ?? languageForCategory(categoryId));
  const minUnpricedCards = positiveInteger(options.minUnpricedCards, 1);
  const onlyUnpricedGroups = options.onlyUnpricedGroups ?? false;
  const priceOnlyUnpriced = options.priceOnlyUnpriced ?? true;
  const source = optionalString(options.source) ?? sourceForCategory(categoryId);
  const waitMs = nonNegativeInteger(options.waitMs, 120);
  const writeImages = options.writeImages ?? true;
  const writePrices = options.writePrices ?? true;
  const usdToGbp = conversionRate(options.usdToGbpRate);

  if (writePrices && !usdToGbp) {
    throw new Error("TCGCSV_USD_TO_GBP_RATE or POKEMON_TCG_USD_TO_GBP_RATE must be set for card pricing.");
  }

  try {
    const [groups, sets] = await Promise.all([
      fetchTcgcsv(`https://tcgcsv.com/tcgplayer/${categoryId}/groups`, fetchImpl, providerFetchOptions),
      prisma.cardSet.findMany({
        select: {
          id: true,
          language: true,
          name: true,
          providerIds: true,
          cardPrintings: {
            select: {
              _count: {
                select: {
                  priceSnapshots: true,
                },
              },
              priceSnapshots: {
                orderBy: {
                  observedAt: "desc",
                },
                select: {
                  observedAt: true,
                  source: true,
                },
                take: 1,
                where: {
                  itemType: ItemType.CARD,
                  source,
                },
              },
            },
          },
          releaseDate: true,
          total: true,
        },
        where: language === "all" ? undefined : { language },
      }),
    ]);
    const availableMatches = matchTcgcsvCardGroupsToSets(groups.results ?? [], sets)
      .filter(({ group }) => groupIds.size === 0 || groupIds.has(String(group.groupId)))
      .filter(({ set }) => !onlyUnpricedGroups || unpricedCardCount(set) >= minUnpricedCards)
      .sort((a, b) => compareCardGroupRefreshPriority(a.set, b.set, {
        prioritizeUnpriced: onlyUnpricedGroups,
      }));
    const matches = availableMatches.slice(0, groupLimit);
    const summary = {
      cardProductsMatched: 0,
      cardProductsSkipped: 0,
      cardProductsUnmatched: 0,
      catalogueCardsAvailable: 0,
      catalogueCardsExpected: 0,
      catalogueIncompleteGroups: 0,
      categoryId,
      groupsAvailable: availableMatches.length,
      groupsMatched: matches.length,
      groupsProcessed: 0,
      identitySnapshotsRelabelled: 0,
      language,
      minUnpricedCards,
      onlyUnpricedGroups,
      priceOnlyUnpriced,
      pricingSnapshotsCreated: 0,
      productsFetched: 0,
      sampleUnmatchedProducts: [],
      sampleIncompleteGroups: [],
      source,
      cardImagesUpdated: 0,
      writePrices,
    };

    for (const match of matches) {
      const groupSummary = await importCardGroup({
        fetchImpl,
        match,
        priceOnlyUnpriced,
        prisma,
        providerFetchOptions,
        categoryId,
        language,
        source,
        usdToGbp,
        writeImages,
        writePrices,
      });

      summary.cardImagesUpdated += groupSummary.cardImagesUpdated;
      summary.cardProductsMatched += groupSummary.cardProductsMatched;
      summary.cardProductsSkipped += groupSummary.cardProductsSkipped;
      summary.cardProductsUnmatched += groupSummary.cardProductsUnmatched;
      summary.catalogueCardsAvailable += groupSummary.catalogueCardsAvailable;
      summary.catalogueCardsExpected += groupSummary.catalogueCardsExpected;
      summary.catalogueIncompleteGroups += groupSummary.catalogueIncomplete ? 1 : 0;
      summary.groupsProcessed += 1;
      summary.identitySnapshotsRelabelled += groupSummary.identitySnapshotsRelabelled;
      summary.pricingSnapshotsCreated += groupSummary.pricingSnapshotsCreated;
      summary.productsFetched += groupSummary.productsFetched;
      summary.sampleUnmatchedProducts.push(...groupSummary.sampleUnmatchedProducts);
      summary.sampleUnmatchedProducts = summary.sampleUnmatchedProducts.slice(0, 10);
      if (groupSummary.catalogueIncomplete) {
        summary.sampleIncompleteGroups.push({
          cardsAvailable: groupSummary.catalogueCardsAvailable,
          cardsExpected: groupSummary.catalogueCardsExpected,
          groupId: match.group.groupId,
          setId: match.set.id,
          setName: match.set.name,
        });
        summary.sampleIncompleteGroups = summary.sampleIncompleteGroups.slice(0, 10);
      }

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

export function matchTcgcsvCardGroupsToSets(groups, sets) {
  const setByProviderCode = new Map();
  const ambiguousProviderCodes = new Set();

  for (const set of sets) {
    const providerCode = normalizedProviderCode(setProviderId(set));

    if (!providerCode || ambiguousProviderCodes.has(providerCode)) {
      continue;
    }

    if (setByProviderCode.has(providerCode)) {
      // An alias is only safe when its target provider identity is unique.
      // Do not silently let the last duplicate set win.
      setByProviderCode.delete(providerCode);
      ambiguousProviderCodes.add(providerCode);
    } else {
      setByProviderCode.set(providerCode, set);
    }
  }

  // A reviewed identity is stronger than the generic name matcher. Exclude
  // those groups from the generic pass so a coincidentally similar local name
  // cannot make one provider group feed two different sets.
  const matches = matchTcgcsvGroupsToSets(groups, sets)
    .filter(({ group }) =>
      reviewedCardGroupProviderCodes(group).length === 0 &&
      supplementalReviewedCardGroupProviderCodes(group).length === 0);
  const seen = new Set(matches.map(matchKey));

  for (const group of groups) {
    const reviewedProviderCodes = reviewedCardGroupProviderCodes(group);
    const supplementalProviderCodes = supplementalReviewedCardGroupProviderCodes(group);
    const providerCodes = reviewedProviderCodes.length
      ? reviewedProviderCodes
      : supplementalProviderCodes.length
        ? supplementalProviderCodes
        : cardGroupProviderCodes(group);

    for (const providerCode of providerCodes) {
      const set = setByProviderCode.get(providerCode);

      if (!set) {
        continue;
      }

      const match = { group, set };
      const key = matchKey(match);

      if (!seen.has(key)) {
        matches.push(match);
        seen.add(key);
      }
    }
  }

  // Reviewed provider targets stay reserved even if an upstream group is
  // absent or renamed. That identity drift must make the set unmatched, not
  // allow a coincidental generic group to take ownership of its price feed.
  return matches.filter(({ group, set }) => {
    const providerCode = normalizedProviderCode(setProviderId(set));

    if (ambiguousReviewedProviderCodes.has(providerCode)) {
      return false;
    }

    const reviewedOwner = reviewedOwnerByProviderCode.get(providerCode);
    return !reviewedOwner || reviewedCardGroupIdentity(group) === reviewedOwner;
  });
}

export function matchTcgcsvCardProduct(product, cards) {
  const providerProductId = String(product?.productId ?? "").trim();
  const productNumber = normalizedCardNumber(
    reviewedCardProductNumberAliases.get(providerProductId) ?? extendedDataValue(product, "Number"),
  );
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

    // A supplied collector number is stronger evidence than the name. Falling
    // back to a same-name card after the number misses can attach a parallel
    // printing to the wrong local card.
    return null;
  }

  const byName = cards.filter((card) => normalizedCardName(card.name) === productName);

  return byName.length === 1 ? byName[0] : null;
}

export function tcgcsvCardVariantLabel(product, subTypeName) {
  const baseLabel = optionalString(subTypeName) ?? "Normal";
  const identityText = `${product?.name ?? ""} ${product?.url ?? ""}`
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/%20/g, " ")
    .replace(/[-_]+/g, " ");

  // "Master Ball" and "Poke Ball" are also real card names. Only promote a
  // product to a patterned reverse-holo identity when TCGplayer explicitly
  // describes it as a pattern; otherwise preserve the provider's raw subtype.
  if (/\bmaster\s*ball\s+pattern\b/.test(identityText)) {
    return "Master Ball Reverse Holofoil";
  }

  if (/\bpoke\s*ball\s+pattern\b/.test(identityText)) {
    return "Poke Ball Reverse Holofoil";
  }

  if (/cosmos\s*holo/.test(identityText)) {
    return "Cosmos Holofoil";
  }

  if (/galaxy\s*holo/.test(identityText)) {
    return "Galaxy Holofoil";
  }

  if (/cracked\s*ice\s*holo/.test(identityText)) {
    return "Cracked Ice Holofoil";
  }

  return baseLabel;
}

export function resolveTcgcsvVariantIdentities(entries) {
  const resolved = entries.map((entry) => ({
    ...entry,
    sourceRef: String(entry.product?.productId ?? entry.sourceRef ?? "").trim(),
    variantLabel: tcgcsvCardVariantLabel(entry.product, entry.subTypeName),
  }));
  const byCardAndLabel = new Map();

  for (const entry of resolved) {
    const key = `${entry.cardPrintingId}\u0000${entry.variantLabel}`;
    const group = byCardAndLabel.get(key) ?? [];

    group.push(entry);
    byCardAndLabel.set(key, group);
  }

  for (const group of byCardAndLabel.values()) {
    const distinctRefs = [...new Set(group.map((entry) => entry.sourceRef).filter(Boolean))]
      .sort(compareProviderRefs);

    if (distinctRefs.length <= 1) {
      continue;
    }

    const preservedRefs = [...new Set(group
      .filter((entry) => entry.preserveBaseLabel)
      .map((entry) => entry.sourceRef)
      .filter(Boolean))]
      .sort(compareProviderRefs);
    const canonicalRef = preservedRefs[0] ?? distinctRefs[0];

    for (const entry of group) {
      if (entry.sourceRef && entry.sourceRef !== canonicalRef) {
        entry.variantLabel = `${entry.variantLabel} · TCGplayer #${entry.sourceRef}`;
      }
    }
  }

  return resolved;
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
  providerFetchOptions,
  categoryId,
  language,
  source,
  usdToGbp,
  writeImages,
  writePrices,
}) {
  const { group, set } = match;
  const [productsResponse, pricesResponse, cards] = await Promise.all([
    fetchTcgcsv(`https://tcgcsv.com/tcgplayer/${categoryId}/${group.groupId}/products`, fetchImpl, providerFetchOptions),
    fetchTcgcsv(`https://tcgcsv.com/tcgplayer/${categoryId}/${group.groupId}/prices`, fetchImpl, providerFetchOptions),
    prisma.cardPrinting.findMany({
      select: {
        id: true,
        imageLargeUrl: true,
        imageSmallUrl: true,
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
    cardImagesUpdated: 0,
    catalogueCardsAvailable: cards.length,
    catalogueCardsExpected: positiveInteger(set.total) ?? cards.length,
    catalogueIncomplete: false,
    identitySnapshotsRelabelled: 0,
    pricingSnapshotsCreated: 0,
    productsFetched: productsResponse.results?.length ?? 0,
    sampleUnmatchedProducts: [],
  };
  summary.catalogueIncomplete = summary.catalogueCardsAvailable < summary.catalogueCardsExpected;

  for (const price of pricesResponse.results ?? []) {
    const productPrices = pricesByProductId.get(price.productId) ?? [];

    productPrices.push(price);
    pricesByProductId.set(price.productId, productPrices);
  }

  const matchedProducts = [];

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

    matchedProducts.push({
      card,
      prices: usableTcgcsvPrices(pricesByProductId.get(product.productId) ?? []),
      product,
    });
  }

  const incomingVariantIdentities = matchedProducts.flatMap(({ card, prices, product }) => prices.map((price) => ({
      cardPrintingId: card.id,
      product,
      subTypeName: price.subTypeName,
    })));
  const existingVariantIdentities = await loadExistingTcgcsvVariantIdentities({
    cardPrintingIds: [...new Set(matchedProducts.map(({ card }) => card.id))],
    prisma,
    subTypeNames: incomingVariantIdentities.map((identity) => identity.subTypeName),
    source,
  });
  const variantIdentities = resolveTcgcsvVariantIdentities([
    ...existingVariantIdentities,
    ...incomingVariantIdentities,
  ]);
  // Historical snapshots are audit evidence and must never be rewritten as a
  // side effect of an hourly pricing run. Existing identities are read only to
  // keep newly written labels stable; any historical cleanup is deliberately
  // gated behind scripts/repair-tcgcsv-price-identities.mjs.
  const variantLabelByKey = new Map(variantIdentities.map((identity) => [
    tcgcsvVariantIdentityKey(identity.cardPrintingId, identity.sourceRef, identity.subTypeName),
    identity.variantLabel,
  ]));

  for (const { card, prices, product } of matchedProducts) {

    if (writeImages && await updateTcgcsvCardImage(prisma, card, product)) {
      summary.cardImagesUpdated += 1;
    }

    if (!writePrices || !usdToGbp) {
      continue;
    }

    if (!prices.length) {
      continue;
    }

    for (const price of prices) {
      const variantLabel = variantLabelByKey.get(tcgcsvVariantIdentityKey(
        card.id,
        String(product.productId ?? ""),
        price.subTypeName,
      )) ?? tcgcsvCardVariantLabel(product, price.subTypeName);

      if (priceOnlyUnpriced && await hasCardVariantPriceSnapshot(prisma, card.id, variantLabel)) {
        continue;
      }

      await prisma.priceSnapshot.create({
        data: {
          cardPrintingId: card.id,
          condition: ItemCondition.NEAR_MINT,
          confidenceScore: price.confidenceScore,
          currency: "GBP",
          itemType: ItemType.CARD,
          language,
          metadata: {
            categoryId,
            conversionRate: usdToGbp,
            groupId: group.groupId,
            groupName: group.name,
            language,
            originalCurrency: "USD",
            originalPrice: price.usd,
            priceSource: "TCGCSV TCGplayer market",
            baseVariantLabel: tcgcsvCardVariantLabel(product, price.subTypeName),
            subTypeName: price.subTypeName,
            tcgplayerUrl: product.url,
          },
          observedAt: new Date(),
          priceMinor: Math.round(price.usd * usdToGbp * 100),
          source,
          sourceRef: String(product.productId),
          variantLabel,
        },
      });
      summary.pricingSnapshotsCreated += 1;
    }
  }

  return summary;
}

async function loadExistingTcgcsvVariantIdentities({ cardPrintingIds, prisma, source, subTypeNames }) {
  if (!cardPrintingIds.length || typeof prisma.priceSnapshot.findMany !== "function") {
    return [];
  }

  // Query each raw subtype separately. A provider product may expose several
  // subtype prices under one sourceRef, and collapsing the query across the
  // JSON subtype would make a subsequent repair rewrite every subtype at once.
  const rawSubtypes = [...new Set(subTypeNames.map(optionalString).filter(Boolean))];
  const snapshots = [];

  // Neon production currently has a three-connection pool. Keep these narrow
  // subtype lookups serial so one import cannot consume the pool by itself.
  for (const subTypeName of rawSubtypes) {
    snapshots.push(...await prisma.priceSnapshot.findMany({
      distinct: ["cardPrintingId", "sourceRef", "variantLabel"],
      select: {
        cardPrintingId: true,
        metadata: true,
        sourceRef: true,
        variantLabel: true,
      },
      where: {
        cardPrintingId: { in: cardPrintingIds },
        itemType: ItemType.CARD,
        metadata: { equals: subTypeName, path: ["subTypeName"] },
        source,
        sourceRef: { not: null },
      },
    }));
  }

  return snapshots.map((snapshot) => {
    const metadata = isObject(snapshot.metadata) ? snapshot.metadata : {};
    const baseVariantLabel = optionalString(metadata.baseVariantLabel) ??
      stripTcgplayerIdentitySuffix(snapshot.variantLabel);

    return {
      cardPrintingId: snapshot.cardPrintingId,
      existingVariantLabel: snapshot.variantLabel,
      preserveBaseLabel: snapshot.variantLabel === baseVariantLabel,
      product: {
        name: metadata.tcgplayerUrl,
        productId: snapshot.sourceRef,
        url: metadata.tcgplayerUrl,
      },
      sourceRef: snapshot.sourceRef,
      subTypeName: optionalString(metadata.subTypeName) ?? baseVariantLabel,
    };
  });
}

function stripTcgplayerIdentitySuffix(value) {
  return String(value ?? "Normal").replace(/\s+·\s+TCGplayer\s+#\d+$/i, "").trim() || "Normal";
}

async function updateTcgcsvCardImage(prisma, card, product) {
  const productId = String(product.productId ?? "").trim();
  const fallback = /^\d+$/.test(productId)
    ? `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_200w.jpg`
    : undefined;
  const small = usableTcgcsvCardImageUrl(product.imageUrl) ?? fallback;

  if (!small) {
    return false;
  }

  const data = {};

  if (!hasUsableCardImageUrl(card.imageLargeUrl)) {
    data.imageLargeUrl = upgradedTcgplayerCardImageUrl(small);
  }

  if (!hasUsableCardImageUrl(card.imageSmallUrl)) {
    data.imageSmallUrl = small;
  }

  if (!Object.keys(data).length) {
    return false;
  }

  await prisma.cardPrinting.update({
    data,
    where: { id: card.id },
  });

  return true;
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

async function hasCardVariantPriceSnapshot(prisma, cardPrintingId, variantLabel) {
  const snapshot = await prisma.priceSnapshot.findFirst({
    select: { id: true },
    where: {
      cardPrintingId,
      itemType: ItemType.CARD,
      variantLabel,
    },
  });

  return Boolean(snapshot);
}

function usableTcgcsvCardImageUrl(value) {
  const url = String(value ?? "").trim();

  return url && !isKnownBadCardImageUrl(url) ? url : undefined;
}

function upgradedTcgplayerCardImageUrl(value) {
  return value.replace(/_(?:200w|400w)(\.[a-z0-9]+)$/i, "_in_1000x1000$1");
}

function hasUsableCardImageUrl(value) {
  const url = String(value ?? "").trim();

  return Boolean(url) && !isKnownBadCardImageUrl(url);
}

function isKnownBadCardImageUrl(value) {
  const url = String(value ?? "").trim().toLowerCase();

  return [
    "/mcd18/",
    "cardback",
    "card-back",
    "/back.png",
    "/back_hires.png",
  ].some((pattern) => url.includes(pattern));
}

function usableTcgcsvPrices(prices) {
  const bestBySubtype = new Map();

  for (const price of prices) {
    const usd = price.marketPrice ?? price.midPrice ?? price.lowPrice ?? price.directLowPrice ?? null;

    if (!usd || usd <= 0) {
      continue;
    }

    const subTypeName = price.subTypeName ?? "Normal";
    const candidate = {
      confidenceScore: price.marketPrice ? 76 : price.midPrice ? 66 : 56,
      score: price.marketPrice ? 3 : price.midPrice ? 2 : 1,
      subTypeName,
      usd,
    };
    const existing = bestBySubtype.get(subTypeName);

    if (!existing || candidate.score > existing.score) {
      bestBySubtype.set(subTypeName, candidate);
    }
  }

  return [...bestBySubtype.values()]
    .map((price) => ({
      confidenceScore: price.confidenceScore,
      subTypeName: price.subTypeName,
      usd: price.usd,
    }))
    .sort((left, right) => variantSortRank(left.subTypeName) - variantSortRank(right.subTypeName));
}

function variantSortRank(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const ranks = {
    normal: 10,
    holofoil: 20,
    reverseholofoil: 30,
    reverseholo: 30,
    "1stedition": 40,
    "1steditionholofoil": 40,
    firstedition: 40,
    firsteditionholofoil: 40,
    shadowless: 45,
    shadowlessholofoil: 45,
    unlimited: 50,
    unlimitedholofoil: 50,
  };

  return ranks[normalized] ?? 60;
}

function tcgcsvVariantIdentityKey(cardPrintingId, sourceRef, subTypeName) {
  return `${cardPrintingId}\u0000${String(sourceRef ?? "")}\u0000${String(subTypeName ?? "Normal")}`;
}

function compareProviderRefs(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  return left.localeCompare(right);
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
    .replace(/\(\s*\d{4}\s+unnumbered\s*\)/g, " ")
    .replace(/\b(?:1st edition|first edition|shadowless|unlimited|holofoil|reverse holofoil|reverse holo|prerelease|pre release|stamped promo|stamped)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function cardGroupProviderCodes(group) {
  const idAliases = cardGroupProviderAliases.get(String(group.groupId));
  const nameAliases = cardGroupNameProviderAliases.get(normalizedAliasKey(group.name));

  return [...new Set([
    group.abbreviation,
    ...(idAliases ?? []),
    ...(nameAliases ?? []),
  ])]
    .map(normalizedProviderCode)
    .filter(Boolean);
}

function reviewedCardGroupProviderCodes(group) {
  return (reviewedCardGroupProviderAliases.get(reviewedCardGroupIdentity(group)) ?? [])
    .map(normalizedProviderCode)
    .filter(Boolean);
}

function supplementalReviewedCardGroupProviderCodes(group) {
  return (supplementalReviewedCardGroupProviderAliases.get(reviewedCardGroupIdentity(group)) ?? [])
    .map(normalizedProviderCode)
    .filter(Boolean);
}

function reviewedCardGroupIdentity(group) {
  return `${String(group.groupId)}:${normalizedAliasKey(group.name)}`;
}

function buildReviewedProviderOwnership(reviewedAliases) {
  const ownerByProviderCode = new Map();
  const ambiguousProviderCodes = new Set();

  for (const [owner, aliases] of reviewedAliases) {
    for (const alias of aliases) {
      const providerCode = normalizedProviderCode(alias);
      const existingOwner = ownerByProviderCode.get(providerCode);

      if (!providerCode || ambiguousProviderCodes.has(providerCode)) {
        continue;
      }

      if (existingOwner && existingOwner !== owner) {
        ownerByProviderCode.delete(providerCode);
        ambiguousProviderCodes.add(providerCode);
      } else {
        ownerByProviderCode.set(providerCode, owner);
      }
    }
  }

  return { ambiguousProviderCodes, ownerByProviderCode };
}

function matchKey({ group, set }) {
  return `${group.groupId}:${set.id}`;
}

function normalizedAliasKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizedProviderCode(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/^([a-z]+)0+(?=\d)/, "$1");
}

function setProviderId(set) {
  if (typeof set.providerId === "string") {
    return set.providerId;
  }

  if (set.providerIds && typeof set.providerIds === "object" && !Array.isArray(set.providerIds)) {
    return (
      set.providerIds.pokemon_tcg_api ??
      set.providerIds.tcgdex_ja ??
      set.providerIds.tcgdex_zh_tw ??
      set.providerIds.tcgdex_zh_cn ??
      set.providerIds.tcgdex_ko ??
      set.providerIds.tcgdex
    );
  }

  return undefined;
}

function unpricedCardCount(set) {
  if (!Array.isArray(set.cardPrintings)) {
    return 0;
  }

  return set.cardPrintings.filter((card) => cardPriceSnapshotCount(card) === 0).length;
}

function cardPriceSnapshotCount(card) {
  if (Array.isArray(card.priceSnapshots)) {
    return card.priceSnapshots.length;
  }

  return Number(card._count?.priceSnapshots ?? 0);
}

export function compareCardGroupRefreshPriority(left, right, {
  prioritizeUnpriced = false,
} = {}) {
  const leftUnpriced = unpricedCardCount(left);
  const rightUnpriced = unpricedCardCount(right);

  if (prioritizeUnpriced && leftUnpriced !== rightUnpriced) {
    return rightUnpriced - leftUnpriced;
  }

  const leftLatest = latestCardPriceSnapshotTime(left);
  const rightLatest = latestCardPriceSnapshotTime(right);

  if (leftLatest !== rightLatest) {
    return leftLatest - rightLatest;
  }

  if (leftUnpriced !== rightUnpriced) {
    return rightUnpriced - leftUnpriced;
  }

  const leftRelease = dateTime(left.releaseDate);
  const rightRelease = dateTime(right.releaseDate);

  if (leftRelease !== rightRelease) {
    return rightRelease - leftRelease;
  }

  return String(left.name ?? "").localeCompare(String(right.name ?? ""));
}

function latestCardPriceSnapshotTime(set) {
  if (!Array.isArray(set.cardPrintings)) {
    return 0;
  }

  return set.cardPrintings.reduce((latest, card) => {
    if (!Array.isArray(card.priceSnapshots)) {
      return latest;
    }

    return card.priceSnapshots.reduce((cardLatest, snapshot) => Math.max(cardLatest, dateTime(snapshot.observedAt)), latest);
  }, 0);
}

function dateTime(value) {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();

  return Number.isFinite(time) ? time : 0;
}

function conversionRate(value) {
  const rate = Number(value);

  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

function categoryIdForLanguage(value) {
  return normalizedLanguage(value) === "ja" ? tcgcsvPokemonJapanCategoryId : tcgcsvPokemonCategoryId;
}

function languageForCategory(value) {
  return Number(value) === tcgcsvPokemonJapanCategoryId ? "ja" : "en";
}

function sourceForCategory(value) {
  return Number(value) === tcgcsvPokemonJapanCategoryId ? "tcgcsv-japan-card" : "tcgcsv-card";
}

function normalizedLanguage(value) {
  return optionalString(value)?.toLowerCase().replaceAll("_", "-") ?? "en";
}

function optionalString(value) {
  const trimmed = String(value ?? "").trim();

  return trimmed || undefined;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
