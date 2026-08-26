import {
  GradingCompany,
  ItemType,
  PrismaClient,
} from "@prisma/client";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import { fetchJsonWithRetry } from "./provider-fetch.mjs";
import {
  assertPriceChartingWriteAllowed,
  priceChartingLicenceConfirmed,
} from "../src/lib/pricing/provider-permissions.mjs";

const productEndpoint = "https://www.pricecharting.com/api/product";
const productsEndpoint = "https://www.pricecharting.com/api/products";
const sourceName = "pricecharting-graded-card";

// These are the only standard grade fields whose grading company is explicit in
// the official PriceCharting API contract. Generic graded fields are intentionally
// excluded: https://www.pricecharting.com/api-documentation
export const explicitCompanyGradeFields = Object.freeze({
  [GradingCompany.PSA]: { field: "manual-only-price", label: "PSA 10", score: 10 },
  [GradingCompany.BGS]: { field: "bgs-10-price", label: "BGS 10", score: 10 },
  [GradingCompany.CGC]: { field: "condition-17-price", label: "CGC 10", score: 10 },
});

export const ambiguousCompanyGradeFields = Object.freeze([
  "graded-price",
  "box-only-price",
  "cib-price",
  "new-price",
  "condition-9-price",
  "condition-10-price",
  "condition-13-price",
  "condition-14-price",
  "condition-15-price",
  "condition-16-price",
]);

export const qualifiedGradeFields = Object.freeze({
  "condition-19-price": "CGC 10 Pristine",
  "condition-20-price": "BGS 10 Black Label",
});

export function priceChartingGradedOptionsFromEnv(env = process.env) {
  return {
    aliases: parsePriceChartingAliases(env.PRICECHARTING_GRADED_ALIASES_JSON),
    enabled: booleanSetting(env.PRICECHARTING_GRADED_ENABLED, false),
    licenceConfirmed: priceChartingLicenceConfirmed(env),
    limit: positiveInteger(env.PRICECHARTING_GRADED_LIMIT, 5),
    priceOnlyUnpriced: booleanSetting(env.PRICECHARTING_GRADED_PRICE_ONLY_UNPRICED, true),
    retryAttempts: positiveInteger(env.PRICECHARTING_API_RETRY_ATTEMPTS, 3),
    retryWaitMs: nonNegativeInteger(env.PRICECHARTING_API_RETRY_WAIT_MS, 1_500),
    timeoutMs: positiveInteger(env.PRICECHARTING_API_TIMEOUT_MS, 10_000),
    token: stringSetting(env.PRICECHARTING_API_TOKEN),
    usdToGbpRate: conversionRate(env.PRICECHARTING_USD_TO_GBP_RATE) ??
      conversionRate(env.TCGCSV_USD_TO_GBP_RATE) ??
      conversionRate(env.POKEMON_TCG_USD_TO_GBP_RATE),
    waitMs: nonNegativeInteger(env.PRICECHARTING_GRADED_WAIT_MS, 1_100),
    writePrices: booleanSetting(env.PRICECHARTING_GRADED_WRITE_PRICES, false),
  };
}

