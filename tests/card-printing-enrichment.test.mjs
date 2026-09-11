import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mergeCardPrintingProviderUpdate } from "../src/lib/pricing/card-printing-enrichment.ts";

test("ordinary provider refreshes preserve reviewed catalogue enrichments", () => {
  const existing = {
    providerIds: {
      pokemon_tcg_api: "sv7-30",
      tcgcsv_reviewed_products: ["648587"],
    },
    searchText: "blastoise ex stellar crown 30 old provider text",
    variantMetadata: {
      availablePrices: ["holofoil", "Stellar Crown Stamp Holofoil"],
      provider: "pokemon-tcg-api",
      reviewedBaseSearchText: "blastoise ex stellar crown 30 old provider text",
      reviewedSearchText: "blastoise ex stellar crown 30 old provider text stellar crown stamp",
      reviewedSearchTerms: [
        "Blastoise ex 030/142",
        "Stellar Crown Stamp",
      ],
      reviewedVariants: [{
        label: "Stellar Crown Stamp Holofoil",
        source: "tcgcsv",
        sourceRef: "648587",
      }],
      variantsDetailed: [
        {
          thirdParty: { tcgplayer: 648587 },
          type: "holo",
          variantId: "tcgplayer-648587",
        },
        {
          type: "normal",
          variantId: "obsolete-provider-variant",
        },
      ],
    },
  };
  const incoming = {
    name: "Blastoise ex",
    providerIds: { pokemon_tcg_api: "sv7-30" },
    searchText: "blastoise ex stellar crown 30 030/142 english",
    variantMetadata: {
      availablePrices: ["normal"],
      provider: "pokemon-tcg-api",
      tcgplayerUpdatedAt: "2026/09/11",
      variantsDetailed: [{ type: "normal", variantId: "provider-current" }],
    },
  };
  const existingBefore = structuredClone(existing);
  const incomingBefore = structuredClone(incoming);

  const merged = mergeCardPrintingProviderUpdate(incoming, existing);

  assert.deepEqual(merged.providerIds, {
    pokemon_tcg_api: "sv7-30",
    tcgcsv_reviewed_products: ["648587"],
  });
  assert.match(merged.searchText, /blastoise ex 030\/142/);
  assert.match(merged.searchText, /stellar crown stamp/);
  assert.doesNotMatch(merged.searchText, /old provider text/);
  assert.deepEqual(merged.variantMetadata.availablePrices, [
    "normal",
    "Stellar Crown Stamp Holofoil",
  ]);
  assert.deepEqual(merged.variantMetadata.reviewedVariants, existing.variantMetadata.reviewedVariants);
  assert.equal(
    merged.variantMetadata.reviewedBaseSearchText,
    incoming.searchText,
  );
  assert.equal(merged.variantMetadata.reviewedSearchText, merged.searchText);
  assert.deepEqual(
    merged.variantMetadata.variantsDetailed.map((variant) => variant.variantId),
    ["tcgplayer-648587", "provider-current"],
  );
  assert.equal(merged.variantMetadata.provider, "pokemon-tcg-api");
  assert.equal(merged.variantMetadata.tcgplayerUpdatedAt, "2026/09/11");
  assert.deepEqual(existing, existingBefore, "existing data must not be mutated");
  assert.deepEqual(incoming, incomingBefore, "incoming data must not be mutated");
});

test("legacy reviewed records keep their existing search text until explicit terms are backfilled", () => {
  const merged = mergeCardPrintingProviderUpdate({
    providerIds: { pokemon_tcg_api: "rsv10pt5-62" },
    searchText: "zoroark white flare 62",
    variantMetadata: { availablePrices: ["holofoil"] },
  }, {
    providerIds: {
      pokemon_tcg_api: "rsv10pt5-62",
      tcgcsv_reviewed_products: ["668959"],
    },
    searchText: "zoroark white flare 62 062/086 white flare stamp",
    variantMetadata: {
      reviewedVariants: [{
        label: "White Flare Stamp Holofoil",
        source: "tcgcsv",
        sourceRef: "668959",
      }],
    },
  });

  assert.match(merged.searchText, /062\/086 white flare stamp/);
  assert.deepEqual(merged.providerIds.tcgcsv_reviewed_products, ["668959"]);
});

test("ordinary metadata stays provider-owned when no reviewed enrichment exists", () => {
  const merged = mergeCardPrintingProviderUpdate({
    providerIds: { pokemon_tcg_api: "new-id" },
    searchText: "current search",
    variantMetadata: { availablePrices: ["normal"], provider: "pokemon-tcg-api" },
  }, {
    providerIds: { legacy_provider: "old-id", pokemon_tcg_api: "old-id" },
    searchText: "obsolete search",
    variantMetadata: { availablePrices: ["holofoil"], provider: "old-provider" },
  });

  assert.deepEqual(merged.providerIds, {
    legacy_provider: "old-id",
    pokemon_tcg_api: "new-id",
  });
  assert.equal(merged.searchText, "current search");
  assert.deepEqual(merged.variantMetadata, {
    availablePrices: ["normal"],
    provider: "pokemon-tcg-api",
  });
});

test("both ordinary catalogue providers apply the shared durability merge", async () => {
  const [pokemonTcgApi, tcgdex] = await Promise.all([
    readFile(new URL("../src/lib/pricing/pokemon-tcg-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/pricing/tcgdex.ts", import.meta.url), "utf8"),
  ]);

  for (const source of [pokemonTcgApi, tcgdex]) {
    assert.match(source, /mergeCardPrintingProviderUpdate\(/);
  }
});
