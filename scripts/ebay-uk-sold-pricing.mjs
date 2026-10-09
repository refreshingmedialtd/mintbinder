import { createHash } from "node:crypto";
import {
  ItemCondition,
  ItemType,
  PrismaClient,
} from "@prisma/client";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import { fetchJsonWithRetry } from "./provider-fetch.mjs";

const endpoint = "https://api.ebaysoldlistingsapi.com/scrape";
const sourceName = "ebay-uk-sold";
const DAY_MS = 24 * 60 * 60 * 1_000;

export function ebayUkSoldOptionsFromEnv(env = process.env) {
  return {
    apiKey: stringSetting(env.EBAYSOLDLISTINGS_API_KEY),
    cardIds: uuidList(env.EBAY_UK_SOLD_CARD_IDS),
    customerVisible: booleanSetting(env.EBAY_UK_SOLD_CUSTOMER_VISIBLE, false),
    enabled: booleanSetting(env.EBAY_UK_SOLD_ENABLED, false),
    limit: Math.min(50, positiveInteger(env.EBAY_UK_SOLD_LIMIT, 10)),
    lookbackDays: Math.min(365, positiveInteger(env.EBAY_UK_SOLD_LOOKBACK_DAYS, 90)),
    minComparableSales: Math.min(20, positiveInteger(env.EBAY_UK_SOLD_MIN_COMPARABLE_SALES, 3)),
    requestCount: Math.min(240, positiveInteger(env.EBAY_UK_SOLD_REQUEST_COUNT, 120)),
    retryAttempts: Math.min(5, positiveInteger(env.EBAY_UK_SOLD_RETRY_ATTEMPTS, 4)),
    retryWaitMs: nonNegativeInteger(env.EBAY_UK_SOLD_RETRY_WAIT_MS, 1_500),
    timeoutMs: Math.max(90_000, positiveInteger(env.EBAY_UK_SOLD_TIMEOUT_MS, 95_000)),
    writePrices: booleanSetting(env.EBAY_UK_SOLD_WRITE_PRICES, false),
  };
}

