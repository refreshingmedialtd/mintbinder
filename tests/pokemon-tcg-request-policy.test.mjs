import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ProviderRequestError } from "../src/lib/http/fetch-with-policy.ts";
import {
  exhaustedPokemonTcgRequestError,
  isRetryablePokemonTcgStatus,
  isSkippablePokemonTcgSetPricingError,
  PokemonTcgApiRequestError,
  pokemonTcgApiTimeoutMs,
  pokemonTcgMaxRetryWaitMs,
} from "../src/lib/pricing/pokemon-tcg-request-policy.ts";

test("Pokemon TCG requests allow observed production response latency", () => {
  assert.equal(pokemonTcgApiTimeoutMs({}), 15_000);
  assert.equal(pokemonTcgApiTimeoutMs({ POKEMON_TCG_API_TIMEOUT_MS: "22000" }), 22_000);
  assert.equal(pokemonTcgApiTimeoutMs({ POKEMON_TCG_API_TIMEOUT_MS: "invalid" }), 15_000);
  assert.equal(3 * pokemonTcgApiTimeoutMs({}) + 2 * pokemonTcgMaxRetryWaitMs, 55_000);
});

test("exhausted transport retries report the total attempts and deepest cause", () => {
  const timeout = new Error("Pokemon TCG cards request timed out.");
  const inner = new ProviderRequestError(
    "Pokemon TCG cards",
    "Pokemon TCG cards request failed after 1 attempt.",
    { cause: timeout },
  );

  const error = exhaustedPokemonTcgRequestError(inner, 3, "cards");

  assert.equal(error.name, "PokemonTcgApiRequestError");
  assert.equal(error.status, 0);
  assert.match(error.message, /failed after 3 attempts/);
  assert.match(error.message, /request timed out/);
  assert.equal(error.cause, inner);
  assert.equal(isSkippablePokemonTcgSetPricingError(error), true);
});

test("exhausted HTTP retries retain status and Retry-After for set rotation", () => {
  const inner = new PokemonTcgApiRequestError(
    "Pokemon TCG API request failed with 502.",
    502,
    60_000,
  );
  const error = exhaustedPokemonTcgRequestError(inner, 3, "cards");

  assert.notEqual(error, inner);
  assert.equal(error.status, 502);
  assert.equal(error.retryAfterMs, 60_000);
  assert.equal(error.message, "Pokemon TCG API request failed with 502 after 3 attempts.");
  assert.equal(error.cause, inner);
  assert.equal(isSkippablePokemonTcgSetPricingError(error), true);
});

test("set rotation only continues past known transient provider failures", () => {
  for (const status of [0, 404, 408, 425, 429, 500, 503]) {
    assert.equal(
      isSkippablePokemonTcgSetPricingError(
        new PokemonTcgApiRequestError(`Provider returned ${status}.`, status),
      ),
      true,
      `expected HTTP status ${status} to be skippable`,
    );
  }

  for (const status of [400, 401, 403, 409, 422, 499]) {
    assert.equal(
      isSkippablePokemonTcgSetPricingError(
        new PokemonTcgApiRequestError(`Provider returned ${status}.`, status),
      ),
      false,
      `expected HTTP status ${status} to stop the rotation`,
    );
  }

  for (const status of [408, 425, 429, 500, 503]) {
    assert.equal(isRetryablePokemonTcgStatus(status), true);
  }
  for (const status of [0, 400, 401, 403, 404, 409, 422, 499]) {
    assert.equal(isRetryablePokemonTcgStatus(status), false);
  }

  assert.equal(
    isSkippablePokemonTcgSetPricingError(new TypeError("fetch socket disconnected")),
    true,
  );
  assert.equal(isSkippablePokemonTcgSetPricingError(new TypeError("network timeout")), true);
  assert.equal(isSkippablePokemonTcgSetPricingError(new Error("Database write failed")), false);
});

test("Pokemon ingestion and set rotation apply the shared retry policy", async () => {
  const [providerSource, rotationSource] = await Promise.all([
    readFile(new URL("../src/lib/pricing/pokemon-tcg-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/jobs/scheduled-set-pricing.ts", import.meta.url), "utf8"),
  ]);

  assert.equal(
    (providerSource.match(/throw exhaustedPokemonTcgRequestError\(error, attempt, "(?:cards|sets)"\)/g) ?? []).length,
    2,
  );
  assert.equal(
    (providerSource.match(/maxRetryWaitMs:\s*pokemonTcgMaxRetryWaitMs/g) ?? []).length,
    2,
  );
  assert.equal(
    providerSource.includes(
      "return error instanceof TypeError && /fetch|network|socket|timeout/i.test(error.message);",
    ),
    true,
  );
  assert.match(rotationSource, /if \(!isSkippablePokemonTcgSetPricingError\(error\)\)/);
  assert.match(rotationSource, /recordSetPricingAttempt\(target, error, message\)/);
});
