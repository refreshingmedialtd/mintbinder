import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildInsuranceReportPdf } from "../src/lib/reports/insurance-pdf.ts";

const catalogue = [
  ["Charizard ex", "151", "199/165", 13250, "tcgcsv-card", "Strong"],
  ["Umbreon VMAX", "Evolving Skies", "215/203", 106800, "tcgcsv-card", "Strong"],
  ["Mew ex", "151", "205/165", 6850, "tcgcsv-card", "Fair"],
  ["ピカチュウ / Pikachu", "VSTARユニバース / VSTAR Universe", "205/172", 1780, "pokemon-tcg-api", "Fair"],
  ["151 Booster Bundle", "151", "Sealed", 5699, "tcgcsv", "Strong"],
  ["Evolving Skies Booster Box", "Evolving Skies", "Sealed", 83500, "tcgcsv", "Strong"],
  ["Paldean Fates ETB", "Paldean Fates", "Sealed", 6145, "tcgcsv", "Fair"],
  ["Rayquaza VMAX", "Evolving Skies", "218/203", 29800, "tcgcsv-card", "Strong"],
  ["Giratina V", "Lost Origin", "186/196", 31200, "tcgcsv-card", "Strong"],
  ["Moonbreon display copy", "Evolving Skies", "215/203", 109000, "manual", "Weak"],
].map(([name, set, number, valueMinor, priceSource, confidence], index) => ({
  id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
  type: number === "Sealed" ? "sealed" : "card",
  name,
  set,
  number,
  rarity: number === "Sealed" ? "Sealed product" : "Secret rare",
  hasPrice: true,
  valueMinor,
  confidence,
  priceSource,
  priceObservedAt: `2026-08-${String(23 - (index % 4)).padStart(2, "0")}T09:00:00.000Z`,
}));

const collection = catalogue.map((item, index) => ({
  id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`,
  catalogueId: item.id,
  quantity: index === 4 ? 3 : 1,
  condition: item.type === "sealed" ? "Sealed" : index === 1 ? "Mint" : "Near mint",
  language: index === 3 ? "Japanese / 日本語" : "English",
  variant: item.type === "sealed" ? "Factory sealed" : "Standard",
  grade: index === 1 ? "PSA 10" : item.type === "sealed" ? "N/A" : "Raw",
  purchasePriceMinor: Math.round(item.valueMinor * 0.62),
  purchaseDate: `202${2 + (index % 4)}-0${1 + (index % 8)}-14`,
  location: index < 4 ? "Display binder" : index < 7 ? "Sealed cabinet" : "Safe",
  valuationNote: index === 9 ? "Manual value pending fresh provider evidence." : undefined,
  notes: index === 1 ? "Certification recorded in collection notes." : undefined,
}));

const storageLocations = [
  { id: "1", name: "Display binder", type: "Binder", itemCount: 4, totalQuantity: 4, valueMinor: 147680 },
  { id: "2", name: "Sealed cabinet", type: "Display", itemCount: 3, totalQuantity: 5, valueMinor: 106742 },
  { id: "3", name: "Safe / 保管庫", type: "Safe", itemCount: 3, totalQuantity: 3, valueMinor: 170000 },
];

const events = [
  { id: "event-1", type: "Graded", itemId: collection[1].id, catalogueId: catalogue[1].id, itemName: "Umbreon VMAX", quantity: 1, occurredAt: "2026-04-18", notes: "Returned PSA 10." },
  { id: "event-2", type: "Sold", itemId: collection[3].id, catalogueId: catalogue[3].id, itemName: "ピカチュウ / Pikachu", quantity: 1, amountMinor: 1900, currency: "GBP", occurredAt: "2026-06-22", notes: "Recorded sale example." },
];

const data = {
  catalogue,
  collection,
  wishlist: [],
  sets: [],
  storageLocations,
  events,
  source: "database",
  subscription: {
    plan: "plus",
    entitlements: {
      "billing.portal": true,
      "exports.insurance_report": true,
      "pricing.alerts": true,
    },
  },
  notificationPreferences: {
    priceAlertsEnabled: true,
    wishlistTargetAlertsEnabled: true,
    weakPriceAlertsEnabled: true,
    digestFrequency: "Daily",
  },
};

const pdf = await buildInsuranceReportPdf({
  data,
  generatedAt: new Date("2026-08-24T14:00:00.000Z"),
  ownerName: "Sample Collector / 山田太郎",
  ownerEmail: "collector@example.com",
});
const outputDirectory = resolve("output/pdf");
const outputPath = resolve(outputDirectory, "mintbinder-insurance-report-sample.pdf");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, pdf);
console.log(outputPath);
