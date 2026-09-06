import assert from "node:assert/strict";
import test from "node:test";
import { pokemonCardRecordMatches } from "../src/lib/pricing/pokemon-tcg-card-record.ts";

const incoming = {
  artist: "Artist",
  cardSetId: "set-1",
  imageLargeUrl: "https://example.test/large.jpg",
  imageSmallUrl: "https://example.test/small.jpg",
  language: "en",
  legalities: { expanded: "Legal", standard: "Legal" },
  name: "Test Card",
  number: "1",
  providerIds: { pokemon_tcg_api: "set1-1" },
  rarity: "Rare",
  region: "international",
  searchText: "test card 1",
  subtypes: ["Basic"],
  supertype: "Pokemon",
  variantMetadata: { variants: { holofoil: true, normal: false } },
};

test("unchanged Pokemon catalogue cards skip redundant database writes", () => {
  assert.equal(pokemonCardRecordMatches({
    ...incoming,
    legalities: { standard: "Legal", expanded: "Legal" },
    providerIds: { pokemon_tcg_api: "set1-1", tcgdex: "set1-1" },
    variantMetadata: { variants: { normal: false, holofoil: true } },
  }, incoming, "set1-1"), true);
});

test("material Pokemon catalogue changes still require an upsert", () => {
  assert.equal(pokemonCardRecordMatches({
    ...incoming,
    imageLargeUrl: "https://example.test/old.jpg",
  }, incoming, "set1-1"), false);
  assert.equal(pokemonCardRecordMatches({
    ...incoming,
    providerIds: { pokemon_tcg_api: "wrong-id" },
  }, incoming, "set1-1"), false);
  assert.equal(pokemonCardRecordMatches(undefined, incoming, "set1-1"), false);
});
