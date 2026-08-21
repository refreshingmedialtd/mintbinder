import assert from "node:assert/strict";
import test from "node:test";
import { preserveCardSetMetadataOnUpdate } from "../src/lib/pricing/card-set-metadata.ts";

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
