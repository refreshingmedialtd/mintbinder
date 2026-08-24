import type { CatalogueItem, CollectionItem } from "./types";

type CsvCell = string | number | null | undefined;
type CsvColumn<T> = {
  header: string;
  numeric?: boolean;
  value: (row: T) => CsvCell;
};

type CollectionExportRow = {
  owned: CollectionItem;
  catalogueItem?: CatalogueItem;
  exportedAt: string;
};

export type CollectionImportRow = {
  catalogueId: string;
  quantity: number;
  condition: string;
  language: string;
  variant: string;
  grade: string;
  paid: string;
  purchaseDate?: string;
  overrideValue?: string;
  valuationNote?: string;
  location: string;
  notes: string;
};

export type CollectionImportInspectionRow = {
  errors: string[];
  row: CollectionImportRow;
  rowNumber: number;
};

export type CollectionImportInspection = {
  rows: CollectionImportInspectionRow[];
  totalRows: number;
};

export const COLLECTION_IMPORT_MAX_ROWS = 500;

export function buildCollectionCsv({
  catalogueById,
  collection,
  exportedAt = new Date(),
}: {
  catalogueById: Map<string, CatalogueItem>;
  collection: CollectionItem[];
  exportedAt?: Date;
}) {
  const rows = collection.map((owned) => ({
    owned,
    catalogueItem: catalogueById.get(owned.catalogueId),
    exportedAt: exportedAt.toISOString(),
  }));

  return toCsv(collectionExportColumns, rows);
}

export function buildCollectionImportTemplateCsv() {
  return toCsv(collectionImportColumns, [
    {
      catalogueId: "card-charizard-151",
      quantity: 1,
      condition: "Near mint",
      language: "English",
      variant: "Standard",
      grade: "Raw",
      paid: "0.00",
      purchaseDate: "2026-01-01",
      valuationNote: "Optional valuation source",
      location: "Unassigned",
      notes: "Optional notes",
    },
  ]);
}

export function parseCollectionImportCsv(csv: string): CollectionImportRow[] {
  return inspectCollectionImportCsv(csv).rows
    .filter((entry) => entry.errors.length === 0)
    .map((entry) => entry.row);
}

export function inspectCollectionImportCsv(csv: string): CollectionImportInspection {
  const [headers, ...rows] = parseCsv(csv);

  if (!headers?.length) {
    return { rows: [], totalRows: 0 };
  }

  const normalizedHeaders = headers.map(normalizeHeader);
  const populatedRows = rows
    .map((row, index) => ({ cells: row, rowNumber: index + 2 }))
    .filter(({ cells }) => cells.some((cell) => cell.trim()));

  return {
    totalRows: populatedRows.length,
    rows: populatedRows.map(({ cells, rowNumber }, rowIndex) => {
      const record = new Map<string, string>();

      normalizedHeaders.forEach((header, index) => {
        record.set(header, cells[index]?.trim() ?? "");
      });

      const catalogueId = field(record, ["catalogue_id", "catalogueid", "catalogue_item_id"]);
      const quantityInput = field(record, ["quantity", "qty"]);
      const paid =
        field(record, ["paid", "purchase_price_gbp", "purchase_price"]) ||
        minorToMoney(field(record, ["purchase_price_minor"]));
      const purchaseDate = field(record, ["purchase_date", "acquisition_date", "acquired_at"]);
      const overrideValue =
        field(record, ["override_value", "manual_value", "estimated_value_gbp", "estimated_value"]) ||
        minorToMoney(field(record, ["override_value_minor", "estimated_value_minor"]));
      const valuationNote = field(record, ["valuation_note", "value_note", "pricing_note", "estimate_note"]);
      const errors: string[] = [];

      if (rowIndex >= COLLECTION_IMPORT_MAX_ROWS) {
        errors.push(`Imports are limited to ${COLLECTION_IMPORT_MAX_ROWS} rows at a time.`);
      }

      if (!catalogueId) {
        errors.push("Catalogue ID is required.");
      }

      if (quantityInput && !isPositiveInteger(quantityInput)) {
        errors.push("Quantity must be a positive whole number.");
      }

      if (paid && !isNonNegativeMoney(paid)) {
        errors.push("Paid must be a non-negative amount.");
      }

      if (overrideValue && !isNonNegativeMoney(overrideValue)) {
        errors.push("Manual value must be a non-negative amount.");
      }

      if (purchaseDate && !isDateOnly(purchaseDate)) {
        errors.push("Purchase date must use YYYY-MM-DD.");
      }

      return {
        errors,
        rowNumber,
        row: {
          catalogueId,
          quantity: parseQuantity(quantityInput),
          condition: field(record, ["condition"]) || "Near mint",
          language: field(record, ["language"]) || "English",
          variant: field(record, ["variant"]) || "Standard",
          grade: field(record, ["grade", "grading", "slab_grade"]) || "Raw",
          paid,
          purchaseDate: purchaseDate || undefined,
          overrideValue,
          valuationNote,
          location: field(record, ["location", "storage_location"]) || "Unassigned",
          notes: field(record, ["notes"]),
        },
      };
    }),
  };
}

