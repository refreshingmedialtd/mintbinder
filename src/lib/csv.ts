import type { CatalogueItem, CollectionItem } from "./types";

type CsvCell = string | number | null | undefined;
type CsvColumn<T> = {
  header: string;
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
  paid: string;
  overrideValue?: string;
  location: string;
  notes: string;
};

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
      paid: "0.00",
      location: "Unassigned",
      notes: "Optional notes",
    },
  ]);
}

export function parseCollectionImportCsv(csv: string): CollectionImportRow[] {
  const [headers, ...rows] = parseCsv(csv);

  if (!headers?.length) {
    return [];
  }

  const normalizedHeaders = headers.map(normalizeHeader);

  return rows
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => {
      const record = new Map<string, string>();

      normalizedHeaders.forEach((header, index) => {
        record.set(header, row[index]?.trim() ?? "");
      });

      const paid =
        field(record, ["paid", "purchase_price_gbp", "purchase_price"]) ||
        minorToMoney(field(record, ["purchase_price_minor"]));
      const overrideValue =
        field(record, ["override_value", "manual_value", "estimated_value_gbp", "estimated_value"]) ||
        minorToMoney(field(record, ["override_value_minor", "estimated_value_minor"]));

      return {
        catalogueId: field(record, ["catalogue_id", "catalogueid", "catalogue_item_id"]),
        quantity: parseQuantity(field(record, ["quantity", "qty"])),
        condition: field(record, ["condition"]) || "Near mint",
        language: field(record, ["language"]) || "English",
        variant: field(record, ["variant"]) || "Standard",
        paid,
        overrideValue,
        location: field(record, ["location", "storage_location"]) || "Unassigned",
        notes: field(record, ["notes"]),
      };
    })
    .filter((row) => row.catalogueId);
}

const collectionExportColumns: Array<CsvColumn<CollectionExportRow>> = [
  { header: "collection_item_id", value: ({ owned }) => owned.id },
  { header: "catalogue_id", value: ({ owned }) => owned.catalogueId },
  { header: "catalogue_type", value: ({ catalogueItem }) => catalogueItem?.type },
  { header: "name", value: ({ catalogueItem }) => catalogueItem?.name },
  { header: "set", value: ({ catalogueItem }) => catalogueItem?.set },
  { header: "number", value: ({ catalogueItem }) => catalogueItem?.number },
  { header: "rarity", value: ({ catalogueItem }) => catalogueItem?.rarity },
  { header: "quantity", value: ({ owned }) => owned.quantity },
  { header: "condition", value: ({ owned }) => owned.condition },
  { header: "language", value: ({ owned }) => owned.language },
  { header: "variant", value: ({ owned }) => owned.variant },
  { header: "grade", value: ({ owned }) => owned.grade },
  { header: "purchase_price_gbp", value: ({ owned }) => moneyValue(owned.purchasePriceMinor) },
  { header: "purchase_price_minor", value: ({ owned }) => owned.purchasePriceMinor },
  { header: "manual_value_gbp", value: ({ owned }) => moneyValue(owned.overrideValueMinor) },
  { header: "manual_value_minor", value: ({ owned }) => owned.overrideValueMinor },
  { header: "purchase_date", value: ({ owned }) => owned.purchaseDate },
  { header: "location", value: ({ owned }) => owned.location },
  {
    header: "estimated_value_gbp",
    value: ({ owned, catalogueItem }) => moneyValue(ownedValueMinor(owned, catalogueItem)),
  },
  {
    header: "estimated_value_minor",
    value: ({ owned, catalogueItem }) => ownedValueMinor(owned, catalogueItem),
  },
  { header: "confidence", value: ({ catalogueItem }) => catalogueItem?.confidence },
  { header: "notes", value: ({ owned }) => owned.notes },
  { header: "exported_at", value: ({ exportedAt }) => exportedAt },
];

const collectionImportColumns: Array<CsvColumn<CollectionImportRow>> = [
  { header: "catalogue_id", value: (row) => row.catalogueId },
  { header: "quantity", value: (row) => row.quantity },
  { header: "condition", value: (row) => row.condition },
  { header: "language", value: (row) => row.language },
  { header: "variant", value: (row) => row.variant },
  { header: "paid", value: (row) => row.paid },
  { header: "manual_value", value: (row) => row.overrideValue },
  { header: "location", value: (row) => row.location },
  { header: "notes", value: (row) => row.notes },
];

function toCsv<T>(columns: Array<CsvColumn<T>>, rows: T[]) {
  return [
    columns.map((column) => formatCsvCell(column.header)).join(","),
    ...rows.map((row) =>
      columns.map((column) => formatCsvCell(column.value(row))).join(","),
    ),
  ].join("\r\n");
}

function formatCsvCell(value: CsvCell) {
  const text = value === null || value === undefined ? "" : String(value);

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
