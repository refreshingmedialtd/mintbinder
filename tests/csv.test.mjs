import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCollectionCsv,
  buildCollectionImportTemplateCsv,
  COLLECTION_IMPORT_MAX_ROWS,
  inspectCollectionImportCsv,
  parseCollectionImportCsv,
} from "../src/lib/csv.ts";

const unpricedSealed = {
  id: "sealed-unpriced",
  type: "sealed",
  name: "Aquapolis Booster Pack",
  set: "Aquapolis",
  number: "Sealed",
  rarity: "Booster Pack",
  hasPrice: false,
  valueMinor: 0,
  confidence: "Weak",
};

function collectionItem(overrides = {}) {
  return {
    id: "owned-unpriced",
    catalogueId: unpricedSealed.id,
    quantity: 2,
    condition: "Sealed",
    language: "English",
    variant: "Factory sealed",
    grade: "N/A",
    location: "Shelf",
    ...overrides,
  };
}

function csvRecord(csv) {
  const [headers, row] = csv.split("\r\n").map((line) => line.split(","));

  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}

test("exports manual values for unpriced catalogue items", () => {
  const csv = buildCollectionCsv({
    catalogueById: new Map([[unpricedSealed.id, unpricedSealed]]),
    collection: [collectionItem({ overrideValueMinor: 12345, valuationNote: "Recent sold listings." })],
    exportedAt: new Date("2026-06-03T12:00:00.000Z"),
  });
  const record = csvRecord(csv);

  assert.equal(record.manual_value_gbp, "123.45");
  assert.equal(record.manual_value_minor, "12345");
  assert.equal(record.valuation_note, "Recent sold listings.");
  assert.equal(record.estimated_value_gbp, "123.45");
  assert.equal(record.estimated_value_minor, "12345");
});

test("leaves estimated value blank when no market or manual value exists", () => {
  const csv = buildCollectionCsv({
    catalogueById: new Map([[unpricedSealed.id, unpricedSealed]]),
    collection: [collectionItem()],
    exportedAt: new Date("2026-06-03T12:00:00.000Z"),
  });
  const record = csvRecord(csv);

  assert.equal(record.manual_value_gbp, "");
  assert.equal(record.valuation_note, "");
  assert.equal(record.estimated_value_gbp, "");
  assert.equal(record.estimated_value_minor, "");
});

test("exports the exact variant, condition-adjusted lot value", () => {
  const pricedCard = {
    id: "card-priced",
    type: "card",
    name: "Priced card",
    set: "Test Set",
    number: "1",
    rarity: "Rare",
    hasPrice: true,
    valueMinor: 2_000,
    confidence: "Strong",
    priceHistory: [{
      confidence: "Fair",
      observedAt: "2026-08-20T00:00:00.000Z",
      source: "tcgcsv-card",
      valueMinor: 1_000,
      variantLabel: "Holofoil",
    }],
  };
  const csv = buildCollectionCsv({
    catalogueById: new Map([[pricedCard.id, pricedCard]]),
    collection: [collectionItem({
      catalogueId: pricedCard.id,
      condition: "Light Played",
      grade: "Raw",
      quantity: 2,
      variant: "Holofoil",
    })],
    exportedAt: new Date("2026-08-21T00:00:00.000Z"),
  });
  const record = csvRecord(csv);

  assert.equal(record.estimated_value_minor, "1400");
  assert.equal(record.estimated_value_gbp, "14.00");
  assert.equal(record.confidence, "Fair");
});

test("exports the effective finish used to value a legacy premium holo-only lot", () => {
  const premiumCard = {
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
    priceHistory: [{
      confidence: "Fair",
      observedAt: "2026-08-25T07:58:05.637Z",
      source: "pokemon-tcg-api-cardmarket",
      valueMinor: 83_960,
      variantLabel: "Holofoil",
    }],
  };
  const csv = buildCollectionCsv({
    catalogueById: new Map([[premiumCard.id, premiumCard]]),
    collection: [collectionItem({
      catalogueId: premiumCard.id,
      condition: "Near mint",
      grade: "Raw",
      quantity: 1,
      variant: "Normal",
    })],
    exportedAt: new Date("2026-08-27T00:00:00.000Z"),
  });
  const record = csvRecord(csv);

  assert.equal(record.variant, "Holofoil");
  assert.equal(record.estimated_value_minor, "83960");
});

