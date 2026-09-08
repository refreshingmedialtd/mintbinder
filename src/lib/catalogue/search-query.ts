import {
  CATALOGUE_SEARCH_MAX_ALIAS_TERMS,
  catalogueSearchTermsForQuery,
} from "./name-aliases.ts";

export const CATALOGUE_SEARCH_MAX_QUERY_LENGTH = 160;
export const CATALOGUE_SEARCH_MAX_TOKENS = 12;

/**
 * Search text is intentionally bounded before it reaches Prisma. Catalogue
 * search is interactive and must not turn an arbitrarily long URL parameter
 * into an equally large collection of database predicates.
 */
export function normalizeCatalogueSearchQuery(value?: string | null) {
  const bounded = (value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, CATALOGUE_SEARCH_MAX_QUERY_LENGTH)
    .trim();
  const tokens = bounded.toLocaleLowerCase("en-GB").match(/[\p{L}\p{N}]+/gu) ?? [];

  return [...new Set(tokens)].slice(0, CATALOGUE_SEARCH_MAX_TOKENS).join(" ");
}

/**
 * Multi-word catalogue searches match every meaningful term, even when the
 * terms are split between a set name and an item name. For example,
 * "chaos rising elite" matches an Elite Trainer Box in the Chaos Rising set.
 */
export function catalogueSearchTokens(value?: string | null) {
  const normalized = normalizeCatalogueSearchQuery(value);

  return normalized ? normalized.split(" ") : [];
}

/**
 * Each query token must match, while aliases for that token are alternatives.
 * The global term budget keeps the resulting Prisma/SQL predicate count
 * bounded even when a query contains several Pokemon names.
 */
export function catalogueSearchTermGroups(value?: string | null) {
  const tokens = catalogueSearchTokens(value);
  const groups = tokens.map((token) => [token]);
  const aliasCandidates = tokens.map((token) => catalogueSearchTermsForQuery(token).slice(1));
  let remaining = Math.max(0, CATALOGUE_SEARCH_MAX_ALIAS_TERMS - tokens.length);

  for (let aliasIndex = 0; remaining > 0; aliasIndex += 1) {
    let added = false;

    for (let tokenIndex = 0; tokenIndex < aliasCandidates.length && remaining > 0; tokenIndex += 1) {
      const alias = aliasCandidates[tokenIndex][aliasIndex];

      if (!alias) {
        continue;
      }

      groups[tokenIndex].push(alias);
      remaining -= 1;
      added = true;
    }

    if (!added) {
      break;
    }
  }

  return groups;
}

export function catalogueFieldsMatchSearchQuery(
  fields: Array<string | null | undefined>,
  value?: string | null,
) {
  const tokens = catalogueSearchTokens(value);

  if (!tokens.length) {
    return true;
  }

  const searchable = fields
    .filter((field): field is string => typeof field === "string")
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("en-GB");

  return tokens.every((token) => searchable.includes(token));
}
