import {
  ItemCondition,
  ItemType,
  PrismaClient,
} from "@prisma/client";
import { deterministicUuid, extendedDataValue } from "./tcgcsv-sealed-products.mjs";
import { fetchJsonWithRetry } from "./provider-fetch.mjs";

const reviewedGroups = [
  {
    categoryId: 3,
    expectedGroupName: "ME: Mega Evolution Promo",
    groupId: "24451",
    cards: [
      {
        artist: "Shimaris Yukichi",
        idSeed: "tcgdex-card:en:mep-070",
        name: "Tyrunt",
        number: "070",
        rarity: "Promo",
        searchAliases: ["MEP 070", "Mega Evolution Promo 070"],
        subtypes: ["Basic"],
        supertype: "Pokemon",
        products: [
          {
            expectedName: "Tyrunt - 070",
            expectedNumber: "070",
            expectedSubtype: "Holofoil",
            primaryImage: true,
            productId: "685562",
            variantLabel: "Holofoil",
          },
          {
            expectedName: "Tyrunt - 070 (Pokemon Center Exclusive)",
            expectedNumber: "070",
            expectedSubtype: "Holofoil",
            productId: "685563",
            stamp: ["pokemon-center"],
            variantLabel: "Pokémon Center Stamp Holofoil",
          },
        ],
      },
    ],
    set: {
      idSeed: "tcgdex-set:en:mep",
      language: "en",
      metadata: {
        catalogueScope: "reviewed-supplement",
        provider: "tcgdex+tcgcsv",
        regionLabel: "International",
      },
      name: "MEP Black Star Promos",
      providerIds: {
        tcgdex: "mep",
        tcgdex_en: "mep",
        tcgcsv_card_group: "24451",
        tcgcsv_card_group_code: "MEP",
      },
      region: "international",
      releaseDate: "2025-09-26",
      total: 89,
    },
  },
  {
    categoryId: 3,
    expectedGroupName: "Trading Card Game Classic",
    groupId: "23323",
    cards: [
      {
        idSeed: "reviewed-tcgcsv-card:en:527918",
        name: "Sun Seed",
        number: "027",
        rarity: "Classic Collection",
        searchAliases: ["027/034", "CLV", "Venusaur and Lugia ex deck"],
        subtypes: ["Tool"],
        supertype: "Trainer",
        products: [
          {
            expectedName: "Sun Seed",
            expectedNumber: "027/034",
            expectedSubtype: "Holofoil",
            primaryImage: true,
            productId: "527918",
            variantLabel: "Holofoil",
          },
        ],
      },
      {
        idSeed: "reviewed-tcgcsv-card:en:528026",
        name: "Drops in the Ocean",
        number: "021",
        rarity: "Classic Collection",
        searchAliases: ["021/034", "CLB", "Blastoise and Suicune ex deck"],
        subtypes: ["Tool"],
        supertype: "Trainer",
        products: [
          {
            expectedName: "Drops in the Ocean",
            expectedNumber: "021/034",
            expectedSubtype: "Holofoil",
            primaryImage: true,
            productId: "528026",
            variantLabel: "Holofoil",
          },
        ],
      },
      {
        idSeed: "reviewed-tcgcsv-card:en:527972",
        name: "Scorching Charcoal",
        number: "026",
        rarity: "Classic Collection",
        searchAliases: [
          "026/034",
          "CLC",
          "Charizard and Ho-Oh ex deck",
          "Scorching Coal",
        ],
        subtypes: ["Tool"],
        supertype: "Trainer",
        products: [
          {
            expectedName: "Scorching Charcoal",
            expectedNumber: "026/034",
            expectedSubtype: "Holofoil",
            primaryImage: true,
            productId: "527972",
            variantLabel: "Holofoil",
          },
        ],
      },
    ],
    set: {
      idSeed: "reviewed-tcgcsv-set:en:23323",
      language: "en",
      metadata: {
        catalogueScope: "reviewed-supplement",
        provider: "tcgcsv",
        regionLabel: "International",
        sourceCardCount: 102,
      },
      name: "Trading Card Game Classic",
      providerIds: {
        tcgcsv_card_group: "23323",
        tcgcsv_card_group_code: "CL",
      },
      region: "international",
      releaseDate: "2023-11-17",
      total: 102,
    },
  },
  {
    categoryId: 85,
    expectedGroupName: "XY6: Emerald Break",
    groupId: "23923",
    cards: [
      {
        idSeed: "tcgdex-card:ja:XY6-061",
        name: "レックウザEX",
        number: "061",
        rarity: "Double Rare",
        searchAliases: [
          "Rayquaza EX",
          "Rayquaza-EX",
          "061/078",
          "Emerald Break",
          "エメラルドブレイク",
        ],
        subtypes: ["Basic", "EX"],
        supertype: "Pokemon",
        products: [
          {
            expectedName: "Rayquaza EX - 061/078",
            expectedNumber: "061/078",
            expectedSubtype: "1st Edition Holofoil",
            primaryImage: true,
            productId: "603855",
            variantLabel: "1st Edition Holofoil",
          },
        ],
      },
    ],
    set: {
      idSeed: "tcgdex-set:ja:XY6",
      language: "ja",
      metadata: {
        catalogueScope: "reviewed-supplement",
        localName: "エメラルドブレイク",
        provider: "tcgdex+tcgcsv",
        regionLabel: "Japan",
      },
      name: "Emerald Break",
      printedTotal: 78,
      providerIds: {
        tcgdex: "XY6",
        tcgdex_ja: "XY6",
        tcgcsv_card_group: "23923",
        tcgcsv_card_group_code: "XY6",
      },
      region: "jp",
      releaseDate: "2015-03-14",
      total: 91,
    },
  },
  {
    categoryId: 3,
    expectedGroupName: "Miscellaneous Cards & Products",
    groupId: "2374",
    cards: [
      {
        existingIdSeed: "pokemon-tcg-card:rsv10pt5-62",
        expectedExistingName: "Zoroark",
        expectedExistingNumber: "62",
        searchAliases: ["062/086", "White Flare Stamp", "White Flare Stamped"],
        products: [
          {
            expectedName: "Zoroark (White Flare Stamped)",
            expectedNumber: "062/086",
            expectedSubtype: "Holofoil",
            productId: "668959",
            stamp: ["set-logo"],
            variantLabel: "White Flare Stamp Holofoil",
          },
        ],
      },
      {
        existingIdSeed: "pokemon-tcg-card:sv7-30",
        expectedExistingName: "Blastoise ex",
        expectedExistingNumber: "30",
        searchAliases: ["030/142", "Stellar Crown Stamp", "Stellar Crown Stamped"],
        products: [
          {
            expectedName: "Blastoise ex (Stellar Crown Stamp)",
            expectedNumber: "030/142",
            expectedSubtype: "Holofoil",
            productId: "648587",
            stamp: ["set-logo"],
            variantLabel: "Stellar Crown Stamp Holofoil",
          },
        ],
      },
      {
        existingIdSeed: "pokemon-tcg-card:sv7-1",
        expectedExistingName: "Venusaur ex",
        expectedExistingNumber: "1",
        searchAliases: ["001/142", "Stellar Crown Stamp", "Stellar Crown Stamped"],
        products: [
          {
            expectedName: "Venusaur ex (Stellar Crown Stamp)",
            expectedNumber: "001/142",
            expectedSubtype: "Holofoil",
            productId: "648585",
            stamp: ["set-logo"],
            variantLabel: "Stellar Crown Stamp Holofoil",
          },
        ],
      },
    ],
  },
];

