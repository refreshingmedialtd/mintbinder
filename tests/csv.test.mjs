import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCollectionCsv,
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
    collection: [collectionItem({ overrideValueMinor: 12345 })],
    exportedAt: new Date("2026-06-03T12:00:00.000Z"),
  });
  const record = csvRecord(csv);

  assert.equal(record.manual_value_gbp, "123.45");
  assert.equal(record.manual_value_minor, "12345");
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
  assert.equal(record.estimated_value_gbp, "");
  assert.equal(record.estimated_value_minor, "");
});

test("imports manual value aliases", () => {
  const rows = parseCollectionImportCsv(
    "catalogue_id,quantity,manual_value,notes\r\nsealed-unpriced,2,123.45,Needs estimate",
  );

  assert.equal(rows[0].catalogueId, "sealed-unpriced");
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].overrideValue, "123.45");
});