export async function syncEbayUkSoldPrices(options = {}) {
  const prisma = options.prisma ?? new PrismaClient();
  const shouldDisconnect = !options.prisma;
  const enabled = options.enabled === true;
  const writePrices = options.writePrices === true;
  const customerVisible = options.customerVisible === true;
  const apiKey = stringSetting(options.apiKey);
  const observedAt = validDate(options.observedAt) ?? new Date();
  const limit = Math.min(50, positiveInteger(options.limit, 10));
  const summary = {
    apiAttempts: 0,
    apiRequests: 0,
    candidatesAvailable: 0,
    candidatesChecked: 0,
    customerVisible,
    enabled,
    estimatesAccepted: 0,
    estimatesRejected: 0,
    evidence: [],
    pricingSnapshotsCreated: 0,
    pricingSnapshotsUpdated: 0,
    provider: sourceName,
    quotaRemaining: null,
    status: "succeeded",
    writePrices,
  };

  if (!enabled) {
    summary.status = "not_configured";
    if (shouldDisconnect) await prisma.$disconnect();
    return summary;
  }

  if (!apiKey) {
    if (shouldDisconnect) await prisma.$disconnect();
    throw new Error("EBAYSOLDLISTINGS_API_KEY must be set for eBay UK sold-price benchmarking.");
  }

  if (writePrices && !customerVisible) {
    if (shouldDisconnect) await prisma.$disconnect();
    throw new Error(
      "EBAY_UK_SOLD_CUSTOMER_VISIBLE=true is required before eBay UK sold estimates can be persisted and selected for customer valuations.",
    );
  }

  try {
    const targets = options.targets ?? await selectEbayUkSoldTargets(prisma, {
      cardIds: options.cardIds ?? [],
      limit,
    });
    summary.candidatesAvailable = targets.length;
    const request = createEbayUkSoldRequester({
      apiKey,
      fetchImpl: options.fetchImpl ?? fetch,
      requestCount: Math.min(240, positiveInteger(options.requestCount, 120)),
      retryAttempts: Math.min(5, positiveInteger(options.retryAttempts, 4)),
      retryWaitMs: nonNegativeInteger(options.retryWaitMs, 1_500),
      summary,
      timeoutMs: Math.max(90_000, positiveInteger(options.timeoutMs, 95_000)),
    });

    for (const target of targets.slice(0, limit)) {
      summary.candidatesChecked += 1;
      const query = buildEbayUkSearchQuery(target);
      const response = await request(query, {
        lookbackDays: Math.min(365, positiveInteger(options.lookbackDays, 90)),
        now: observedAt,
      });
      const estimate = estimateEbayUkSoldPrice(target, response.results, {
        minComparableSales: Math.min(20, positiveInteger(options.minComparableSales, 3)),
        now: observedAt,
      });
      const evidence = {
        accepted: estimate.accepted,
        acceptedSales: estimate.acceptedSales.length,
        cardId: target.card.id,
        confidenceScore: estimate.confidenceScore,
        latestSaleAt: estimate.latestSaleAt,
        name: target.card.name,
        number: target.card.number,
        priceMinor: estimate.priceMinor,
        query,
        rejectionReasons: estimate.rejectionReasons,
        sampleSize: estimate.sampleSize,
        set: target.card.cardSet.name,
        spreadRatio: estimate.spreadRatio,
        variantLabel: target.variantLabel,
      };

      summary.evidence.push(evidence);

      if (!estimate.accepted) {
        summary.estimatesRejected += 1;
        continue;
      }

      summary.estimatesAccepted += 1;

      if (!writePrices) continue;

      const snapshot = ebayUkSoldSnapshot(target, estimate, { query });
      const outcome = await upsertDailyEbayUkSnapshot(prisma, snapshot);
      summary[outcome === "created" ? "pricingSnapshotsCreated" : "pricingSnapshotsUpdated"] += 1;
    }

    if (summary.candidatesChecked > 0 && summary.estimatesAccepted === 0) {
      summary.status = "degraded";
    } else if (summary.estimatesRejected > 0) {
      summary.status = "partial";
    }

    return summary;
  } finally {
    if (shouldDisconnect) await prisma.$disconnect();
  }
}

export async function selectEbayUkSoldTargets(prisma, { cardIds = [], limit = 10 } = {}) {
  const explicitIds = uuidList(cardIds);
  const cardWhere = explicitIds.length ? { id: { in: explicitIds } } : undefined;
  const cardSelect = {
    cardSet: { select: { name: true, printedTotal: true, total: true } },
    id: true,
    language: true,
    name: true,
    number: true,
    rarity: true,
    variantMetadata: true,
  };
  const [owned, wanted] = await Promise.all([
    prisma.collectionItem.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        cardPrinting: { select: cardSelect },
        condition: true,
        quantity: true,
        updatedAt: true,
        variantLabel: true,
      },
      take: Math.max(limit * 5, 50),
      where: {
        archivedAt: null,
        cardPrinting: cardWhere,
        cardPrintingId: { not: null },
        gradedCompany: null,
        itemType: ItemType.CARD,
        soldAt: null,
      },
    }),
    prisma.wishlistItem.findMany({
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      select: {
        cardPrinting: { select: cardSelect },
        priority: true,
        targetPriceMinor: true,
        updatedAt: true,
        variantLabel: true,
      },
      take: Math.max(limit * 5, 50),
      where: {
        cardPrinting: cardWhere,
        cardPrintingId: { not: null },
        itemType: ItemType.CARD,
      },
    }),
  ]);
  const targets = new Map();

  for (const item of owned) {
    if (!item.cardPrinting) continue;
    addTarget(targets, {
      card: item.cardPrinting,
      condition: item.condition,
      demand: "owned",
      priorityScore: 10_000 + Math.max(1, Number(item.quantity) || 1) * 100,
      updatedAt: item.updatedAt,
      variantLabel: item.variantLabel ?? "Standard",
    });
  }

  for (const item of wanted) {
    if (!item.cardPrinting) continue;
    addTarget(targets, {
      card: item.cardPrinting,
      condition: ItemCondition.NEAR_MINT,
      demand: "wishlist",
      priorityScore: wishlistPriorityScore(item.priority) + Math.min(5_000, item.targetPriceMinor ?? 0) / 10,
      updatedAt: item.updatedAt,
      variantLabel: item.variantLabel ?? "Standard",
    });
  }

  if (explicitIds.length) {
    const missingIds = explicitIds.filter(
      (id) => ![...targets.values()].some((target) => target.card.id === id),
    );

    if (missingIds.length) {
      const cards = await prisma.cardPrinting.findMany({
        select: cardSelect,
        where: { id: { in: missingIds } },
      });

      for (const card of cards) {
        addTarget(targets, {
          card,
          condition: ItemCondition.NEAR_MINT,
          demand: "explicit",
          priorityScore: 20_000,
          updatedAt: new Date(0),
          variantLabel: primaryVariantFromMetadata(card.variantMetadata),
        });
      }
    }
  }

  return [...targets.values()]
    .sort((left, right) =>
      right.priorityScore - left.priorityScore ||
      Date.parse(String(right.updatedAt)) - Date.parse(String(left.updatedAt)) ||
      left.card.id.localeCompare(right.card.id),
    )
    .slice(0, limit);
}

