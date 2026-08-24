import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import fontkit from "@pdf-lib/fontkit";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import {
  buildInsuranceReportPdf,
  prepareReportText,
  unsupportedReportGlyphLabel,
  wrapReportText,
} from "../src/lib/reports/insurance-pdf.ts";

const regionalSamples = {
  JP: "日本語ポケモン",
  KR: "한국어 포켓몬 카드",
  SC: "简体中文 这张宝可梦卡收藏于保险柜",
  TC: "繁體中文 粵語收藏𠵱",
};
const additionalScriptSamples = {
  Arabic: "محمد بطاقات بوكيمون",
  Devanagari: "पोकेमॉन कार्ड संग्रह",
  Thai: "โปเกมอน การ์ดสะสม",
};

test("bundled insurance fonts cover representative Japanese, Korean, SC and TC evidence", async () => {
  for (const [region, sample] of Object.entries(regionalSamples)) {
    const bytes = await readFile(resolve(`public/fonts/NotoSans${region}-Regular.ttf`));
    const font = fontkit.create(bytes);
    const missing = Array.from(sample)
      .filter((character) => character !== " ")
      .filter((character) => !font.hasGlyphForCodePoint(character.codePointAt(0)));
    assert.deepEqual(missing, [], `${region} font is missing: ${missing.join("")}`);
  }

  const japanese = fontkit.create(await readFile(resolve("public/fonts/NotoSansJP-Regular.ttf")));
  assert.equal(japanese.hasGlyphForCodePoint("한".codePointAt(0)), false);
  assert.equal(japanese.hasGlyphForCodePoint("简".codePointAt(0)), false);
  assert.equal(japanese.hasGlyphForCodePoint("粵".codePointAt(0)), false);
});

test("insurance text wrapping bounds long no-space CJK labels", () => {
  const measure = (value) => Array.from(value).length;
  const result = wrapReportText("寶可夢收藏冊保險庫內的珍藏卡牌與購買證明", {
    maxLines: 2,
    maxWidth: 7,
    measure,
  });

  assert.equal(result.truncated, true);
  assert.equal(result.lines.length, 2);
  assert.ok(result.lines.every((line) => measure(line) <= 7));
  assert.match(result.lines[1], /\.\.\.$/);
});

test("bundled report fonts preserve Arabic, Devanagari and Thai evidence", async () => {
  for (const [family, sample] of Object.entries(additionalScriptSamples)) {
    const bytes = await readFile(resolve(`public/fonts/NotoSans${family}-Regular.ttf`));
    const font = fontkit.create(bytes);
    const missing = Array.from(sample)
      .filter((character) => character !== " ")
      .filter((character) => !font.hasGlyphForCodePoint(character.codePointAt(0)));
    assert.deepEqual(missing, [], `${family} font is missing: ${missing.join("")}`);
  }
});

test("unsupported emoji are surfaced as explicit Unicode evidence markers", () => {
  assert.equal(unsupportedReportGlyphLabel("📦"), "[U+1F4E6]");
  assert.equal(unsupportedReportGlyphLabel("🗃️"), "[U+1F5C3][U+FE0F]");
  assert.notEqual(unsupportedReportGlyphLabel("📦"), "?");
});

test("Arabic report lines are shaped and reordered as a complete visual paragraph", () => {
  const logical = "محمد بطاقات بوكيمون";
  const visual = prepareReportText(logical);

  assert.notEqual(visual, logical);
  assert.equal(visual.split(" ").length, 3);
  assert.equal(visual.split(" ")[0], "ﻥﻭﻤﻴﻛﻭﺑ");
  assert.equal(visual.split(" ").at(-1), "ﺪﻤﺤﻣ");
  assert.match(visual, /[\uFE70-\uFEFF]/u);
});

test("insurance PDF embeds required Arabic, Devanagari and Thai fonts", async () => {
  const pdf = await buildInsuranceReportPdf({
    generatedAt: new Date("2026-08-24T12:00:00.000Z"),
    ownerEmail: "collector@example.com",
    ownerName: `${Object.values(additionalScriptSamples).join(" / ")} / 📦`,
    data: emptyReportData(),
  });
  const baseFonts = await embeddedBaseFonts(pdf);

  for (const family of Object.keys(additionalScriptSamples)) {
    assert.ok(
      Array.from(baseFonts).some((name) => name.includes(`NotoSans${family}`)),
      `expected embedded ${family} font; found ${Array.from(baseFonts).join(", ")}`,
    );
  }
});

test("insurance PDF embeds only the required regional CJK fonts", async () => {
  const catalogue = Object.values(regionalSamples).map((name, index) => ({
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
    type: "card",
    name,
    set: name,
    number: `${index + 1}/4`,
    rarity: "Rare",
    hasPrice: true,
    valueMinor: 1_000 + index * 100,
    confidence: "Strong",
    priceSource: "test-market",
    priceObservedAt: "2026-08-23T09:00:00.000Z",
  }));
  const collection = catalogue.map((item, index) => ({
    id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`,
    catalogueId: item.id,
    quantity: 1,
    condition: "Near mint",
    language: Object.keys(regionalSamples)[index],
    variant: "Standard",
    grade: "Raw",
    purchasePriceMinor: 700,
    purchaseDate: "2026-01-12",
    location: item.name,
  }));
  const pdf = await buildInsuranceReportPdf({
    generatedAt: new Date("2026-08-24T12:00:00.000Z"),
    ownerEmail: "collector@example.com",
    ownerName: Object.values(regionalSamples).join(" / "),
    data: {
      catalogue,
      collection,
      wishlist: [],
      sets: [],
      storageLocations: catalogue.map((item, index) => ({
        id: String(index + 1),
        name: item.name,
        type: "Binder",
        itemCount: 1,
        totalQuantity: 1,
        valueMinor: item.valueMinor,
      })),
      events: [],
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
  assert.equal(document.getPageCount(), 2);
  const baseFonts = await embeddedBaseFonts(pdf);
  for (const region of Object.keys(regionalSamples)) {
    assert.ok(
      Array.from(baseFonts).some((name) => name.includes(`NotoSans${region}`)),
      `expected embedded ${region} font; found ${Array.from(baseFonts).join(", ")}`,
    );
  }
});

async function embeddedBaseFonts(pdf) {
  const document = await PDFDocument.load(pdf);
  const baseFonts = new Set();
  for (const page of document.getPages()) {
    const resources = page.node.Resources();
    const fonts = resources?.lookupMaybe(PDFName.of("Font"), PDFDict);
    if (!fonts) continue;
    for (const [, reference] of fonts.entries()) {
      const dictionary = document.context.lookup(reference, PDFDict);
      const baseFont = dictionary.get(PDFName.of("BaseFont"));
      if (baseFont) baseFonts.add(baseFont.toString());
    }
  }
  return baseFonts;
}

function emptyReportData() {
  return {
    catalogue: [],
    collection: [],
    wishlist: [],
    sets: [],
    storageLocations: [],
    events: [],
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
  };
}
