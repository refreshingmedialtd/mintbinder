import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("one owned copy can occupy at most one pocket across every binder", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(
      new URL("../prisma/migrations/20260824133000_add_binders_billing_events/migration.sql", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(schema, /@@unique\(\[collectionItemId, copyIndex\]\)/);
  assert.match(
    migration,
    /PARTITION BY collection_item_id, copy_index[\s\S]*?copy_rank > 1[\s\S]*?CREATE UNIQUE INDEX "binder_slots_collection_item_id_copy_index_key"/,
  );
});