export function buildEbayUkSearchQuery(target) {
  const terms = [
    target.card.name,
    collectorNumberQuery(target.card),
    target.card.cardSet.name,
    variantQueryTerms(target.variantLabel),
    languageQueryTerm(target.card.language),
    rawConditionQueryTerm(target.condition),
  ].filter(Boolean);

  return uniqueStrings(terms).join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
}

export function classifyEbayUkSoldListing(target, listing, { now = new Date() } = {}) {
  const title = stringSetting(listing?.title);
  const normalizedTitle = normalizeText(title);

  if (!title) return rejected("missing_title");
  if (!rawCardTitle(normalizedTitle)) return rejected("not_single_raw_card");
  if (!titleMatchesCardName(normalizedTitle, target.card.name)) return rejected("card_name_mismatch");
  if (!titleMatchesCollectorNumber(normalizedTitle, target.card)) return rejected("collector_number_mismatch");
  if (!titleMatchesSet(normalizedTitle, target.card)) return rejected("set_mismatch");
  if (!titleMatchesLanguage(normalizedTitle, target.card.language)) return rejected("language_mismatch");

  const variant = titleMatchesVariant(normalizedTitle, target.variantLabel);
  if (!variant.ok) return rejected(variant.reason);

  if (!titleMatchesNearMint(normalizedTitle, listing?.condition)) {
    return rejected("near_mint_not_explicit");
  }

  const totalMinor = decimalToMinor(listing?.totalPrice ?? listing?.soldPrice);
  if (!totalMinor || String(listing?.soldCurrency ?? "").trim().toUpperCase() !== "GBP") {
    return rejected("invalid_gbp_total");
  }

  const endedAt = validDate(listing?.endedAt);
  if (!endedAt || endedAt.getTime() > now.getTime() + DAY_MS) return rejected("invalid_sale_date");

  return {
    accepted: true,
    sale: {
      endedAt: endedAt.toISOString(),
      itemId: stringSetting(listing?.itemId),
      sellerUsername: stringSetting(listing?.sellerUsername),
      title,
      totalMinor,
      url: safeEbayUrl(listing?.url),
    },
  };
}

