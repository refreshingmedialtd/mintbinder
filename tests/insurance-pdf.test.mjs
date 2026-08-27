import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  buildInsuranceReportPdf,
  insuranceCoverStorageSummaries,
  insuranceCatalogueLabels,
  insuranceReportImageCandidates,
  insuranceStorageSummaries,
  safeReportText,
} from "../src/lib/reports/insurance-pdf.ts";

const catalogueId = "11111111-1111-4111-8111-111111111111";
const collectionId = "22222222-2222-4222-8222-222222222222";

test("insurance storage summary includes named and unassigned lots", () => {
  const summaries = insuranceStorageSummaries([
    { owned: { location: "Main binder", quantity: 1 }, valueMinor: 1_250 },
    { owned: { location: "", quantity: 2 }, valueMinor: 500 },
    { owned: { location: "Unassigned", quantity: 1 } },
  ], ["Main binder"]);

  assert.deepEqual(summaries, [
    { name: "Main binder", itemCount: 1, totalQuantity: 1, valueMinor: 1_250 },
    { name: "Unassigned", itemCount: 2, totalQuantity: 3, valueMinor: 500 },
  ]);
});

test("insurance cover keeps unassigned visible and aggregates overflow locations", () => {
  const named = Array.from({ length: 11 }, (_, index) => ({
    name: `Location ${index + 1}`,
    itemCount: 1,
    totalQuantity: 1,
    valueMinor: 100,
  }));
  const unassigned = { name: "Unassigned", itemCount: 2, totalQuantity: 3, valueMinor: 500 };
  const cover = insuranceCoverStorageSummaries([...named, unassigned]);

  assert.equal(cover.length, 9);
  assert.deepEqual(cover.at(-1), unassigned);
  assert.deepEqual(cover.at(-2), {
    name: "Other locations (4)",
    itemCount: 4,
    totalQuantity: 4,
    valueMinor: 400,
  });
  assert.equal(cover.reduce((total, row) => total + row.valueMinor, 0), 1_600);
});

test("insurance thumbnails prefer compact image sources before full-resolution scans", () => {
  const candidates = insuranceReportImageCandidates({
    id: catalogueId,
    type: "card",
    name: "Pikachu",
    set: "Base Set",
    number: "58/102",
    rarity: "Common",
    image: "https://images.pokemontcg.io/base1/58_hires.png",
    imageFallbacks: [
      "https://images.pokemontcg.io/base1/58.png",
      "https://images.scrydex.com/pokemon/base1-58/medium",
    ],
    hasPrice: true,
    valueMinor: 1_250,
    confidence: "Strong",
  });

  assert.deepEqual(candidates, [
    "https://images.pokemontcg.io/base1/58.png",
    "https://images.scrydex.com/pokemon/base1-58/medium",
    "https://images.pokemontcg.io/base1/58_hires.png",
  ]);
});

test("insurance export creates a readable, multi-page PDF", async () => {
  const pdf = await buildInsuranceReportPdf({
    generatedAt: new Date("2026-08-24T12:00:00.000Z"),
    ownerEmail: "collector@example.com",
    ownerName: "Test Collector",
    data: {
      catalogue: [{
        id: catalogueId,
        type: "card",
        name: "Pikachu",
        set: "Base Set",
        number: "58/102",
        rarity: "Common",
        hasPrice: true,
        valueMinor: 1250,
        confidence: "Strong",
        priceSource: "test-market",
        priceObservedAt: "2026-08-23T09:00:00.000Z",
      }],
      collection: [{
        id: collectionId,
        catalogueId,
        quantity: 1,
        condition: "Near mint",
        language: "English",
        variant: "Standard",
        grade: "Raw",
        purchasePriceMinor: 700,
        purchaseDate: "2026-01-12",
        location: "Main binder",
      }],
      wishlist: [],
      sets: [],
      storageLocations: [{
        id: "33333333-3333-4333-8333-333333333333",
        name: "Main binder",
        type: "Binder",
        itemCount: 1,
        totalQuantity: 1,
        valueMinor: 1250,
      }],
      events: [{
        id: "44444444-4444-4444-8444-444444444444",
        type: "Graded",
        itemId: collectionId,
        catalogueId,
        itemName: "Pikachu",
        quantity: 1,
        occurredAt: "2026-04-01T10:00:00.000Z",
      }],
      source: "database",
      subscription: {
        plan: "plus",
        entitlements: { "exports.insurance_report": true },
      },
      notificationPreferences: {
        priceAlertsEnabled: false,
        wishlistTargetAlertsEnabled: false,
        weakPriceAlertsEnabled: false,
        digestFrequency: "Off",
      },
    },
  });

  assert.equal(Buffer.from(pdf).subarray(0, 5).toString("ascii"), "%PDF-");
  const document = await PDFDocument.load(pdf);
  assert.equal(document.getPageCount(), 3);
  assert.equal(document.getTitle(), "Mint Binder Insurance Report");
});

