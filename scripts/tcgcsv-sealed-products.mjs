import { createHash } from "node:crypto";

export const tcgcsvPokemonCategoryId = 3;

const sealedKeywords = [
  "booster",
  "box",
  "bundle",
  "blister",
  "case",
  "chest",
  "collection",
  "deck",
  "display",
  "elite trainer",
  "etb",
  "pack",
  "stadium",
  "tin",
  "toolkit",
];

const nonPhysicalKeywords = [
  "code card",
  "digital",
];

export function deterministicUuid(value) {
  const bytes = createHash("sha1").update(value).digest().subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

export function isSealedProduct(product) {
  const name = product?.name?.toLowerCase() ?? "";
  const extendedData = Array.isArray(product?.extendedData) ? product.extendedData : [];

  if (!name || nonPhysicalKeywords.some((keyword) => name.includes(keyword))) {
    return false;
  }

  if (extendedData.some((entry) => ["number", "rarity"].includes(String(entry?.name ?? "").toLowerCase()))) {
    return false;
  }

  return sealedKeywords.some((keyword) => name.includes(keyword));
}

export function sealedProductType(productName) {
  const name = productName.toLowerCase();

  if (name.includes("case")) {
    return "CASE";
  }

  if (name.includes("booster box")) {
    return "BOOSTER_BOX";
  }

  if (name.includes("elite trainer") || name.includes(" etb")) {
    return "ELITE_TRAINER_BOX";
  }

  if (name.includes("tin")) {
    return "TIN";
  }

  if (name.includes("blister")) {
    return "BLISTER";
  }

  if (name.includes("deck")) {
    return "DECK";
  }

  if (name.includes("collection") || name.includes(" box")) {
    return "COLLECTION_BOX";
  }

  if (name.includes("pack")) {
    return "BOOSTER_PACK";
  }

  return "OTHER";
}

export function normalizedSetName(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/pokemon/g, "")
    .replace(/\bpromos?\b/g, "collection")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  return normalized === "base set" ? "base" : normalized;
}

export function groupDisplayName(groupName) {
  return String(groupName ?? "")
    .replace(/^.*?:\s*/, "")
    .replace(/^[A-Z0-9]+(?:\s+[A-Z0-9]+)?\s+-\s+/, "")
    .trim();
}

export function matchTcgcsvGroupsToSets(groups, sets) {
  const setByName = new Map();
  const setByProviderCode = new Map();

  for (const set of sets) {
    setByName.set(normalizedSetName(set.name), set);

    const providerCode = normalizedProviderCode(setProviderId(set));

    if (isSafeProviderCodeMatch(providerCode)) {
      setByProviderCode.set(providerCode, set);
    }
  }

  return groups
    .map((group) => {
      const groupName = normalizedSetName(groupDisplayName(group.name));
      const fullGroupName = normalizedSetName(group.name);
      const groupProviderCode = normalizedProviderCode(group.abbreviation);
      const set = setByName.get(groupName) ??
        setByName.get(fullGroupName) ??
        (isSafeProviderCodeMatch(groupProviderCode) ? setByProviderCode.get(groupProviderCode) : undefined);

      return set ? { group, set } : null;
    })
    .filter(Boolean);
}

export function bestTcgcsvPrice(prices) {
  const ordered = [...prices].sort((first, second) => priceScore(second) - priceScore(first));

  for (const price of ordered) {
    const usd = price.marketPrice ?? price.midPrice ?? price.lowPrice ?? price.directLowPrice ?? null;

    if (usd && usd > 0) {
      return {
        confidenceScore: price.marketPrice ? 76 : price.midPrice ? 66 : 56,
        subTypeName: price.subTypeName,
        usd,
      };
    }
  }

  return null;
}

export function extendedDataValue(product, name) {
  return product.extendedData?.find((entry) => entry.name === name)?.value;
}

export function upgradedImageUrl(value) {
  return typeof value === "string" ? value.replace("_200w.", "_in_1000x1000.") : undefined;
}

function priceScore(price) {
  if (price.subTypeName === "Normal") {
    return 4;
  }

  if (price.marketPrice) {
    return 3;
  }

  if (price.midPrice) {
    return 2;
  }

  return price.lowPrice ? 1 : 0;
}

function normalizedProviderCode(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/^([a-z]+)0+(?=\d)/, "$1");
}

function isSafeProviderCodeMatch(value) {
  return String(value ?? "").length >= 3;
}

function setProviderId(set) {
  if (typeof set.providerId === "string") {
    return set.providerId;
  }

  if (set.providerIds && typeof set.providerIds === "object" && !Array.isArray(set.providerIds)) {
    return set.providerIds.pokemon_tcg_api;
  }

  return undefined;
}
