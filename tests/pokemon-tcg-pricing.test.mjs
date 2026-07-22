import assert from "node:assert/strict";
import test from "node:test";
import { bestPokemonTcgCardPrice } from "../src/lib/pricing/pokemon-tcg-card-prices.ts";

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
