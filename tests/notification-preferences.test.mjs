import assert from "node:assert/strict";
import test from "node:test";
import {
  filterPriceAlertsForPreferences,
  shouldSendDigestForFrequency,
} from "../src/lib/notifications/preference-filter.ts";

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