export function estimateEbayUkSoldPrice(target, listings, {
  minComparableSales = 3,
  now = new Date(),
} = {}) {
  const rejectionReasons = {};
  const acceptedByIdentity = new Map();

  for (const listing of Array.isArray(listings) ? listings : []) {
    const classification = classifyEbayUkSoldListing(target, listing, { now });

    if (!classification.accepted) {
      rejectionReasons[classification.reason] = (rejectionReasons[classification.reason] ?? 0) + 1;
      continue;
    }

    const sale = classification.sale;
    const identity = sale.itemId || `${sale.title}\u0000${sale.endedAt}\u0000${sale.totalMinor}`;
    if (!acceptedByIdentity.has(identity)) acceptedByIdentity.set(identity, sale);
  }

  const acceptedSales = [...acceptedByIdentity.values()];
  const filtered = robustComparableSales(acceptedSales);
  const values = filtered.map((sale) => sale.totalMinor).sort((left, right) => left - right);
  const minimum = Math.max(1, Number(minComparableSales) || 3);
  const latestSaleAt = filtered
    .map((sale) => sale.endedAt)
    .sort()
    .at(-1) ?? null;
  const spreadRatio = values.length > 1 ? values.at(-1) / values[0] : null;
  const uniqueSellers = new Set(filtered.map((sale) => sale.sellerUsername).filter(Boolean)).size;
  const enoughSellers = uniqueSellers >= Math.min(2, minimum);
  const accepted = values.length >= minimum && enoughSellers;

  if (acceptedSales.length > filtered.length) {
    rejectionReasons.statistical_outlier = acceptedSales.length - filtered.length;
  }
  if (values.length >= minimum && !enoughSellers) {
    rejectionReasons.insufficient_unique_sellers = values.length;
  }

  return {
    accepted,
    acceptedSales: filtered,
    confidenceScore: accepted
      ? ebayUkConfidenceScore({ latestSaleAt, sampleSize: values.length, spreadRatio }, now)
      : null,
    latestSaleAt,
    priceMinor: accepted ? Math.round(median(values)) : null,
    rejectionReasons,
    sampleSize: values.length,
    spreadRatio: Number.isFinite(spreadRatio) ? Number(spreadRatio.toFixed(3)) : null,
  };
}

export function robustComparableSales(sales) {
  if (!Array.isArray(sales) || sales.length < 5) return Array.isArray(sales) ? [...sales] : [];
  const values = sales.map((sale) => sale.totalMinor).sort((left, right) => left - right);
  const centre = median(values);
  const deviations = values.map((value) => Math.abs(value - centre)).sort((left, right) => left - right);
  const mad = median(deviations);

  if (mad > 0) {
    const limit = 3.5 * 1.4826 * mad;
    return sales.filter((sale) => Math.abs(sale.totalMinor - centre) <= limit);
  }

  const firstQuartile = percentile(values, 0.25);
  const thirdQuartile = percentile(values, 0.75);
  const iqr = thirdQuartile - firstQuartile;
  if (iqr <= 0) return [...sales];
  return sales.filter((sale) =>
    sale.totalMinor >= firstQuartile - 1.5 * iqr &&
    sale.totalMinor <= thirdQuartile + 1.5 * iqr,
  );
}

export function ebayUkConfidenceScore({ latestSaleAt, sampleSize, spreadRatio }, now = new Date()) {
  const sampleScore = sampleSize >= 12 ? 74 : sampleSize >= 8 ? 69 : sampleSize >= 5 ? 64 : 58;
  const latestMs = Date.parse(String(latestSaleAt ?? ""));
  const ageDays = Number.isFinite(latestMs) ? Math.max(0, (now.getTime() - latestMs) / DAY_MS) : 365;
  const recency = ageDays <= 7 ? 7 : ageDays <= 30 ? 4 : ageDays <= 60 ? 1 : -5;
  const coherence = spreadRatio === null || spreadRatio <= 1.5
    ? 7
    : spreadRatio <= 2
      ? 2
      : -8;

  return Math.max(1, Math.min(88, sampleScore + recency + coherence));
}

