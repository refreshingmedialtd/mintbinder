import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  bestPokemonTcgCardPrice,
  correctedPokemonProviderObservedAt,
  pokemonProviderObservedAt,
} from "../src/lib/pricing/pokemon-tcg-card-prices.ts";
import { preferredLatestPricePoint } from "../src/lib/pricing/market-context.ts";

test("uses TCGPlayer card prices when no European price is available", () => {
  const price = bestPokemonTcgCardPrice(
    {
      id: "base1-4",
      name: "Charizard",
      tcgplayer: {
        prices: {
          holofoil: {
            market: 199.99,
            mid: 210,
          },
        },
        updatedAt: "2026/05/31",
      },
    },
    { eurToGbp: 0.85, usdToGbp: 0.74 },
  );

  assert.equal(price?.source, "pokemon-tcg-api");
  assert.equal(price?.originalCurrency, "USD");
  assert.equal(price?.originalPrice, 199.99);
  assert.equal(price?.conversionRate, 0.74);
});

test("prefers Cardmarket prices for UK-facing valuations when both sources are available", () => {
  const price = bestPokemonTcgCardPrice(
    {
      cardmarket: {
        prices: {
          averageSellPrice: 12.34,
          trendPrice: 13.37,
        },
        updatedAt: "2026/05/31",
      },
      id: "neo1-1",
      name: "Vintage card",
      tcgplayer: {
        prices: {
          holofoil: {
            market: 20,
          },
        },
      },
    },
    { eurToGbp: 0.85, usdToGbp: 0.74 },
  );

  assert.equal(price?.source, "pokemon-tcg-api-cardmarket");
  assert.equal(price?.originalCurrency, "EUR");
  assert.equal(price?.originalPrice, 13.37);
  assert.equal(price?.conversionRate, 0.85);
  assert.equal(price?.variantLabel, "Holofoil");
});

test("skips Cardmarket fallback without a EUR conversion rate", () => {
  const price = bestPokemonTcgCardPrice(
    {
      cardmarket: {
        prices: {
          trendPrice: 13.37,
        },
      },
      id: "neo1-1",
      name: "Vintage card",
    },
    { usdToGbp: 0.74 },
  );

  assert.equal(price, null);
});

test("uses the selected provider's own update date as the evidence time", () => {
  const importedAt = new Date("2026-09-04T12:00:00.000Z");
  const cardmarketPrice = bestPokemonTcgCardPrice(
    {
      cardmarket: {
        prices: { trendPrice: 844.59 },
        updatedAt: "2025/11/03",
      },
      tcgplayer: {
        prices: { holofoil: { market: 3_900 } },
        updatedAt: "2026/09/03",
      },
    },
    { eurToGbp: 1, usdToGbp: 0.8 },
  );
  const tcgplayerPrice = bestPokemonTcgCardPrice(
    {
      tcgplayer: {
        prices: { holofoil: { market: 3_900 } },
        updatedAt: "2026-09-03T18:30:00Z",
      },
    },
    { eurToGbp: 1, usdToGbp: 0.8 },
  );

  assert.equal(cardmarketPrice?.source, "pokemon-tcg-api-cardmarket");
  assert.equal(
    pokemonProviderObservedAt(cardmarketPrice?.providerUpdatedAt, importedAt).toISOString(),
    "2025-11-03T00:00:00.000Z",
  );
  assert.equal(tcgplayerPrice?.source, "pokemon-tcg-api");
  assert.equal(
    pokemonProviderObservedAt(tcgplayerPrice?.providerUpdatedAt, importedAt).toISOString(),
    "2026-09-03T18:30:00.000Z",
  );
});

test("rejects malformed, impossible, implausibly old, and future provider dates", () => {
  const importedAt = new Date("2026-09-04T12:00:00.000Z");

  for (const providerUpdatedAt of [
    undefined,
    "not-a-date",
    "2026/02/31",
    "1999/12/31",
    "2026-09-04T13:00:00Z",
    "2026-09-03T12:00:00",
  ]) {
    assert.equal(
      pokemonProviderObservedAt(providerUpdatedAt, importedAt).toISOString(),
      importedAt.toISOString(),
    );
  }
});

test("newer TCGCSV evidence outranks stale Cardmarket evidence from a later import", () => {
  const importTime = new Date("2026-09-04T12:00:00.000Z");
  const cardmarketPrice = bestPokemonTcgCardPrice(
    {
      cardmarket: {
        prices: { trendPrice: 844.59 },
        updatedAt: "2025/11/03",
      },
    },
    { eurToGbp: 1, usdToGbp: 0.8 },
  );
  assert.ok(cardmarketPrice);

  const staleCardmarket = {
    confidence: "Fair",
    observedAt: pokemonProviderObservedAt(cardmarketPrice.providerUpdatedAt, importTime).toISOString(),
    source: cardmarketPrice.source,
    valueMinor: Math.round(cardmarketPrice.originalPrice * 100),
    variantLabel: "Holofoil",
  };
  const currentTcgcsv = {
    confidence: "Weak",
    observedAt: "2026-09-03T00:00:00.000Z",
    source: "tcgcsv-card",
    valueMinor: 316_815,
    variantLabel: "Holofoil",
  };

  assert.equal(preferredLatestPricePoint([staleCardmarket, currentTcgcsv], importTime), currentTcgcsv);
});

test("repairs legacy import-time observations only from valid older provider metadata", () => {
  const legacySnapshot = {
    createdAt: new Date("2026-09-04T12:00:01.000Z"),
    metadata: { providerUpdatedAt: "2025/11/03" },
    observedAt: new Date("2026-09-04T12:00:00.000Z"),
  };

  assert.equal(
    correctedPokemonProviderObservedAt(legacySnapshot)?.toISOString(),
    "2025-11-03T00:00:00.000Z",
  );
  assert.equal(correctedPokemonProviderObservedAt({
    ...legacySnapshot,
    createdAt: new Date("2026-09-04T11:59:59.000Z"),
    metadata: { providerUpdatedAt: "2099/01/01" },
  }), null);
  assert.equal(correctedPokemonProviderObservedAt({
    ...legacySnapshot,
    metadata: {},
  }), null);
  assert.equal(correctedPokemonProviderObservedAt({
    ...legacySnapshot,
    observedAt: new Date("2025-11-03T00:00:00.000Z"),
  }), null);
});

test("Pokemon TCG ingestion persists the selected provider timestamp", async () => {
  const importer = await readFile(
    new URL("../src/lib/pricing/pokemon-tcg-api.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    importer,
    /observedAt:\s*pokemonProviderObservedAt\(price\.providerUpdatedAt, importedAt\)/,
  );
  assert.match(importer, /let cardsUpserted = 0/);
  assert.match(importer, /cardsUpserted \+= 1/);
  assert.match(importer, /cardsUpserted,\s*page:/);
});
