import type { AppData, CatalogueItem, CollectionEvent, CollectionItem, StorageLocation } from "../types.ts";
import { collectionItemValuation, collectionItemValueMinor } from "../valuation.ts";

export type InsuranceReportInput = {
  data: AppData;
  generatedAt?: Date;
  historyNotice?: string;
  ownerEmail?: string;
  ownerName?: string;
};

export function buildInsuranceReportHtml({
  data,
  generatedAt = new Date(),
  historyNotice,
  ownerEmail,
  ownerName,
}: InsuranceReportInput) {
  const catalogueById = new Map(data.catalogue.map((item) => [item.id, item]));
  const knownValueMinor = data.collection.reduce(
    (total, item) => total + (ownedValueMinor(item, catalogueById.get(item.catalogueId)) ?? 0),
    0,
  );
  const totalQuantity = data.collection.reduce((total, item) => total + item.quantity, 0);
  const unvaluedLots = data.collection.filter((item) => ownedValueMinor(item, catalogueById.get(item.catalogueId)) === undefined).length;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Mint Binder Insurance Report</title>
  <style>
    body { color: #171717; font-family: Arial, sans-serif; margin: 32px; }
    h1 { margin-bottom: 4px; }
    h2 { border-bottom: 1px solid #d4d7dd; margin-top: 28px; padding-bottom: 6px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
    th { color: #555f6f; font-size: 12px; text-transform: uppercase; }
    .summary { display: grid; gap: 8px; grid-template-columns: repeat(4, 1fr); margin: 20px 0; }
    .card { border: 1px solid #e5e7eb; padding: 12px; }
    .muted { color: #626b77; }
  </style>
</head>
<body>
  <h1>Mint Binder Insurance Report</h1>
  <p class="muted">Generated ${escapeHtml(formatDate(generatedAt.toISOString()))}${ownerName ? ` for ${escapeHtml(ownerName)}` : ""}${ownerEmail ? ` (${escapeHtml(ownerEmail)})` : ""}</p>
  <section class="summary">
    <div class="card"><strong>${escapeHtml(formatMoney(knownValueMinor))}</strong><br /><span class="muted">Known value</span></div>
    <div class="card"><strong>${data.collection.length}</strong><br /><span class="muted">Tracked lots</span></div>
    <div class="card"><strong>${totalQuantity}</strong><br /><span class="muted">Total quantity</span></div>
    <div class="card"><strong>${unvaluedLots}</strong><br /><span class="muted">Unvalued lots</span></div>
  </section>
  ${storageSection(data.storageLocations)}
  ${collectionSection(data.collection, catalogueById)}
  ${historySection(data.events, historyNotice)}
</body>
</html>`;
}

function storageSection(locations: StorageLocation[]) {
  if (!locations.length) {
    return "<h2>Storage</h2><p class=\"muted\">No storage locations recorded.</p>";
  }

  return `<h2>Storage</h2>
  <table>
    <thead><tr><th>Location</th><th>Type</th><th>Lots</th><th>Quantity</th><th>Value</th><th>Notes</th></tr></thead>
    <tbody>
      ${locations
        .map(
          (location) => `<tr>
            <td>${escapeHtml(location.name)}</td>
            <td>${escapeHtml(location.type)}</td>
            <td>${location.itemCount}</td>
            <td>${location.totalQuantity}</td>
            <td>${escapeHtml(formatMoney(location.valueMinor))}</td>
            <td>${escapeHtml(location.notes ?? "")}</td>
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>`;
}

function collectionSection(collection: CollectionItem[], catalogueById: Map<string, CatalogueItem>) {
  if (!collection.length) {
    return "<h2>Collection</h2><p class=\"muted\">No active collection items recorded.</p>";
  }

  return `<h2>Collection</h2>
  <table>
    <thead><tr><th>Item</th><th>Set</th><th>Qty</th><th>Condition</th><th>Variant</th><th>Grade</th><th>Location</th><th>Paid</th><th>Value</th><th>Value source</th><th>Valuation note</th><th>Notes</th></tr></thead>
    <tbody>
      ${collection
        .map((owned) => {
          const catalogueItem = catalogueById.get(owned.catalogueId);
          const valuation = collectionItemValuation(owned, catalogueItem);

          return `<tr>
            <td>${escapeHtml(catalogueItem?.name ?? "Unknown item")}</td>
            <td>${escapeHtml(catalogueItem?.set ?? "")}</td>
            <td>${owned.quantity}</td>
            <td>${escapeHtml(owned.condition)}</td>
            <td>${escapeHtml(owned.variant)}</td>
            <td>${escapeHtml(owned.grade)}</td>
            <td>${escapeHtml(owned.location)}</td>
            <td>${escapeHtml(formatMoney(owned.purchasePriceMinor))}</td>
            <td>${escapeHtml(formatMoney(ownedValueMinor(owned, catalogueItem)))}</td>
            <td>${escapeHtml(valuationEvidence(valuation))}</td>
            <td>${escapeHtml(owned.valuationNote ?? "")}</td>
            <td>${escapeHtml(owned.notes ?? "")}</td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>`;
}

function historySection(events: CollectionEvent[], notice?: string) {
  const importantEvents = events.filter((event) => event.type === "Sold" || event.type === "Removed" || event.type === "Graded");

  if (!importantEvents.length) {
    return "<h2>Important History</h2><p class=\"muted\">No sales, removals, or grading events recorded.</p>";
  }

  return `<h2>Important History</h2>
  ${notice ? `<p class="muted">${escapeHtml(notice)}</p>` : ""}
  <table>
    <thead><tr><th>Date</th><th>Event</th><th>Item</th><th>Qty</th><th>Amount</th><th>Notes</th></tr></thead>
    <tbody>
      ${importantEvents
        .map(
          (event) => `<tr>
            <td>${escapeHtml(formatDate(event.occurredAt))}</td>
            <td>${escapeHtml(event.type)}</td>
            <td>${escapeHtml(event.itemName)}</td>
            <td>${event.quantity ?? ""}</td>
            <td>${escapeHtml(formatMoney(event.amountMinor))}</td>
            <td>${escapeHtml(event.notes ?? "")}</td>
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>`;
}

function ownedValueMinor(item: CollectionItem, catalogueItem?: CatalogueItem) {
  return collectionItemValueMinor(item, catalogueItem);
}

function valuationEvidence(valuation: ReturnType<typeof collectionItemValuation>) {
  if (valuation.kind === "manual") {
    return "Manual total-lot value";
  }

  if (valuation.kind === "unvalued") {
    return "No exact market price";
  }

  const point = valuation.pricePoint;

  return point
    ? `${point.source} · ${formatDate(point.observedAt)} · ${point.confidence}`
    : "Generic market estimate";
}

function formatMoney(valueMinor?: number | null) {
  if (valueMinor === null || valueMinor === undefined) {
    return "Unknown";
  }

  return `£${(valueMinor / 100).toLocaleString("en-GB", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