function createEbayUkSoldRequester({
  apiKey,
  fetchImpl,
  requestCount,
  retryAttempts,
  retryWaitMs,
  summary,
  timeoutMs,
}) {
  return async (keyword, { lookbackDays, now }) => {
    const url = new URL(endpoint);
    url.searchParams.set("keyword", keyword);
    url.searchParams.set("ebaySite", "ebay.co.uk");
    url.searchParams.set("count", String(requestCount));
    url.searchParams.set("sold", "true");
    url.searchParams.set("sortOrder", "endedRecently");
    url.searchParams.set("itemCondition", "used");
    url.searchParams.set("itemLocation", "domestic");
    url.searchParams.set("soldAfter", new Date(now.getTime() - lookbackDays * DAY_MS).toISOString().slice(0, 10));
    const response = await fetchJsonWithRetry({
      fetchImpl,
      init: { headers: { authorization: `Bearer ${apiKey}` } },
      maxResponseBytes: 8 * 1024 * 1024,
      onAttempt: () => { summary.apiAttempts += 1; },
      provider: "eBay UK sold listings",
      retryAttempts,
      retryWaitMs,
      timeoutMs,
      url,
      validate: validSoldSearchResponse,
    });
    summary.apiRequests += 1;
    const remaining = optionalNonNegativeInteger(response.response.headers?.get?.("x-usage-remaining"));
    if (remaining !== undefined) summary.quotaRemaining = remaining;
    return response.body;
  };
}

function ebayUkSoldSnapshot(target, estimate, { query }) {
  return {
    cardPrintingId: target.card.id,
    confidenceScore: estimate.confidenceScore,
    condition: ItemCondition.NEAR_MINT,
    currency: "GBP",
    itemType: ItemType.CARD,
    language: target.card.language,
    metadata: {
      compIds: estimate.acceptedSales.slice(0, 20).map((sale) => sale.itemId).filter(Boolean),
      compUrls: estimate.acceptedSales.slice(0, 10).map((sale) => sale.url).filter(Boolean),
      latestSaleAt: estimate.latestSaleAt,
      marketplace: "ebay.co.uk",
      methodology: "median of exact raw near-mint UK completed-sale comparables after robust outlier rejection",
      query,
      spreadRatio: estimate.spreadRatio,
    },
    observedAt: new Date(estimate.latestSaleAt),
    priceMinor: estimate.priceMinor,
    sampleSize: estimate.sampleSize,
    source: sourceName,
    sourceRef: createHash("sha256").update(query).digest("hex").slice(0, 24),
    variantLabel: target.variantLabel,
  };
}

async function upsertDailyEbayUkSnapshot(prisma, data) {
  const dayStart = new Date(data.observedAt);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const existing = await prisma.priceSnapshot.findFirst({
    select: { id: true },
    where: {
      cardPrintingId: data.cardPrintingId,
      gradedCompany: null,
      observedAt: { gte: dayStart, lt: dayEnd },
      source: data.source,
      sourceRef: data.sourceRef,
      variantLabel: data.variantLabel,
    },
  });

  if (existing) {
    await prisma.priceSnapshot.update({ where: { id: existing.id }, data });
    return "updated";
  }

  await prisma.priceSnapshot.create({ data });
  return "created";
}

function addTarget(targets, candidate) {
  const key = `${candidate.card.id}\u0000${normalizeVariant(candidate.variantLabel)}`;
  const existing = targets.get(key);
  if (!existing || candidate.priorityScore > existing.priorityScore) targets.set(key, candidate);
}

function collectorNumberQuery(card) {
  const number = String(card.number ?? "").trim();
  const total = Number(card.cardSet.printedTotal ?? card.cardSet.total);
  if (!number || !Number.isFinite(total) || total <= 0) return number;
  const subset = number.match(/^([A-Za-z]{1,3})\d+$/);
  return subset && /^(?:GG|TG)$/i.test(subset[1])
    ? `${number}/${subset[1].toUpperCase()}${total}`
    : /^\d+$/.test(number)
      ? `${number}/${total}`
      : number;
}