export async function syncPriceChartingGradedCardPrices(options = {}) {
  const prisma = options.prisma ?? new PrismaClient();
  const shouldDisconnect = !options.prisma;
  const token = stringSetting(options.token);
  const usdToGbpRate = conversionRate(options.usdToGbpRate);
  const writePrices = options.writePrices ?? false;
  const licenceConfirmed = options.licenceConfirmed === true;
  const enabled = options.enabled ?? false;
  const priceOnlyUnpriced = options.priceOnlyUnpriced ?? true;
  const limit = positiveInteger(options.limit, 5);
  const observedAt = validDate(options.observedAt) ?? new Date();
  const summary = {
    ambiguousFieldNames: [],
    ambiguousFieldsObserved: 0,
    apiAttempts: 0,
    apiRequests: 0,
    candidatesAvailable: 0,
    candidatesChecked: 0,
    candidatesMatched: 0,
    candidatesUnmatched: 0,
    explicitPricesFound: 0,
    enabled,
    mappingReview: [],
    licenceConfirmed,
    priceOnlyUnpriced,
    pricingSnapshotsCreated: 0,
    pricingSnapshotsUpdated: 0,
    provider: sourceName,
    qualifiedFieldNames: [],
    qualifiedFieldsObserved: 0,
    requestedGradeIdentities: 0,
    status: "succeeded",
    supportedGradeIdentities: 0,
    unsupportedGradeIdentities: 0,
    unsupportedGradeSample: [],
    variantsAvailable: 0,
    writePrices,
  };

  if (!enabled) {
    summary.status = "not_configured";
    if (shouldDisconnect) await prisma.$disconnect();
    return summary;
  }

  assertPriceChartingWriteAllowed({ licenceConfirmed, writePrices });

  if (!token) {
    throw new Error("PRICECHARTING_API_TOKEN must be set for PriceCharting graded-card pricing.");
  }

  if (writePrices && !usdToGbpRate) {
    throw new Error("PRICECHARTING_USD_TO_GBP_RATE, TCGCSV_USD_TO_GBP_RATE, or POKEMON_TCG_USD_TO_GBP_RATE must be set.");
  }

  try {
    const cards = await prisma.cardPrinting.findMany({
      orderBy: { updatedAt: "asc" },
      select: {
        cardSet: { select: { name: true, series: true } },
        collectionItems: {
          select: { gradedCompany: true, gradedScore: true, variantLabel: true },
          where: {
            archivedAt: null,
            gradedCompany: { not: null },
            itemType: ItemType.CARD,
          },
        },
        id: true,
        language: true,
        name: true,
        number: true,
        priceSnapshots: {
          orderBy: { observedAt: "desc" },
          select: {
            gradedCompany: true,
            gradedScore: true,
            observedAt: true,
            sourceRef: true,
            variantLabel: true,
          },
          where: { source: sourceName },
        },
        providerIds: true,
      },
      where: {
        collectionItems: {
          some: { archivedAt: null, gradedCompany: { not: null }, itemType: ItemType.CARD },
        },
        language: "en",
      },
    });

    const targets = [];

    for (const card of cards) {
      const identities = ownedGradeIdentities(card.collectionItems);
      const supported = identities.filter(isSupportedGradeIdentity);
      const unsupported = identities.filter((identity) => !isSupportedGradeIdentity(identity));

      summary.requestedGradeIdentities += identities.length;
      summary.supportedGradeIdentities += supported.length;
      summary.unsupportedGradeIdentities += unsupported.length;
      summary.unsupportedGradeSample.push(...unsupported.map((identity) => ({
        cardId: card.id,
        company: identity.company,
        name: card.name,
        number: card.number,
        score: identity.score,
        variantLabel: identity.variantLabel,
      })));
      summary.unsupportedGradeSample = summary.unsupportedGradeSample.slice(0, 15);

      const pending = priceOnlyUnpriced
        ? supported.filter((identity) => !hasExactGradeSnapshot(card.priceSnapshots, identity))
        : supported;

      if (!pending.length) continue;

      targets.push({
        card,
        identities: pending,
        latestObservedAt: latestExactSnapshotTime(card.priceSnapshots, supported),
      });
    }

    targets.sort((left, right) => left.latestObservedAt - right.latestObservedAt || left.card.id.localeCompare(right.card.id));
    summary.candidatesAvailable = targets.length;
    summary.variantsAvailable = targets.reduce(
      (total, target) => total + new Set(target.identities.map((identity) => normalizeVariant(identity.variantLabel))).size,
      0,
    );

    const request = createPriceChartingRequester({
      fetchImpl: options.fetchImpl ?? fetch,
      retryAttempts: positiveInteger(options.retryAttempts, 3),
      retryWaitMs: nonNegativeInteger(options.retryWaitMs, 1_500),
      summary,
      timeoutMs: positiveInteger(options.timeoutMs, 10_000),
      token,
      waitMs: nonNegativeInteger(options.waitMs, 1_100),
    });
    const aliases = normalizeAliases(options.aliases);

    for (const target of targets.slice(0, limit)) {
      summary.candidatesChecked += 1;
      const variants = uniqueStrings(target.identities.map((identity) => identity.variantLabel));
      const matches = await findPriceChartingGradedMatches({
        aliases,
        card: target.card,
        request,
        variants,
      });
      let matchedCard = false;

      for (const variantLabel of variants) {
        const match = matches.get(normalizeVariant(variantLabel));

        if (!match?.response) {
          summary.candidatesUnmatched += 1;
          pushReview(summary, {
            cardId: target.card.id,
            name: target.card.name,
            number: target.card.number,
            reason: match?.reason ?? "No unique exact PriceCharting product match.",
            set: target.card.cardSet.name,
            variantLabel,
          });
          continue;
        }

        matchedCard = true;
        const inspection = inspectPriceChartingGradeFields(match.response);

        summary.ambiguousFieldsObserved += inspection.ambiguousFields.length;
        summary.ambiguousFieldNames.push(...inspection.ambiguousFields);
        summary.qualifiedFieldsObserved += inspection.qualifiedFields.length;
        summary.qualifiedFieldNames.push(...inspection.qualifiedFields);

        for (const identity of target.identities.filter(
          (candidate) => normalizeVariant(candidate.variantLabel) === normalizeVariant(variantLabel),
        )) {
          const field = explicitCompanyGradeFields[identity.company];
          const priceMinor = inspection.explicitPrices.get(identity.company);

          if (!field || !priceMinor) continue;

          summary.explicitPricesFound += 1;

          if (!writePrices || !usdToGbpRate) continue;

          const snapshot = {
            cardPrintingId: target.card.id,
            confidenceScore: match.matchType === "manual_alias" ? 64 : 58,
            currency: "GBP",
            gradedCompany: identity.company,
            gradedScore: identity.score,
            itemType: ItemType.CARD,
            language: target.card.language,
            metadata: {
              ambiguousCompanyFieldsIgnored: inspection.ambiguousFields,
              consoleName: match.response["console-name"] ?? null,
              conversionRate: usdToGbpRate,
              explicitGradeLabel: field.label,
              genre: match.response.genre ?? null,
              matchType: match.matchType,
              originalCurrency: "USD",
              originalPriceMinor: priceMinor,
              priceChartingProductName: match.response["product-name"],
              priceField: field.field,
              priceSource: "PriceCharting Prices API",
              qualifiedFieldsIgnored: inspection.qualifiedFields,
            },
            observedAt,
            priceMinor: Math.round(priceMinor * usdToGbpRate),
            source: sourceName,
            sourceRef: `${match.response.id}:${field.field}`,
            variantLabel: identity.variantLabel,
          };
          const outcome = await upsertDailyGradeSnapshot(prisma, snapshot);

          summary[outcome === "created" ? "pricingSnapshotsCreated" : "pricingSnapshotsUpdated"] += 1;
        }
      }

      if (matchedCard) summary.candidatesMatched += 1;
    }

    summary.ambiguousFieldNames = uniqueStrings(summary.ambiguousFieldNames);
    summary.qualifiedFieldNames = uniqueStrings(summary.qualifiedFieldNames);
    const output = summary.pricingSnapshotsCreated + summary.pricingSnapshotsUpdated;

    if (summary.candidatesChecked > 0 && summary.explicitPricesFound === 0) {
      summary.status = "degraded";
    } else if (summary.mappingReview.length > 0 && summary.explicitPricesFound > 0) {
      summary.status = "partial";
    } else if (writePrices && summary.explicitPricesFound > 0 && output === 0) {
      summary.status = "degraded";
    }

    return summary;
  } finally {
    if (shouldDisconnect) await prisma.$disconnect();
  }
}

