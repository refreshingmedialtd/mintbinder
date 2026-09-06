import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveGbpRates,
  resolvePokemonPricingRates,
} from "../src/lib/pricing/exchange-rates.ts";

test("resolves Pokemon pricing rates from live GBP-based exchange payloads", async () => {
  const rates = await resolvePokemonPricingRates({
    env: {},
    fetchImpl: async (url) => {
      assert.equal(String(url), "https://api.frankfurter.app/latest?from=GBP&to=USD%2CEUR");

      return jsonResponse({
        date: "2026-06-22",
        rates: {
          EUR: 1.15,
          USD: 1.25,
        },
      });
    },
  });

  assert.equal(rates.usdToGbp, 0.8);
  assert.equal(rates.eurToGbp, 0.869565);
  assert.equal(rates.metadata.USD?.provider, "frankfurter");
  assert.equal(rates.metadata.USD?.sourceDate, "2026-06-22");
});

test("uses env rates only when automatic exchange rates are disabled", async () => {
  const rates = await resolvePokemonPricingRates({
    env: {
      EXCHANGE_RATES_AUTO: "false",
      POKEMON_TCG_EUR_TO_GBP_RATE: "0.87",
      POKEMON_TCG_USD_TO_GBP_RATE: "0.76",
    },
    fetchImpl: async () => {
      throw new Error("Should not call exchange provider in manual mode.");
    },
  });

  assert.equal(rates.usdToGbp, 0.76);
  assert.equal(rates.eurToGbp, 0.87);
  assert.equal(rates.metadata.USD?.provider, "env");
});

test("falls back to env rates when the live provider is unavailable", async () => {
  const rates = await resolveGbpRates({
    env: {
      POKEMON_TCG_USD_TO_GBP_RATE: "0.75",
    },
    fallbackEnvKeys: {
      EUR: "POKEMON_TCG_EUR_TO_GBP_RATE",
      USD: "POKEMON_TCG_USD_TO_GBP_RATE",
    },
    fetchImpl: async () => jsonResponse({ error: "offline" }, 503),
    requiredCurrencies: ["USD"],
  });

  assert.equal(rates.USD?.rate, 0.75);
  assert.equal(rates.USD?.metadata.provider, "env");
});

test("a caller can reserve its route deadline by disabling live-rate retries", async () => {
  let attempts = 0;
  const rates = await resolvePokemonPricingRates({
    env: {
      POKEMON_TCG_USD_TO_GBP_RATE: "0.75",
    },
    fetchImpl: async () => {
      attempts += 1;
      return jsonResponse({ error: "offline" }, 503);
    },
    retryAttempts: 0,
    timeoutMs: 100,
  });

  assert.equal(attempts, 1);
  assert.equal(rates.usdToGbp, 0.75);
  assert.equal(rates.metadata.USD?.provider, "env");
});

test("falls back when exchange-rate response headers arrive but the body stalls", async () => {
  const started = Date.now();
  const rates = await resolvePokemonPricingRates({
    env: {
      EXCHANGE_RATES_TIMEOUT_MS: "100",
      POKEMON_TCG_USD_TO_GBP_RATE: "0.74",
    },
    fetchImpl: async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"rates":'));
        init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
      },
    }), { status: 200 }),
  });

  assert.equal(rates.usdToGbp, 0.74);
  assert.equal(rates.metadata.USD?.provider, "env");
  assert.ok(Date.now() - started < 2_000);
});

test("fails clearly when neither live nor fallback rates are available", async () => {
  await assert.rejects(
    () =>
      resolveGbpRates({
        env: {},
        fallbackEnvKeys: {
          EUR: "POKEMON_TCG_EUR_TO_GBP_RATE",
          USD: "POKEMON_TCG_USD_TO_GBP_RATE",
        },
        fetchImpl: async () => jsonResponse({ rates: {} }),
        requiredCurrencies: ["USD"],
      }),
    /Unable to resolve USD to GBP exchange rate/,
  );
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
    status,
  });
}