const collectionExportColumns: Array<CsvColumn<CollectionExportRow>> = [
  { header: "collection_item_id", value: ({ owned }) => owned.id },
  { header: "catalogue_id", value: ({ owned }) => owned.catalogueId },
  { header: "catalogue_type", value: ({ catalogueItem }) => catalogueItem?.type },
  { header: "name", value: ({ catalogueItem }) => catalogueItem?.name },
  { header: "set", value: ({ catalogueItem }) => catalogueItem?.set },
  { header: "number", value: ({ catalogueItem }) => catalogueItem?.number },
  { header: "rarity", value: ({ catalogueItem }) => catalogueItem?.rarity },
  { header: "quantity", numeric: true, value: ({ owned }) => owned.quantity },
  { header: "condition", value: ({ owned }) => owned.condition },
  { header: "language", value: ({ owned }) => owned.language },
  { header: "variant", value: ({ owned }) => owned.variant },
  { header: "grade", value: ({ owned }) => owned.grade },
  { header: "purchase_price_gbp", numeric: true, value: ({ owned }) => moneyValue(owned.purchasePriceMinor) },
  { header: "purchase_price_minor", numeric: true, value: ({ owned }) => owned.purchasePriceMinor },
  { header: "manual_value_gbp", numeric: true, value: ({ owned }) => moneyValue(owned.overrideValueMinor) },
  { header: "manual_value_minor", numeric: true, value: ({ owned }) => owned.overrideValueMinor },
  { header: "valuation_note", value: ({ owned }) => owned.valuationNote },
  { header: "purchase_date", value: ({ owned }) => owned.purchaseDate },
  { header: "location", value: ({ owned }) => owned.location },
  {
    header: "estimated_value_gbp",
    numeric: true,
    value: ({ owned, catalogueItem }) => moneyValue(ownedValueMinor(owned, catalogueItem)),
  },
  {
    header: "estimated_value_minor",
    numeric: true,
    value: ({ owned, catalogueItem }) => ownedValueMinor(owned, catalogueItem),
  },
  { header: "confidence", value: ({ catalogueItem }) => catalogueItem?.confidence },
  { header: "notes", value: ({ owned }) => owned.notes },
  { header: "exported_at", value: ({ exportedAt }) => exportedAt },
];

const collectionImportColumns: Array<CsvColumn<CollectionImportRow>> = [
  { header: "catalogue_id", value: (row) => row.catalogueId },
  { header: "quantity", numeric: true, value: (row) => row.quantity },
  { header: "condition", value: (row) => row.condition },
  { header: "language", value: (row) => row.language },
  { header: "variant", value: (row) => row.variant },
  { header: "grade", value: (row) => row.grade },
  { header: "paid", numeric: true, value: (row) => row.paid },
  { header: "purchase_date", value: (row) => row.purchaseDate },
  { header: "manual_value", numeric: true, value: (row) => row.overrideValue },
  { header: "valuation_note", value: (row) => row.valuationNote },
  { header: "location", value: (row) => row.location },
  { header: "notes", value: (row) => row.notes },
];

function toCsv<T>(columns: Array<CsvColumn<T>>, rows: T[]) {
  return [
    columns.map((column) => formatCsvCell(column.header)).join(","),
    ...rows.map((row) =>
      columns.map((column) => formatCsvCell(column.value(row), !column.numeric)).join(","),
    ),
  ].join("\r\n");
}

function formatCsvCell(value: CsvCell, neutralizeFormula = true) {
  const rawText = value === null || value === undefined ? "" : String(value);
  const text = neutralizeFormula && /^[\u0000-\u0020\u007f]*[=+\-@]/.test(rawText)
    ? `'${rawText}`
    : rawText;

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let fieldValue = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    const nextCharacter = csv[index + 1];

    if (inQuotes) {
      if (character === '"' && nextCharacter === '"') {
        fieldValue += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        fieldValue += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(fieldValue);
      fieldValue = "";
    } else if (character === "\n" || character === "\r") {
      row.push(fieldValue);
      rows.push(row);
      row = [];
      fieldValue = "";

      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
    } else {
      fieldValue += character;
    }
  }

  if (fieldValue || row.length) {
    row.push(fieldValue);
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function field(record: Map<string, string>, aliases: string[]) {
  for (const alias of aliases.map(normalizeHeader)) {
    const value = record.get(alias);

    if (value) {
      return value;
    }
  }

  return "";
}

function parseQuantity(value: string) {
  const quantity = Number.parseInt(value, 10);

  return Number.isFinite(quantity) ? Math.max(1, quantity) : 1;
}

function isPositiveInteger(value: string) {
  return /^\d+$/.test(value.trim()) && Number(value) >= 1;
}

function isNonNegativeMoney(value: string) {
  return /^\d+(?:\.\d{1,2})?$/.test(value.trim());
}

function isDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function moneyValue(value?: number | null) {
  return value === null || value === undefined ? "" : (value / 100).toFixed(2);
}

function minorToMoney(value: string) {
  const minor = Number.parseInt(value, 10);

  return Number.isFinite(minor) ? moneyValue(minor) : "";
}

function ownedValueMinor(item: CollectionItem, catalogueItem?: CatalogueItem) {
  if (!catalogueItem) {
    return undefined;
  }

  return item.overrideValueMinor ?? (catalogueItem.hasPrice ? catalogueItem.valueMinor * item.quantity : undefined);
}