export async function findPriceChartingGradedMatches({ aliases = {}, card, request, variants }) {
  const matches = new Map();
  const unresolved = [];

  for (const variantLabel of variants) {
    const aliasId = priceChartingAliasId(aliases, card, variantLabel);

    if (!aliasId) {
      unresolved.push(variantLabel);
      continue;
    }

    const response = await request("product", { id: aliasId });
    const validation = validatePriceChartingCardIdentity(card, response, {
      allowVariantOverride: true,
      variantLabel,
    });

    matches.set(normalizeVariant(variantLabel), validation.ok
      ? { matchType: "manual_alias", response }
      : { reason: `Reviewed alias ${aliasId} failed identity validation: ${validation.reason}` });
  }

  if (!unresolved.length) return matches;

  const search = await request("products", { q: priceChartingCardQuery(card) });
  const products = Array.isArray(search?.products) ? search.products : [];
  const identityMatches = products.filter((product) =>
    validatePriceChartingCardIdentity(card, product, { allowVariantOverride: true }).ok,
  );

  for (const variantLabel of unresolved) {
    const candidates = identityMatches.filter((product) => variantMatchesProduct(variantLabel, product));

    if (candidates.length !== 1) {
      matches.set(normalizeVariant(variantLabel), {
        reason: candidates.length > 1
          ? `${candidates.length} exact products matched; a variant-specific manual alias is required.`
          : "No exact set/name/number/variant product matched.",
      });
      continue;
    }

    const response = await request("product", { id: candidates[0].id });
    const validation = validatePriceChartingCardIdentity(card, response, { variantLabel });

    matches.set(normalizeVariant(variantLabel), validation.ok
      ? { matchType: "exact_search", response }
      : { reason: `Selected product failed detail validation: ${validation.reason}` });
  }

  return matches;
}

