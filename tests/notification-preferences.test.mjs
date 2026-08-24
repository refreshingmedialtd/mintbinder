import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  filterPriceAlertsForPreferences,
  shouldSendDigestForFrequency,
} from "../src/lib/notifications/preference-filter.ts";
import {
  getNotificationPreferences,
  NotificationPreferenceValidationError,
  updateNotificationPreferences,
} from "../src/lib/notifications/preferences.ts";

const alerts = [
  { category: "Wishlist", id: "wishlist-hit" },
  { category: "Price confidence", id: "weak-price" },
];

test("filters wishlist and weak confidence alerts independently", () => {
  const filtered = filterPriceAlertsForPreferences(alerts, {
    digestFrequency: "Daily",
    priceAlertsEnabled: true,
    weakPriceAlertsEnabled: false,
    wishlistTargetAlertsEnabled: true,
  });

  assert.deepEqual(filtered.map((alert) => alert.id), ["wishlist-hit"]);
});

test("disables all alert emails when the master price alert preference is off", () => {
  const filtered = filterPriceAlertsForPreferences(alerts, {
    digestFrequency: "Daily",
    priceAlertsEnabled: false,
    weakPriceAlertsEnabled: true,
    wishlistTargetAlertsEnabled: true,
  });

  assert.equal(filtered.length, 0);
});

test("sends weekly digests only on Mondays in UTC", () => {
  assert.equal(shouldSendDigestForFrequency("Weekly", new Date("2026-06-01T09:00:00.000Z")), true);
  assert.equal(shouldSendDigestForFrequency("Weekly", new Date("2026-06-02T09:00:00.000Z")), false);
  assert.equal(shouldSendDigestForFrequency("Off", new Date("2026-06-01T09:00:00.000Z")), false);
});

test("strict preference reads propagate database failures instead of enabling defaults", async () => {
  const client = {
    $queryRaw() {
      return Promise.reject(new Error("database unavailable"));
    },
  };

  await assert.rejects(
    () => getNotificationPreferences("user-1", { client, fallback: "throw" }),
    /database unavailable/,
  );
});

test("partial preference updates use one field-aware upsert and preserve disabled values", async () => {
  const calls = [];
  const client = {
    $queryRaw(strings, ...values) {
      calls.push({ sql: strings.join("?"), values });
      return Promise.resolve([{
        digest_frequency: "off",
        price_alerts_enabled: false,
        weak_price_alerts_enabled: false,
        wishlist_target_alerts_enabled: false,
      }]);
    },
  };

  const result = await updateNotificationPreferences(
    "user-1",
    { digestFrequency: "Off" },
    { client },
  );

  assert.equal(calls.length, 1, "partial updates must not perform a default-merging read");
  assert.match(calls[0].sql, /CASE\s+WHEN[\s\S]+ELSE notification_preferences\.price_alerts_enabled/);
  assert.match(calls[0].sql, /ELSE notification_preferences\.wishlist_target_alerts_enabled/);
  assert.match(calls[0].sql, /ELSE notification_preferences\.weak_price_alerts_enabled/);
  assert.deepEqual(result, {
    digestFrequency: "Off",
    priceAlertsEnabled: false,
    weakPriceAlertsEnabled: false,
    wishlistTargetAlertsEnabled: false,
  });
});

test("failed preference updates reject and invalid fields are distinguished from availability failures", async () => {
  const client = {
    $queryRaw() {
      return Promise.reject(new Error("write unavailable"));
    },
  };

  await assert.rejects(
    () => updateNotificationPreferences("user-1", { priceAlertsEnabled: false }, { client }),
    /write unavailable/,
  );
  await assert.rejects(
    () => updateNotificationPreferences("user-1", { priceAlertsEnabled: "false" }, { client }),
    (error) => error instanceof NotificationPreferenceValidationError,
  );
});

test("notification preference route maps database failures to 503 and validation to 400", async () => {
  const route = await readFile(
    new URL("../src/app/api/notification-preferences/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /NotificationPreferenceValidationError[\s\S]+privateReadJson\(\{ error: error\.message \}, 400\)/);
  assert.match(route, /databaseReadUnavailableResponse\("Notification preferences are temporarily unavailable\."\)/);
  assert.doesNotMatch(route, /status:\s*400/);
});