test("international insurance rows prefer identifying display labels and preserve local script", async () => {
  const japanese = insuranceCatalogueLabels({
    id: "jp-card",
    type: "card",
    name: "ピカチュウ",
    displayName: "Pikachu",
    set: "ポケモンカード151",
    displaySet: "Pokemon Card 151",
    languageLabel: "Japanese",
    number: "025/165",
    rarity: "Common",
    hasPrice: false,
    valueMinor: 0,
    confidence: "Weak",
  }, { language: "Japanese", variant: "Holofoil" });
  const korean = insuranceCatalogueLabels({
    id: "kr-card",
    type: "card",
    name: "이상해씨",
    displayName: "Bulbasaur",
    set: "포켓몬 카드 151",
    displaySet: "Pokemon Card 151",
    languageLabel: "Korean",
    number: "001/165",
    rarity: "Common",
    hasPrice: false,
    valueMinor: 0,
    confidence: "Weak",
  }, { language: "Korean" });

  assert.deepEqual(japanese, {
    name: "Pikachu",
    set: "Pokemon Card 151",
    number: "No. 025/165",
    language: "Japanese",
    variant: "Holofoil",
  });
  assert.deepEqual(korean, {
    name: "Bulbasaur",
    set: "Pokemon Card 151",
    number: "No. 001/165",
    language: "Korean",
    variant: undefined,
  });
  assert.equal(`${Object.values(japanese)}${Object.values(korean)}`.includes("???"), false);
  assert.equal(safeReportText("山田太郎", "Account holder"), "山田太郎");
  assert.equal(safeReportText("Pokemon 151 ポケモン", "Set unavailable"), "Pokemon 151 ポケモン");
  assert.equal(safeReportText("\u0000\u0007", "Unavailable"), "Unavailable");
});

test("insurance PDF labels use the same effective premium finish as valuation", () => {
  const premium = {
    id: "team-up-170",
    type: "card",
    name: "Latias & Latios-GX",
    set: "Team Up",
    number: "170",
    rarity: "Rare Ultra",
    hasPrice: true,
    valueMinor: 83_960,
    confidence: "Fair",
    variantOptions: [{ label: "Holofoil", valueMinor: 83_960 }],
  };

  assert.equal(
    insuranceCatalogueLabels(premium, { language: "English", variant: "Normal" }).variant,
    "Holofoil",
  );
  assert.equal(
    insuranceCatalogueLabels({
      ...premium,
      variantOptions: [
        { label: "Normal", valueMinor: 50_000 },
        { label: "Holofoil", valueMinor: 83_960 },
      ],
    }, { language: "English", variant: "Normal" }).variant,
    "Normal",
  );
});

test("insurance export embeds CJK owner, storage, catalogue, and history text", async () => {
  const pdf = await buildInsuranceReportPdf({
    generatedAt: new Date("2026-08-24T12:00:00.000Z"),
    ownerEmail: "collector@example.jp",
    ownerName: "山田太郎",
    data: {
      catalogue: [{
        id: catalogueId,
        type: "card",
        name: "ピカチュウ",
        set: "ポケモンカード151",
        number: "025/165",
        rarity: "コモン",
        hasPrice: true,
        valueMinor: 1250,
        confidence: "Strong",
        priceSource: "test-market",
        priceObservedAt: "2026-08-23T09:00:00.000Z",
      }],
      collection: [{
        id: collectionId,
        catalogueId,
        quantity: 1,
        condition: "Near mint",
        language: "日本語",
        variant: "Standard",
        grade: "Raw",
        purchasePriceMinor: 700,
        purchaseDate: "2026-01-12",
        location: "保管庫",
      }],
      wishlist: [],
      sets: [],
      storageLocations: [{
        id: "33333333-3333-4333-8333-333333333333",
        name: "保管庫",
        type: "Safe",
        itemCount: 1,
        totalQuantity: 1,
        valueMinor: 1250,
      }],
      events: [{
        id: "44444444-4444-4444-8444-444444444444",
        type: "Graded",
        itemId: collectionId,
        catalogueId,
        itemName: "ピカチュウ",
        quantity: 1,
        occurredAt: "2026-04-01T10:00:00.000Z",
      }],
      source: "database",
      subscription: {
        plan: "plus",
        entitlements: { "exports.insurance_report": true },
      },
      notificationPreferences: {
        priceAlertsEnabled: false,
        wishlistTargetAlertsEnabled: false,
        weakPriceAlertsEnabled: false,
        digestFrequency: "Off",
      },
    },
  });

  assert.equal(Buffer.from(pdf).subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 3);
});