export function inspectPriceChartingGradeFields(response) {
  const explicitPrices = new Map();

  for (const [company, config] of Object.entries(explicitCompanyGradeFields)) {
    const value = providerPriceMinor(response?.[config.field]);

    if (value) explicitPrices.set(company, value);
  }

  return {
    ambiguousFields: ambiguousCompanyGradeFields.filter((field) => providerPriceMinor(response?.[field])),
    explicitPrices,
    qualifiedFields: Object.keys(qualifiedGradeFields).filter((field) => providerPriceMinor(response?.[field])),
  };
}

export function validatePriceChartingCardIdentity(
  card,
  response,
  { allowVariantOverride = false, variantLabel } = {},
) {
  if (!isPriceChartingProduct(response)) return { ok: false, reason: "response is not a Pokémon card product" };

  const parsed = parsePriceChartingProductName(response["product-name"]);

  if (normalizeCardName(parsed.name) !== normalizeCardName(card.name)) {
    return { ok: false, reason: "card name differs" };
  }

  if (normalizeCollectorNumber(parsed.number) !== normalizeCollectorNumber(card.number)) {
    return { ok: false, reason: "collector number differs" };
  }

  if (normalizeSetName(response["console-name"]) !== normalizeSetName(card.cardSet?.name)) {
    return { ok: false, reason: "set name differs" };
  }

  if (!allowVariantOverride && variantLabel && !variantMatchesProduct(variantLabel, response)) {
    return { ok: false, reason: "variant qualifier differs" };
  }

  return { ok: true };
}

export function parsePriceChartingAliases(value) {
  if (!value) return {};
  if (isObject(value)) return normalizeAliases(value);

  try {
    const parsed = JSON.parse(String(value));

    if (!isObject(parsed)) throw new Error("aliases must be a JSON object");

    return normalizeAliases(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`PRICECHARTING_GRADED_ALIASES_JSON is invalid: ${message}`);
  }
}

function ownedGradeIdentities(items) {
  const identities = new Map();

  for (const item of items ?? []) {
    const company = stringSetting(item.gradedCompany)?.toUpperCase();
    const score = gradeScore(item.gradedScore);

    if (!company || score === undefined) continue;

    const identity = {
      company,
      score,
      variantLabel: stringSetting(item.variantLabel) ?? "Standard",
    };
    identities.set(`${company}\u0000${score}\u0000${normalizeVariant(identity.variantLabel)}`, identity);
  }

  return [...identities.values()];
}

function isSupportedGradeIdentity(identity) {
  const field = explicitCompanyGradeFields[identity.company];

  return Boolean(field) && identity.score === field.score;
}

function hasExactGradeSnapshot(snapshots, identity) {
  return (snapshots ?? []).some((snapshot) =>
    stringSetting(snapshot.gradedCompany)?.toUpperCase() === identity.company &&
    gradeScore(snapshot.gradedScore) === identity.score &&
    normalizeVariant(snapshot.variantLabel) === normalizeVariant(identity.variantLabel),
  );
}

function latestExactSnapshotTime(snapshots, identities) {
  const times = (snapshots ?? [])
    .filter((snapshot) => identities.some((identity) =>
      stringSetting(snapshot.gradedCompany)?.toUpperCase() === identity.company &&
      gradeScore(snapshot.gradedScore) === identity.score &&
      normalizeVariant(snapshot.variantLabel) === normalizeVariant(identity.variantLabel),
    ))
    .map((snapshot) => validDate(snapshot.observedAt)?.getTime() ?? 0);

  return times.length ? Math.max(...times) : 0;
}

function createPriceChartingRequester({ fetchImpl, retryAttempts, retryWaitMs, summary, timeoutMs, token, waitMs }) {
  let lastRequestAt = 0;

  return async (endpoint, params) => {
    const elapsed = Date.now() - lastRequestAt;

    if (lastRequestAt && elapsed < waitMs) await wait(waitMs - elapsed);

    const url = new URL(endpoint === "products" ? productsEndpoint : productEndpoint);
    url.searchParams.set("t", token);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }

    summary.apiRequests += 1;
    lastRequestAt = Date.now();
    const result = await fetchJsonWithRetry({
      fetchImpl,
      maxResponseBytes: 2 * 1024 * 1024,
      onAttempt: () => { summary.apiAttempts += 1; },
      provider: "PriceCharting",
      retryAttempts,
      retryWaitMs: Math.max(retryWaitMs, Math.ceil(waitMs / 0.75)),
      timeoutMs,
      url,
      validate: (body) => isObject(body),
    });

    return result.body;
  };
}