export function reviewedTcgcsvCatalogueTargets() {
  return reviewedGroups.map((group) => ({
    categoryId: group.categoryId,
    expectedGroupName: group.expectedGroupName,
    groupId: group.groupId,
    productIds: group.cards.flatMap((card) => card.products.map((product) => product.productId)),
  }));
}

export function reviewedTcgcsvGroup(categoryId, groupId) {
  const normalizedCategory = Number(categoryId);
  const normalizedGroup = String(groupId ?? "").trim();
  const group = reviewedGroups.find((entry) =>
    entry.categoryId === normalizedCategory && entry.groupId === normalizedGroup);

  if (!group) {
    throw new Error(`TCGCSV group ${normalizedCategory}/${normalizedGroup || "(missing)"} is not in the reviewed catalogue allowlist.`);
  }

  return group;
}

export function validateReviewedTcgcsvProduct(product, specification) {
  const productId = String(product?.productId ?? "").trim();
  const name = String(product?.name ?? "").trim();
  const number = String(extendedDataValue(product, "Number") ?? "").trim();

  if (productId !== specification.productId) {
    throw new Error(`Reviewed TCGCSV product identity changed: expected ${specification.productId}, received ${productId || "none"}.`);
  }

  if (name !== specification.expectedName || number !== specification.expectedNumber) {
    throw new Error(
      `Reviewed TCGCSV product ${productId} no longer matches its approved identity ` +
      `(${name || "unnamed"}, ${number || "unnumbered"}).`,
    );
  }
}