function titleMatchesCardName(title, cardName) {
  const name = normalizeIdentityText(cardName);
  const normalizedTitle = normalizeIdentityText(title);
  return name.length > 1 && normalizedTitle.includes(name);
}

function titleMatchesCollectorNumber(title, card) {
  const normalizedNumber = normalizeText(card.number);
  const number = normalizedNumber.replace(/\s/g, "");
  if (!number) return false;
  const total = Number(card.cardSet.printedTotal ?? card.cardSet.total);
  const compactTitle = title.replace(/\s/g, "");
  const rawNumber = String(card.number ?? "").trim();
  const prefix = rawNumber.match(/^([A-Za-z]{1,3})\d+$/)?.[1]?.toLowerCase();
  if (Number.isFinite(total) && total > 0 && (/^\d+$/.test(rawNumber) || /^(?:gg|tg)$/.test(prefix ?? ""))) {
    const denominator = prefix ? `${prefix}${total}` : String(total);
    return compactTitle.includes(`${number}/${denominator}`) || compactTitle.includes(`${number}-${denominator}`);
  }
  return new RegExp(`(?:^|[^a-z0-9])#?${escapeRegExp(normalizedNumber)}(?:$|[^a-z0-9])`, "i").test(title);
}

function titleMatchesSet(title, card) {
  const normalizedSet = normalizeText(card.cardSet.name);
  if (!normalizedSet) return false;
  if (title.includes(normalizedSet)) return true;
  const distinctive = normalizedSet.split(" ").filter((token) => token.length >= 4 && !setStopWords.has(token));
  if (distinctive.length > 0 && distinctive.every((token) => title.includes(token))) return true;

  // Provider-style prefixed collector numbers (MEP 070, SWSH123, GG12/GG70)
  // identify their catalogue family without forcing sellers to spell out the
  // platform's full set label in an eBay title.
  return /^[A-Za-z]{2,5}[\s-]*\d+$/i.test(String(card.number ?? "").trim()) &&
    titleMatchesCollectorNumber(title, card);
}

function titleMatchesLanguage(title, language) {
  const normalizedLanguage = String(language ?? "en").trim().toLowerCase();
  const foreign = /\b(?:japanese|japan|jpn|jp|korean|german|french|italian|spanish|chinese)\b/.test(title);
  if (normalizedLanguage === "ja") return /\b(?:japanese|japan|jpn|jp)\b/.test(title);
  return normalizedLanguage === "en" ? !foreign : title.includes(normalizedLanguage);
}

function titleMatchesVariant(title, variantLabel) {
  const variant = normalizeVariant(variantLabel);
  const firstEdition = /\b(?:1st|first)\s*edition\b/.test(title);
  const shadowless = /\bshadowless\b/.test(title);
  const reverse = /\breverse\s*(?:holo|holofoil|foil)\b/.test(title);
  const holo = /\b(?:holo|holofoil)\b/.test(title);
  const stamped = /\b(?:stamp|stamped)\b/.test(title);

  if (variant.includes("1stedition") && !firstEdition) return { ok: false, reason: "first_edition_mismatch" };
  if (!variant.includes("1stedition") && firstEdition) return { ok: false, reason: "first_edition_mismatch" };
  if (variant.includes("shadowless") !== shadowless) return { ok: false, reason: "shadowless_mismatch" };
  if (variant.includes("reverseholo") !== reverse) return { ok: false, reason: "reverse_holo_mismatch" };

  const expectsNamedStamp = variant.includes("stamp");
  if (expectsNamedStamp) {
    const stampTokens = variantStampTokens(variantLabel);
    const pokemonCenterIdentity = variant.includes("pokemoncenterstamp");
    if (!stampTokens.every((token) => title.includes(token))) {
      return { ok: false, reason: "stamp_identity_mismatch" };
    }
    if (!stamped && !pokemonCenterIdentity) {
      return { ok: false, reason: "stamp_mismatch" };
    }
  } else if (stamped) {
    return { ok: false, reason: "stamp_mismatch" };
  }

  if (variant.includes("holo") && !variant.includes("reverseholo") && !holo) {
    return { ok: false, reason: "holo_mismatch" };
  }
  if (!["standard", "normal", "unlimited"].includes(variant) && !variant.includes("holo")) {
    return { ok: true };
  }
  if (["standard", "normal", "unlimited"].includes(variant) && (holo || reverse)) {
    return { ok: false, reason: "holo_mismatch" };
  }
  return { ok: true };
}

