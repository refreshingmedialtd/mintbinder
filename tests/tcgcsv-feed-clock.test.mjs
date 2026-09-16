import assert from "node:assert/strict";
import test from "node:test";
import { fetchTcgcsvFeedDate, tcgcsvFetch, validatedTcgcsvFeedDate } from "../scripts/tcgcsv-feed-clock.mjs";
import { syncTcgcsvCardPrices } from "../scripts/tcgcsv-card-pricing.mjs";
import { syncTcgcsvSealedProducts } from "../scripts/tcgcsv-sealed-importer.mjs";

test("the published feed clock retains its real age, including a six-day-old file", () => {
  const now = new Date("2026-09-16T12:00:00Z");
  assert.equal(validatedTcgcsvFeedDate("2026-09-10T20:06:20+0000\n", now).toISOString(), "2026-09-10T20:06:20.000Z");
  for (const bad of ["", "yesterday", "2026-09-10", "2026-09-17T20:00:00Z"]) {
    assert.throws(() => validatedTcgcsvFeedDate(bad, now), /clock/);
  }
});

test("parallel TCGCSV calls pause at least 100ms between request starts", async () => {
  const starts = [];
  const fetchImpl = async () => { starts.push(Date.now()); return new Response("ok"); };
  await Promise.all([tcgcsvFetch("products", {}, fetchImpl), tcgcsvFetch("prices", {}, fetchImpl)]);
  assert.ok(starts[1] - starts[0] >= 100);
});

test("feed clock requests are bounded, identifiable and fail closed", async () => {
  const clock = await fetchTcgcsvFeedDate({ fetchImpl: async (url, init) => {
    assert.equal(url, "https://tcgcsv.com/last-updated.txt");
    assert.equal(init.headers["user-agent"], "MintBinderLocalImporter/0.1");
    return new Response("2026-09-15T20:06:20+0000");
  } });
  assert.equal(clock.toISOString(), "2026-09-15T20:06:20.000Z");
  for (const response of [new Response("", { status: 503 }), new Response("x".repeat(300)), new Response("bad")]) {
    await assert.rejects(fetchTcgcsvFeedDate({ fetchImpl: async () => response, retryAttempts: 1 }), /clock/);
  }
  await assert.rejects(fetchTcgcsvFeedDate({ fetchImpl: async () => new Promise(() => {}), timeoutMs: 5, retryAttempts: 1 }), /timed out/);
});

test("no pricing writes happen when the provider clock cannot be verified", async () => {
  let databaseCalls = 0;
  const prisma = { cardSet: { findMany: async () => { databaseCalls += 1; return []; } } };
  for (const sync of [syncTcgcsvCardPrices, syncTcgcsvSealedProducts]) {
    await assert.rejects(sync({ prisma, usdToGbpRate: 0.75, apiRetryAttempts: 1,
      fetchImpl: async () => new Response("bad") }), /clock/);
  }
  assert.equal(databaseCalls, 0);
});

test("automatic rotations skip a fully imported feed version but targeted recovery remains possible", async () => {
  const providerUpdatedAt = "2026-09-15T20:06:20.000Z";
  const set = { id: "set-1", name: "Base Set", providerIds: { pokemon_tcg_api: "base1" },
    language: "en", metadata: {
      tcgcsvCardPricingAttempts: { "tcgcsv-card:604": { providerUpdatedAt } },
      scheduledSealedPricingProviderUpdatedAt: providerUpdatedAt,
    }, cardPrintings: [], sealedProducts: [] };
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    return new Response(JSON.stringify({ success: true, results: [{ groupId: 604, name: "Base Set" }] }));
  };
  const prisma = { cardSet: { findMany: async () => [set] } };
  for (const sync of [syncTcgcsvCardPrices, syncTcgcsvSealedProducts]) {
    const summary = await sync({ prisma, fetchImpl, providerUpdatedAt, usdToGbpRate: 0.75, priceOnlyUnpriced: false });
    assert.equal(summary.rotationGroupsAvailable, 1);
    assert.equal(summary.groupsProcessed, 0);
    assert.equal(summary.groupsAvailable, 0);
  }
  assert.ok(requests.every((url) => url.endsWith("/groups")));
  // An explicit group is not skipped: it reaches the deliberately missing
  // printing query, proving that a reviewed repair can re-import this version.
  await assert.rejects(syncTcgcsvCardPrices({ prisma, fetchImpl, providerUpdatedAt,
    usdToGbpRate: 0.75, priceOnlyUnpriced: false, groupIds: ["604"] }), /findMany/);
});
