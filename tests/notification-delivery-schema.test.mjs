import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("notification claims are unique, user-owned, and erased with the account", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(
      new URL("../prisma/migrations/20260824133000_add_binders_billing_events/migration.sql", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(schema, /model NotificationDelivery[\s\S]*?@@unique\(\[kind, periodKey, recipientKey\]\)/);
  assert.match(schema, /user\s+User[\s\S]*?onDelete:\s*Cascade/);
  assert.match(migration, /CREATE TABLE "notification_deliveries"/);
  assert.match(migration, /notification_deliveries_user_id_fkey[\s\S]*?ON DELETE CASCADE/);
});

test("migration scrubs identifying legacy price-alert job payloads", async () => {
  const migration = await readFile(
    new URL("../prisma/migrations/20260824133000_add_binders_billing_events/migration.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /UPDATE "job_runs"[\s\S]*?WHERE "job_type" = 'price_alerts'/);
  assert.doesNotMatch(migration.slice(migration.indexOf('UPDATE "job_runs"')), /testRecipient|deliveryEmail|userId/);
});

test("persisted digest results expose no raw recipient identifiers", async () => {
  const source = await readFile(
    new URL("../src/lib/notifications/price-alerts.ts", import.meta.url),
    "utf8",
  );
  const resultType = source.slice(
    source.indexOf("type PriceAlertDigestResult"),
    source.indexOf("type PriceAlertDigestRunResult"),
  );

  assert.doesNotMatch(resultType, /email|userId|deliveryEmail|providerMessageId/i);
  assert.match(resultType, /recipientToken/);
});
