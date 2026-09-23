import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeCardSetMetadata,
  preserveCardSetMetadataOnUpdate,
} from "../src/lib/pricing/card-set-metadata.ts";

test("provider card-set updates preserve scheduler-owned metadata", () => {
  const providerData = {
    metadata: {
      provider: "pokemon-tcg-api",
      providerUpdatedAt: "2026-08-21T08:00:00.000Z",
    },
    name: "Destined Rivals",
    total: 244,
  };

  assert.deepEqual(preserveCardSetMetadataOnUpdate(providerData), {
    name: "Destined Rivals",
    total: 244,
  });
  assert.deepEqual(providerData.metadata, {
    provider: "pokemon-tcg-api",
    providerUpdatedAt: "2026-08-21T08:00:00.000Z",
  });
});

test("exact-set metadata refreshes preserve operational state and replace provider facts", () => {
  assert.deepEqual(mergeCardSetMetadata(
    {
      catalogueCursor: 300,
      provider: "tcgdex",
      providerUpdatedAt: "2026-08-21T08:00:00.000Z",
      sourceCardCount: 70,
    },
    {
      provider: "tcgdex",
      providerAvailableCardCount: 46,
      providerUpdatedAt: "2026-09-23T08:00:00.000Z",
      sourceCardCount: 71,
    },
  ), {
    catalogueCursor: 300,
    provider: "tcgdex",
    providerAvailableCardCount: 46,
    providerUpdatedAt: "2026-09-23T08:00:00.000Z",
    sourceCardCount: 71,
  });
});
