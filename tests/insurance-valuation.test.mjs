import assert from "node:assert/strict";
import test from "node:test";
import { buildInsuranceReportHtml } from "../src/lib/reports/insurance.ts";

function appData(collection, catalogue) {
  return {
    catalogue,
    collection,
    events: [],
    notificationPreferences: {
      digestFrequency: "Off",
      priceAlertsEnabled: false,
      weakPriceAlertsEnabled: false,
      wishlistTargetAlertsEnabled: false,
    },
    sets: [],
    source: "database",
    storageLocations: [],
    subscription: {
      entitlements: { "exports.insurance_report": true },
      plan: "plus",
    },
    wishlist: [],
  };
}

test("insurance values reconcile to exact variant, condition, quantity and manual overrides", () => {
  const catalogue = [{
    confidence: "Strong",
    hasPrice: true,
    id: "card-1",
    name: "Test Card",
    number: "1",
    priceHistory: [{
      confidence: "Fair",
      observedAt: "2026-08-20T00:00:00.000Z",
      source: "tcgcsv-card",
      valueMinor: 1_000,
      variantLabel: "Holofoil",
    }],
    rarity: "Rare",
    set: "Test Set",
    type: "card",
    valueMinor: 2_000,
  }];
  const collection = [
    {
      catalogueId: "card-1",
      condition: "Light Played",
      grade: "Raw",
      id: "owned-market",
      language: "English",
      location: "Binder",
      quantity: 2,
      variant: "Holofoil",
    },
    {
      catalogueId: "missing-card",
      condition: "Near mint",
      grade: "Raw",
      id: "owned-manual",
      language: "English",
      location: "Binder",
      overrideValueMinor: 12_345,
      quantity: 4,
      variant: "Normal",
    },
  ];
  const html = buildInsuranceReportHtml({
    data: appData(collection, catalogue),
    generatedAt: new Date("2026-08-21T00:00:00.000Z"),
  });

  assert.match(html, /£137\.45/);
  assert.match(html, /£14\.00/);
  assert.match(html, /£123\.45/);
  assert.match(html, /tcgcsv-card · 20 Aug 2026 · Fair/);
  assert.match(html, /Manual total-lot value/);
});

test("insurance HTML prints the effective finish used for a repaired premium lot", () => {
  const catalogue = [{
    confidence: "Fair",
    hasPrice: true,
    id: "team-up-170",
    name: "Latias & Latios-GX",
    number: "170",
    priceHistory: [{
      confidence: "Fair",
      observedAt: "2026-08-25T07:58:05.637Z",
      source: "pokemon-tcg-api-cardmarket",
      valueMinor: 83_960,
      variantLabel: "Holofoil",
    }],
    rarity: "Rare Ultra",
    set: "Team Up",
    type: "card",
    valueMinor: 83_960,
    variantOptions: [{ label: "Holofoil", valueMinor: 83_960 }],
  }];
  const collection = [{
    catalogueId: "team-up-170",
    condition: "Near mint",
    grade: "Raw",
    id: "owned-team-up-170",
    language: "English",
    location: "Binder",
    quantity: 1,
    variant: "Normal",
  }];
  const html = buildInsuranceReportHtml({
    data: appData(collection, catalogue),
    generatedAt: new Date("2026-08-27T00:00:00.000Z"),
  });

  assert.match(html, /<td>Holofoil<\/td>/);
  assert.doesNotMatch(html, /<td>Normal<\/td>/);
  assert.match(html, /£839\.60/);
});