function priceChartingAliasId(aliases, card, variantLabel) {
  const variant = normalizeVariant(variantLabel);
  const providerIds = isObject(card.providerIds) ? card.providerIds : {};
  const providerId = stringSetting(providerIds.pokemon_tcg_api);
  const keys = [
    `card:${card.id}|${variant}`,
    providerId ? `pokemon_tcg_api:${providerId}|${variant}` : null,
    isGenericVariant(variantLabel) ? `card:${card.id}` : null,
    providerId && isGenericVariant(variantLabel) ? `pokemon_tcg_api:${providerId}` : null,
  ].filter(Boolean);

  for (const key of keys) {
    const id = stringSetting(aliases[key.toLowerCase()]);
    if (id) return id;
  }

  const priceCharting = providerIds.pricecharting_graded;

  if (isObject(priceCharting)) return stringSetting(priceCharting[variant]);
  if (isGenericVariant(variantLabel)) return stringSetting(providerIds.pricecharting);

  return undefined;
}

function priceChartingCardQuery(card) {
  return [card.name, `#${normalizeCollectorNumber(card.number)}`, card.cardSet?.name, "Pokemon"]
    .filter(Boolean)
    .join(" ");
}

function variantMatchesProduct(variantLabel, product) {
  const qualifiers = parsePriceChartingProductName(product?.["product-name"]).qualifiers;

  if (!qualifiers.length) return isGenericVariant(variantLabel);

  const localTokens = new Set(normalizeVariant(variantLabel).split(" ").filter(Boolean));
  const qualifierTokens = normalizeVariant(qualifiers.join(" ")).split(" ").filter(Boolean);

  return qualifierTokens.length > 0 && qualifierTokens.every((token) => localTokens.has(token));
}

function isGenericVariant(value) {
  return ["standard", "normal", "regular", "default", "holo", "holofoil"].includes(normalizeVariant(value));
}

function parsePriceChartingProductName(value) {
  const text = String(value ?? "").trim();
  const qualifiers = [...text.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1].trim()).filter(Boolean);
  const withoutQualifiers = text.replace(/\[[^\]]+\]/g, " ").trim();
  const numberMatch = withoutQualifiers.match(/#\s*([a-z0-9-]+)/i);
  const name = (numberMatch ? withoutQualifiers.slice(0, numberMatch.index) : withoutQualifiers).trim();

  return { name, number: numberMatch?.[1] ?? "", qualifiers };
}

function isPriceChartingProduct(response) {
  if (!isObject(response) || !response.id || !response["product-name"] || !response["console-name"]) return false;
  if (response.status && response.status !== "success") return false;

  const genre = normalizeText(response.genre);
  const set = normalizeText(response["console-name"]);

  return genre.includes("pokemon card") || set.startsWith("pokemon ") || set === "pokemon";
}

async function upsertDailyGradeSnapshot(prisma, data) {
  const dayStart = new Date(data.observedAt);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1_000);
  const existing = await prisma.priceSnapshot.findFirst({
    select: { id: true },
    where: {
      cardPrintingId: data.cardPrintingId,
      gradedCompany: data.gradedCompany,
      gradedScore: data.gradedScore,
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

function normalizeSetName(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => !["pokemon", "card", "cards", "tcg", "trading"].includes(token))
    .join(" ");
}

function normalizeCardName(value) {
  return normalizeText(value);
}

function normalizeCollectorNumber(value) {
  const normalized = String(value ?? "").split("/")[0].replace(/[^a-z0-9-]+/gi, "").toLowerCase();

  return /^\d+$/.test(normalized) ? String(Number(normalized)) : normalized;
}

function normalizeVariant(value) {
  return normalizeText(value)
    .replace(/\bfirst\b/g, "1st")
    .replace(/\bholo foil\b/g, "holofoil")
    .replace(/\bholo\b/g, "holofoil");
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeAliases(value) {
  if (!isObject(value)) return {};

  return Object.fromEntries(Object.entries(value)
    .map(([key, id]) => [String(key).trim().toLowerCase(), stringSetting(id)])
    .filter(([, id]) => Boolean(id)));
}

function pushReview(summary, entry) {
  summary.mappingReview.push(entry);
  summary.mappingReview = summary.mappingReview.slice(0, 25);
}

function providerPriceMinor(value) {
  const price = Number(value);

  return Number.isInteger(price) && price > 0 ? price : undefined;
}

function gradeScore(value) {
  const score = Number(value);

  return Number.isFinite(score) ? score : undefined;
}

function conversionRate(value) {
  const rate = Number(value);

  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

function nonNegativeInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);

  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function stringSetting(value) {
  const string = String(value ?? "").trim();

  return string || undefined;
}

function validDate(value) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function wait(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