function rawCardTitle(title) {
  return !/\b(?:psa|bgs|cgc|ace|sgc|beckett|graded|grading|slab|proxy|replica|custom|reprint|lot|bundle|collection|playset|set\s+of|pair|x\s*[2-9]|[2-9]\s*x|digital)\b/.test(title);
}

function titleMatchesNearMint(title, condition) {
  if (/\b(?:near\s*mint|nm\+?|mint)\b/.test(title)) return true;
  const normalized = normalizeText(condition);
  return normalized.includes("near mint") || normalized === "mint" || normalized === "new";
}

function variantQueryTerms(variantLabel) {
  const variant = normalizeVariant(variantLabel);
  if (variant.includes("pokemoncenterstamp")) return "Pokemon Center stamp";
  if (variant.includes("whiteflarestamp")) return "White Flare stamp";
  if (variant.includes("stellarcrownstamp")) return "Stellar Crown stamp";
  if (variant.includes("1stedition")) return variant.includes("holo") ? "1st Edition holo" : "1st Edition";
  if (variant.includes("shadowless")) return variant.includes("holo") ? "shadowless holo" : "shadowless";
  if (variant.includes("reverseholo")) return "reverse holo";
  if (variant.includes("holo")) return "holo";
  return "";
}

function languageQueryTerm(language) {
  const normalized = String(language ?? "en").trim().toLowerCase();
  if (normalized === "ja") return "Japanese";
  return normalized === "en" ? "English" : normalized;
}

function rawConditionQueryTerm(condition) {
  void condition;
  return "near mint";
}

function variantStampTokens(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !new Set(["holo", "holofoil", "stamp", "stamped"]).has(token));
}

function primaryVariantFromMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "Standard";
  const reviewed = Array.isArray(metadata.reviewedVariants) ? metadata.reviewedVariants : [];
  const first = reviewed
    .map((entry) => typeof entry === "string" ? entry : entry?.label)
    .find((entry) => stringSetting(entry));
  if (first) return first;
  if (typeof metadata.finish === "string" && metadata.finish.trim()) return metadata.finish.trim();
  return "Standard";
}

function validSoldSearchResponse(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.results);
}

function wishlistPriorityScore(priority) {
  return { GRAIL: 9_000, HIGH: 8_000, MEDIUM: 7_000, LOW: 6_000 }[String(priority ?? "").toUpperCase()] ?? 6_000;
}

function rejected(reason) {
  return { accepted: false, reason };
}

function decimalToMinor(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : null;
}

function median(values) {
  if (!values.length) return Number.NaN;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function percentile(values, fraction) {
  if (!values.length) return Number.NaN;
  const index = (values.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (index - lower);
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9/#-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeIdentityText(value) {
  return normalizeText(value)
    .replace(/\band\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeVariant(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/first/g, "1st")
    .replace(/foil/g, "foil")
    .replace(/[^a-z0-9]+/g, "");
}

function safeEbayUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return /(^|\.)ebay\.co\.uk$/i.test(url.hostname) || /(^|\.)ebay\.com$/i.test(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function optionalNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined;
}

function nonNegativeInteger(value, fallback) {
  return optionalNonNegativeInteger(value) ?? fallback;
}

function uuidList(value) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");
  return uniqueStrings(values.map((entry) => String(entry).trim()).filter((entry) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry),
  ));
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function stringSetting(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const setStopWords = new Set(["base", "card", "cards", "pokemon", "promo", "promos", "series", "set", "the"]);