export async function syncReviewedTcgcsvCardCatalogue(options = {}) {
  const prisma = options.prisma ?? new PrismaClient();
  const shouldDisconnect = !options.prisma;
  const fetchImpl = options.fetchImpl ?? fetch;
  const group = reviewedTcgcsvGroup(options.categoryId, options.groupId);
  const writePrices = options.writePrices ?? true;
  const usdToGbpRate = positiveRate(options.usdToGbpRate);
  const observedAt = reviewedObservedAt(options.observedAt);
  const snapshotDay = observedAt.toISOString().slice(0, 10);
  const reviewedAt = `${snapshotDay}T00:00:00.000Z`;
  const fetchOptions = {
    retryAttempts: positiveInteger(options.retryAttempts, 3),
    retryWaitMs: nonNegativeInteger(options.retryWaitMs, 500),
    timeoutMs: positiveInteger(options.timeoutMs, 12_000),
  };

  if (writePrices && !usdToGbpRate) {
    throw new Error("A positive USD-to-GBP rate is required for reviewed TCGCSV card prices.");
  }

  try {
    const [productsPayload, pricesPayload] = await Promise.all([
      fetchTcgcsvGroup(group, "products", fetchImpl, fetchOptions),
      fetchTcgcsvGroup(group, "prices", fetchImpl, fetchOptions),
    ]);
    const productsById = new Map((productsPayload.results ?? []).map((product) => [String(product.productId), product]));
    const pricesById = new Map();

    for (const price of pricesPayload.results ?? []) {
      const productId = String(price.productId ?? "");
      const prices = pricesById.get(productId) ?? [];

      prices.push(price);
      pricesById.set(productId, prices);
    }

    const setId = group.set ? deterministicUuid(group.set.idSeed) : undefined;

    // Validate every allowlisted provider identity and price before reading or
    // mutating a local row. A drift or missing price in the final product must
    // not leave earlier cards written while the job still reports success.
    const priceValidationFailures = [];
    const preparedCards = group.cards.map((cardSpecification) => {
      const selectedProducts = cardSpecification.products.map((productSpecification) => {
        const product = productsById.get(productSpecification.productId);

        if (!product) {
          throw new Error(`Reviewed TCGCSV product ${productSpecification.productId} is missing from group ${group.groupId}.`);
        }

        validateReviewedTcgcsvProduct(product, productSpecification);
        const priceRows = pricesById.get(productSpecification.productId) ?? [];
        const selectedPrice = writePrices
          ? selectReviewedPrice(priceRows, productSpecification.expectedSubtype)
          : undefined;

        if (writePrices && !selectedPrice) {
          priceValidationFailures.push(reviewedPriceFailure({
            priceRows,
            productSpecification,
          }));
        }

        return {
          price: selectedPrice,
          product,
          specification: productSpecification,
        };
      });

      return {
        cardSpecification,
        id: deterministicUuid(cardSpecification.existingIdSeed ?? cardSpecification.idSeed),
        selectedProducts,
      };
    });

    if (priceValidationFailures.length) {
      throw new Error(
        `Reviewed TCGCSV price validation failed for group ${group.categoryId}/${group.groupId}; ` +
        `no catalogue or price data was written. ${priceValidationFailures.join(" ")}`,
      );
    }

    const [existingSet, ...existingCards] = await Promise.all([
      group.set
        ? prisma.cardSet.findUnique({
            select: { language: true, metadata: true, name: true, providerIds: true },
            where: { id: setId },
          })
        : Promise.resolve(null),
      ...preparedCards.map((prepared) => prisma.cardPrinting.findUnique({
        select: {
          cardSetId: true,
          imageLargeUrl: true,
          imageSmallUrl: true,
          language: true,
          name: true,
          number: true,
          providerIds: true,
          region: true,
          searchText: true,
          variantMetadata: true,
        },
        where: { id: prepared.id },
      })),
    ]);

    validateExistingReviewedSet(existingSet, group);

    const cardMutations = preparedCards.map((prepared, index) => {
      const existing = existingCards[index];

      validateExistingReviewedCard(existing, prepared, group, setId);
      return buildReviewedCardMutation({ ...prepared, existing, group, setId });
    });

    const summary = {
      cardsUpdated: 0,
      categoryId: group.categoryId,
      expectedGroupName: group.expectedGroupName,
      groupId: group.groupId,
      priceSnapshotsCreated: 0,
      priceSnapshotsUpdated: 0,
      priceSnapshotsWritten: 0,
      productsMatched: 0,
      productsWithoutPrice: 0,
      provider: "tcgcsv-reviewed-catalogue",
      setsUpserted: group.set ? 1 : 0,
      writePrices,
    };

    const snapshotMutations = [];

    for (const mutation of cardMutations) {
      summary.cardsUpdated += 1;

      for (const selected of mutation.selectedProducts) {
        summary.productsMatched += 1;

        if (!writePrices) {
          continue;
        }

        const price = selected.price;

        if (!price) {
          throw new Error(
            `Reviewed TCGCSV internal price validation failed for product ${selected.specification.productId}.`,
          );
        }

        const data = reviewedPriceSnapshot({
          card: mutation.card,
          group,
          observedAt,
          price,
          product: selected.product,
          productSpecification: selected.specification,
          snapshotDay,
          usdToGbpRate,
        });
        const id = reviewedDailySnapshotId(data, snapshotDay);

        snapshotMutations.push({ data, id });
      }
    }

    const existingSnapshotIds = await findExistingSnapshotIds(prisma, snapshotMutations.map((entry) => entry.id));
    summary.priceSnapshotsCreated = snapshotMutations.length - existingSnapshotIds.size;
    summary.priceSnapshotsUpdated = existingSnapshotIds.size;
    summary.priceSnapshotsWritten = snapshotMutations.length;

    await withWriteTransaction(prisma, async (transaction) => {
      if (group.set) {
        const data = reviewedSetData(existingSet, group, reviewedAt);

        await transaction.cardSet.upsert({
          create: { id: setId, ...data },
          update: data,
          where: { id: setId },
        });
      }

      for (const mutation of cardMutations) {
        if (mutation.existingOnly) {
          await transaction.cardPrinting.update({
            data: mutation.data,
            where: { id: mutation.id },
          });
        } else {
          await transaction.cardPrinting.upsert({
            create: { id: mutation.id, ...mutation.data },
            update: mutation.data,
            where: { id: mutation.id },
          });
        }
      }

      for (const mutation of snapshotMutations) {
        await transaction.priceSnapshot.upsert({
          create: { id: mutation.id, ...mutation.data },
          update: mutation.data,
          where: { id: mutation.id },
        });
      }
    });

    return summary;
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

async function fetchTcgcsvGroup(group, resource, fetchImpl, options) {
  const { body } = await fetchJsonWithRetry({
    fetchImpl,
    init: {
      headers: {
        accept: "application/json",
        "user-agent": "MintBinderLocalImporter/0.1",
      },
    },
    maxResponseBytes: 32 * 1024 * 1024,
    provider: `TCGCSV ${group.expectedGroupName} ${resource}`,
    retryAttempts: options.retryAttempts,
    retryInvalidResponse: true,
    retryWaitMs: options.retryWaitMs,
    timeoutMs: options.timeoutMs,
    url: `https://tcgcsv.com/tcgplayer/${group.categoryId}/${group.groupId}/${resource}`,
    validate: (payload) => payload && Array.isArray(payload.results),
  });

  return body;
}

function reviewedSetData(existing, group, reviewedAt) {
  return {
    language: group.set.language,
    metadata: {
      ...jsonObject(existing?.metadata),
      ...group.set.metadata,
      reviewedTcgcsvCatalogueAt: reviewedAt,
    },
    name: group.set.name,
    printedTotal: group.set.printedTotal,
    providerIds: {
      ...jsonObject(existing?.providerIds),
      ...group.set.providerIds,
    },
    region: group.set.region,
    releaseDate: group.set.releaseDate ? new Date(`${group.set.releaseDate}T00:00:00.000Z`) : undefined,
    total: group.set.total,
  };
}

function buildReviewedCardMutation({ cardSpecification, existing, group, id, selectedProducts, setId }) {
  const primaryProduct = selectedProducts.find((entry) => entry.specification.primaryImage)?.product;
  const productIds = selectedProducts.map((entry) => entry.specification.productId);
  const reviewedVariants = selectedProducts.map((entry) => ({
    label: entry.specification.variantLabel,
    source: sourceForCategory(group.categoryId),
    sourceRef: entry.specification.productId,
  }));
  const variantsDetailed = selectedProducts.map((entry) => ({
    size: "standard",
    ...(entry.specification.stamp ? { stamp: entry.specification.stamp } : {}),
    thirdParty: { tcgplayer: Number(entry.specification.productId) },
    type: variantType(entry.specification.expectedSubtype),
    variantId: `tcgplayer-${entry.specification.productId}`,
  }));
  const existingMetadata = jsonObject(existing?.variantMetadata);
  const reviewedSearchTerms = uniqueStrings([
    ...stringArray(existingMetadata.reviewedSearchTerms),
    cardSpecification.name ?? existing?.name,
    group.set?.name,
    cardSpecification.number ?? existing?.number,
    ...cardSpecification.searchAliases,
    ...selectedProducts.flatMap((entry) => [
      entry.product.name,
      entry.specification.expectedNumber,
      entry.specification.variantLabel,
    ]),
    group.set?.language === "ja" ? "Japanese Japan ja 日本語" : "English en international",
  ]);
  const variantMetadata = {
    ...existingMetadata,
    availablePrices: uniqueStrings([
      ...stringArray(existingMetadata.availablePrices),
      ...selectedProducts.map((entry) => entry.specification.variantLabel),
    ]),
    provider: existingMetadata.provider ?? "tcgcsv-reviewed-catalogue",
    reviewedSearchTerms,
    reviewedVariants: mergeReviewedVariants(existingMetadata.reviewedVariants, reviewedVariants),
    variantsDetailed: mergeDetailedVariants(existingMetadata.variantsDetailed, variantsDetailed),
  };
  const providerIds = {
    ...jsonObject(existing?.providerIds),
    ...(cardSpecification.idSeed && group.set?.providerIds?.tcgdex
      ? {
          tcgdex: tcgdexCardProviderId(cardSpecification.idSeed),
          [`tcgdex_${group.set.language.replaceAll("-", "_")}`]: tcgdexCardProviderId(cardSpecification.idSeed),
        }
      : {}),
    tcgcsv_reviewed_products: uniqueStrings([
      ...stringArray(jsonObject(existing?.providerIds).tcgcsv_reviewed_products),
      ...productIds,
    ]),
  };
  const reviewedBaseSearchText = String(
    existingMetadata.reviewedBaseSearchText ??
    existing?.searchText ??
    [cardSpecification.name, cardSpecification.number, group.set?.name].filter(Boolean).join(" "),
  ).trim().toLowerCase();
  const searchText = uniqueStrings([
    reviewedBaseSearchText,
    ...reviewedSearchTerms,
  ]).join(" ").toLowerCase();
  variantMetadata.reviewedBaseSearchText = reviewedBaseSearchText;
  variantMetadata.reviewedSearchText = searchText;

  if (cardSpecification.existingIdSeed) {
    return {
      card: { id, language: existing.language },
      data: { providerIds, searchText, variantMetadata },
      existingOnly: true,
      id,
      selectedProducts,
    };
  }

  const imageSmallUrl = primaryProduct?.imageUrl ?? existing?.imageSmallUrl;
  const imageLargeUrl = imageSmallUrl ? upgradedTcgplayerCardImageUrl(imageSmallUrl) : existing?.imageLargeUrl;
  const data = {
    artist: cardSpecification.artist,
    cardSetId: setId,
    imageLargeUrl,
    imageSmallUrl,
    language: group.set.language,
    legalities: {},
    name: cardSpecification.name,
    number: cardSpecification.number,
    providerIds,
    rarity: cardSpecification.rarity,
    region: group.set.region,
    searchText,
    subtypes: cardSpecification.subtypes,
    supertype: cardSpecification.supertype,
    variantMetadata,
  };

  return {
    card: { id, language: group.set.language },
    data,
    existingOnly: false,
    id,
    selectedProducts,
  };
}

function selectReviewedPrice(prices, expectedSubtype) {
  const normalizedSubtype = normalizedText(expectedSubtype);
  const candidates = prices.filter((price) => normalizedText(price.subTypeName) === normalizedSubtype);

  return candidates
    .map((price) => {
      const selected = firstPositivePrice(price);

      return selected ? { ...price, ...selected } : undefined;
    })
    .filter(Boolean)
    .sort((left, right) => right.confidenceScore - left.confidenceScore)[0];
}

function reviewedPriceFailure({ priceRows, productSpecification }) {
  const expectedSubtype = productSpecification.expectedSubtype;
  const matchingRows = priceRows.filter((price) =>
    normalizedText(price.subTypeName) === normalizedText(expectedSubtype));
  const availableSubtypes = uniqueStrings(
    priceRows.map((price) => String(price?.subTypeName ?? "").trim()).filter(Boolean),
  );
  const availableLabel = availableSubtypes.length
    ? availableSubtypes.map((value) => `"${value}"`).join(", ")
    : "none";
  const productLabel = productSpecification.expectedName
    ? ` (${productSpecification.expectedName})`
    : "";

  if (!matchingRows.length) {
    return (
      `Product ${productSpecification.productId}${productLabel}: expected price subtype ` +
      `"${expectedSubtype}" was not returned (available subtypes: ${availableLabel}).`
    );
  }

  return (
    `Product ${productSpecification.productId}${productLabel}: price subtype "${expectedSubtype}" ` +
    "has no positive marketPrice, midPrice, lowPrice, or directLowPrice value."
  );
}

function reviewedPriceSnapshot({ card, group, observedAt, price, product, productSpecification, snapshotDay, usdToGbpRate }) {
  return {
    cardPrintingId: card.id,
    condition: ItemCondition.NEAR_MINT,
    confidenceScore: price.confidenceScore,
    currency: "GBP",
    itemType: ItemType.CARD,
    language: card.language,
    metadata: {
      categoryId: group.categoryId,
      conversionRate: usdToGbpRate,
      groupId: group.groupId,
      groupName: group.expectedGroupName,
      originalCurrency: "USD",
      originalPrice: price.usd,
      priceSource: "TCGCSV TCGplayer market",
      reviewedSupplement: true,
      reviewedSnapshotDay: snapshotDay,
      selectedPriceField: price.selectedPriceField,
      subTypeName: price.subTypeName,
      tcgplayerUrl: product.url,
    },
    observedAt,
    priceMinor: Math.round(price.usd * usdToGbpRate * 100),
    source: sourceForCategory(group.categoryId),
    sourceRef: productSpecification.productId,
    variantLabel: productSpecification.variantLabel,
  };
}

function firstPositivePrice(price) {
  const candidates = [
    ["marketPrice", 76],
    ["midPrice", 66],
    ["lowPrice", 56],
    ["directLowPrice", 56],
  ];

  for (const [selectedPriceField, confidenceScore] of candidates) {
    const usd = positiveRate(price[selectedPriceField]);

    if (usd) return { confidenceScore, selectedPriceField, usd };
  }

  return undefined;
}

function reviewedDailySnapshotId(data, snapshotDay) {
  return deterministicUuid([
    "reviewed-tcgcsv-price-snapshot",
    snapshotDay,
    data.itemType,
    data.cardPrintingId ?? data.sealedProductId ?? "none",
    data.source,
    data.sourceRef ?? "none",
    data.condition ?? "none",
    data.language ?? "none",
    data.variantLabel ?? "none",
    data.currency,
  ].join(":"));
}

async function findExistingSnapshotIds(prisma, ids) {
  if (!ids.length || typeof prisma.priceSnapshot.findMany !== "function") return new Set();

  const existing = await prisma.priceSnapshot.findMany({
    select: { id: true },
    where: { id: { in: ids } },
  });

  return new Set(existing.map((entry) => entry.id));
}

async function withWriteTransaction(prisma, task) {
  if (typeof prisma.$transaction !== "function") {
    throw new Error("Reviewed TCGCSV catalogue writes require Prisma transaction support.");
  }

  return prisma.$transaction(task);
}

function validateExistingReviewedSet(existing, group) {
  if (!existing || !group.set) return;

  const providerIds = jsonObject(existing.providerIds);
  const existingGroupId = String(providerIds.tcgcsv_card_group ?? "").trim();

  if (
    existing.name !== group.set.name ||
    existing.language !== group.set.language ||
    (existingGroupId && existingGroupId !== group.groupId)
  ) {
    throw new Error(`Reviewed supplemental set ${group.groupId} no longer matches its approved identity.`);
  }
}

function validateExistingReviewedCard(existing, prepared, group, setId) {
  const { cardSpecification, id } = prepared;

  if (cardSpecification.existingIdSeed && !existing) {
    throw new Error(`Reviewed supplemental card target ${id} is missing from the local catalogue.`);
  }

  if (!existing) return;

  const expectedName = cardSpecification.expectedExistingName ?? cardSpecification.name;
  const expectedNumber = cardSpecification.expectedExistingNumber ?? cardSpecification.number;
  const expectedLanguage = cardSpecification.existingIdSeed ? existing.language : group.set?.language;

  if (
    existing.name !== expectedName ||
    normalizedCardNumber(existing.number) !== normalizedCardNumber(expectedNumber) ||
    existing.language !== expectedLanguage ||
    (!cardSpecification.existingIdSeed && existing.cardSetId !== setId)
  ) {
    throw new Error(`Reviewed supplemental card target ${id} no longer matches its approved identity.`);
  }
}

function mergeReviewedVariants(existing, incoming) {
  const byRef = new Map();

  for (const variant of [...objectArray(existing), ...incoming]) {
    const key = String(variant.sourceRef ?? variant.label ?? "").trim();

    if (key) byRef.set(key, variant);
  }

  return [...byRef.values()];
}

function mergeDetailedVariants(existing, incoming) {
  const byIdentity = new Map();

  for (const variant of [...objectArray(existing), ...incoming]) {
    const key = String(variant.variantId ?? JSON.stringify(variant));

    byIdentity.set(key, variant);
  }

  return [...byIdentity.values()];
}

function tcgdexCardProviderId(seed) {
  return String(seed).split(":").slice(2).join(":");
}

function variantType(value) {
  const normalized = normalizedText(value);

  if (normalized.includes("reverse")) return "reverse";
  if (normalized.includes("holo")) return "holo";
  return "normal";
}

function upgradedTcgplayerCardImageUrl(value) {
  return String(value).replace(/_(?:200w|400w)(\.[a-z0-9]+)$/i, "_in_1000x1000$1");
}

function sourceForCategory(categoryId) {
  return Number(categoryId) === 85 ? "tcgcsv-japan-card" : "tcgcsv-card";
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

function normalizedText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function jsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function objectArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function reviewedObservedAt(value) {
  const observedAt = value === undefined ? new Date() : new Date(value);

  if (Number.isNaN(observedAt.getTime())) {
    throw new Error("Reviewed TCGCSV observedAt must be a valid date.");
  }

  return observedAt;
}

function positiveRate(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function positiveInteger(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}