test("neutralizes spreadsheet formulas in exported text without changing numeric cells", () => {
  const dangerousCatalogue = {
    ...unpricedSealed,
    name: '=HYPERLINK("https://example.invalid")',
  };
  const csv = buildCollectionCsv({
    catalogueById: new Map([[dangerousCatalogue.id, dangerousCatalogue]]),
    collection: [collectionItem({
      location: "+CMD",
      notes: "\t=2+2",
      overrideValueMinor: 12345,
      valuationNote: "@SUM(A1:A2)",
    })],
    exportedAt: new Date("2026-06-03T12:00:00.000Z"),
  });

  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.invalid""\)"/);
  assert.match(csv, /,'@SUM\(A1:A2\),/);
  assert.match(csv, /,'\+CMD,/);
  assert.match(csv, /,'\t=2\+2,/);
  assert.match(csv, /,2,/);
  assert.match(csv, /,123\.45,12345,/);
});

test("imports manual value aliases", () => {
  const rows = parseCollectionImportCsv(
    "catalogue_id,quantity,manual_value,valuation_note,notes\r\nsealed-unpriced,2,123.45,Recent sold listings,Needs estimate",
  );

  assert.equal(rows[0].catalogueId, "sealed-unpriced");
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].overrideValue, "123.45");
  assert.equal(rows[0].valuationNote, "Recent sold listings");
});

test("round-trips grade and purchase date through collection export", () => {
  const csv = buildCollectionCsv({
    catalogueById: new Map([[unpricedSealed.id, unpricedSealed]]),
    collection: [collectionItem({ grade: "PSA 9", purchaseDate: "2026-02-14", purchasePriceMinor: 4825 })],
    exportedAt: new Date("2026-06-03T12:00:00.000Z"),
  });
  const [row] = parseCollectionImportCsv(csv);

  assert.equal(row.grade, "PSA 9");
  assert.equal(row.purchaseDate, "2026-02-14");
  assert.equal(row.paid, "48.25");
});

test("reports row-level validation errors without discarding the preview", () => {
  const inspection = inspectCollectionImportCsv(
    "catalogue_id,quantity,paid,purchase_date,manual_value\r\ncard-one,1,12.50,2026-04-05,25.00\r\n,1,-2,05/04/2026,abc\r\ncard-three,1.5,4.999,2026-13-01,10",
  );

  assert.equal(inspection.totalRows, 3);
  assert.deepEqual(inspection.rows[0].errors, []);
  assert.match(inspection.rows[1].errors.join(" "), /Catalogue ID is required/);
  assert.match(inspection.rows[1].errors.join(" "), /Paid must be a non-negative amount/);
  assert.match(inspection.rows[1].errors.join(" "), /Purchase date must use YYYY-MM-DD/);
  assert.match(inspection.rows[1].errors.join(" "), /Manual value must be a non-negative amount/);
  assert.match(inspection.rows[2].errors.join(" "), /Quantity must be a positive whole number/);
});

test("import template includes grade and purchase date columns", () => {
  const [headers] = buildCollectionImportTemplateCsv().split("\r\n");

  assert.match(headers, /(?:^|,)grade(?:,|$)/);
  assert.match(headers, /(?:^|,)purchase_date(?:,|$)/);
});

test("CSV imports accept 500 rows and reject row 501 before any API writes", () => {
  const rows = Array.from(
    { length: COLLECTION_IMPORT_MAX_ROWS + 1 },
    (_, index) => `card-${index + 1},1`,
  );
  const inspection = inspectCollectionImportCsv([
    "catalogue_id,quantity",
    ...rows,
  ].join("\r\n"));

  assert.equal(inspection.totalRows, 501);
  assert.deepEqual(inspection.rows[499].errors, []);
  assert.match(inspection.rows[500].errors.join(" "), /limited to 500 rows/);
  assert.equal(parseCollectionImportCsv(["catalogue_id,quantity", ...rows].join("\r\n")).length, 500);
});
