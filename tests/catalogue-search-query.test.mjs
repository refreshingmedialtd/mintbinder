import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOGUE_SEARCH_MAX_QUERY_LENGTH,
  CATALOGUE_SEARCH_MAX_TOKENS,
  catalogueFieldsMatchSearchQuery,
  catalogueSearchTermGroups,
  catalogueSearchTokens,
  normalizeCatalogueSearchQuery,
} from "../src/lib/catalogue/search-query.ts";
import { CATALOGUE_SEARCH_MAX_ALIAS_TERMS } from "../src/lib/catalogue/name-aliases.ts";

test("matches non-contiguous catalogue terms across the product and set fields", () => {
  assert.equal(
    catalogueFieldsMatchSearchQuery(
      ["Chaos Rising Pokemon Center Elite Trainer Box", "Chaos Rising", "Elite trainer box"],
      "chaos rising elite",
    ),
    true,
  );
  assert.equal(
    catalogueFieldsMatchSearchQuery(
      ["Chaos Rising Pokemon Center Elite Trainer Box", "Chaos Rising"],
      "chaos rising booster",
    ),
    false,
  );
});

test("catalogue terms are case-insensitive, punctuation tolerant, unique, and bounded", () => {
  assert.deepEqual(
    catalogueSearchTokens("  Latias & LATIAS / Latios-GX  "),
    ["latias", "latios", "gx"],
  );

  const longQuery = Array.from(
    { length: CATALOGUE_SEARCH_MAX_TOKENS + 8 },
    (_, index) => `term${index}`,
  ).join(" ");
  assert.equal(catalogueSearchTokens(longQuery).length, CATALOGUE_SEARCH_MAX_TOKENS);
  assert.equal(
    normalizeCatalogueSearchQuery("x".repeat(CATALOGUE_SEARCH_MAX_QUERY_LENGTH + 50)).length,
    CATALOGUE_SEARCH_MAX_QUERY_LENGTH,
  );
});

test("tokenless punctuation and SQL wildcard characters normalize to an unfiltered query", () => {
  assert.equal(normalizeCatalogueSearchQuery(" % _ !!! "), "");
  assert.equal(catalogueFieldsMatchSearchQuery(["Pikachu"], ""), true);
  assert.equal(catalogueFieldsMatchSearchQuery(["Pikachu"], "%"), true);
});

test("alias alternatives stay inside their token group instead of widening a multi-term query", () => {
  const groups = catalogueSearchTermGroups("charizard 199");
  const matches = (fields) => {
    const searchable = fields.join(" ").normalize("NFKC").toLocaleLowerCase("en-GB");

    return groups.every((alternatives) =>
      alternatives.some((term) => searchable.includes(term.normalize("NFKC").toLocaleLowerCase("en-GB"))),
    );
  };

  assert.equal(groups.length, 2);
  assert.ok(groups[0].includes("リザードン"));
  assert.deepEqual(groups[1], ["199"]);
  assert.equal(matches(["Charizard ex", "151", "Special illustration rare"]), false);
  assert.equal(matches(["リザードン ex", "199", "Special illustration rare"]), true);
});

test("alias alternatives share one global predicate budget across all tokens", () => {
  const groups = catalogueSearchTermGroups(
    "charizard pikachu eevee umbreon espeon sylveon leafeon glaceon vaporeon jolteon flareon mew",
  );

  assert.equal(groups.length, CATALOGUE_SEARCH_MAX_TOKENS);
  assert.ok(groups.every((group) => group.length >= 1));
  assert.ok(groups.flat().length <= CATALOGUE_SEARCH_MAX_ALIAS_TERMS);
});
