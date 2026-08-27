import { readFile } from "node:fs/promises";
import { join } from "node:path";
import "regenerator-runtime/runtime.js";
import { resolveBidi } from "@bidiscope/core";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { fetchWithPolicy } from "../http/fetch-with-policy.ts";
import { catalogueItemImageCandidates } from "../catalogue/card-images.ts";
import type { CatalogueItem, CollectionEvent, CollectionItem } from "../types.ts";
import {
  collectionItemValuation,
  collectionItemValueMinor,
  effectiveCollectionVariant,
  type CollectionItemValuation,
} from "../valuation.ts";
import type { InsuranceReportInput } from "./insurance.ts";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 38;
const IMAGE_DOWNLOAD_BUDGET_MS = 8_000;
const COLOURS = {
  ink: rgb(0.09, 0.19, 0.22),
  muted: rgb(0.38, 0.44, 0.45),
  paper: rgb(0.98, 0.97, 0.93),
  teal: rgb(0.12, 0.45, 0.42),
  tealLight: rgb(0.89, 0.95, 0.93),
  gold: rgb(0.78, 0.61, 0.28),
  rule: rgb(0.82, 0.84, 0.81),
  white: rgb(1, 1, 1),
};
const IMAGE_HOSTS = new Set([
  "images.pokemontcg.io",
  "images.scrydex.com",
  "assets.tcgdex.net",
  "tcgplayer-cdn.tcgplayer.com",
]);
type ReportFontRegion = "AR" | "DEVA" | "JP" | "KR" | "SC" | "TC" | "THAI";
type UnicodeReportFont = {
  characters: ReadonlySet<number>;
  font: PDFFont;
  region: ReportFontRegion;
};
type ReportFontSource = {
  bytes: Uint8Array;
  characters: ReadonlySet<number>;
  region: ReportFontRegion;
};
type ReportFonts = {
  regular: PDFFont;
  bold: PDFFont;
  serif: PDFFont;
  unicode: UnicodeReportFont[];
};
type InsuranceCollectionRow = {
  owned: CollectionItem;
  catalogue?: CatalogueItem;
  valuation: CollectionItemValuation;
  valueMinor?: number;
};
type InsuranceStorageSummary = {
  name: string;
  itemCount: number;
  totalQuantity: number;
  valueMinor: number;
};

const REPORT_FONT_FILES: ReadonlyArray<{ fileName: string; region: ReportFontRegion }> = [
  { fileName: "NotoSansArabic-Regular.ttf", region: "AR" },
  { fileName: "NotoSansDevanagari-Regular.ttf", region: "DEVA" },
  { fileName: "NotoSansJP-Regular.ttf", region: "JP" },
  { fileName: "NotoSansKR-Regular.ttf", region: "KR" },
  { fileName: "NotoSansSC-Regular.ttf", region: "SC" },
  { fileName: "NotoSansTC-Regular.ttf", region: "TC" },
  { fileName: "NotoSansThai-Regular.ttf", region: "THAI" },
];
const ARABIC_CHARACTER = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u;
const DEVANAGARI_CHARACTER = /[\u0900-\u097F]/u;
const HANGUL_CHARACTER = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u;
const KANA_CHARACTER = /[\u3040-\u30FF\u31F0-\u31FF\uFF65-\uFF9F]/u;
const THAI_CHARACTER = /[\u0E00-\u0E7F]/u;
const fontCharacterSets = new WeakMap<PDFFont, ReadonlySet<number>>();

export async function buildInsuranceReportPdf({
  data,
  generatedAt = new Date(),
  historyNotice,
  ownerEmail,
  ownerName,
}: InsuranceReportInput) {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const serif = await document.embedFont(StandardFonts.TimesRomanBold);
  const unicode = await embedRequiredUnicodeFonts(document, [
    ownerEmail,
    ownerName,
    historyNotice,
    ...collectReportStrings(data),
  ], fontCharacterSet(regular));
  const fonts: ReportFonts = {
    regular,
    bold,
    serif,
    unicode,
  };
  const catalogueById = new Map(data.catalogue.map((item) => [item.id, item]));
  const rows = data.collection
    .map((owned) => ({
      owned,
      catalogue: catalogueById.get(owned.catalogueId),
      valuation: collectionItemValuation(owned, catalogueById.get(owned.catalogueId)),
      valueMinor: collectionItemValueMinor(owned, catalogueById.get(owned.catalogueId)),
    }))
    .sort((left, right) => (right.valueMinor ?? -1) - (left.valueMinor ?? -1));
  const images = await loadCatalogueImages(document, rows.map((row) => row.catalogue).filter(isCatalogueItem));

  document.setTitle("Mint Binder Insurance Report");
  document.setAuthor("Mint Binder");
  document.setSubject("Collection inventory and valuation evidence");
  document.setCreator("Mint Binder");
  document.setProducer("Mint Binder");
  document.setCreationDate(generatedAt);

  drawCoverPage({
    data,
    document,
    fonts,
    generatedAt,
    ownerEmail,
    ownerName,
    rows,
  });
  drawCollectionPages({ document, fonts, images, rows });
  drawHistoryPages({ catalogueById, document, events: data.events, fonts, historyNotice });
  drawPageFooters(document, fonts, generatedAt);

  return document.save();
}

function drawCoverPage({
  data,
  document,
  fonts,
  generatedAt,
  ownerEmail,
  ownerName,
  rows,
}: {
  data: InsuranceReportInput["data"];
  document: PDFDocument;
  fonts: ReportFonts;
  generatedAt: Date;
  ownerEmail?: string;
  ownerName?: string;
  rows: InsuranceCollectionRow[];
}) {
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: COLOURS.paper });
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 222, width: PAGE_WIDTH, height: 222, color: COLOURS.teal });
  page.drawText("MINT BINDER", {
    x: MARGIN,
    y: PAGE_HEIGHT - 54,
    size: 10,
    font: fonts.bold,
    color: rgb(0.91, 0.78, 0.49),
  });
  page.drawText("Insurance report", {
    x: MARGIN,
    y: PAGE_HEIGHT - 116,
    size: 38,
    font: fonts.serif,
    color: COLOURS.white,
  });
  drawWrappedText(page, "Collection inventory and valuation evidence", {
    x: MARGIN,
    y: PAGE_HEIGHT - 146,
    maxWidth: 360,
    size: 13,
    lineHeight: 17,
    font: fonts.regular,
    unicodeFonts: fonts.unicode,
    color: rgb(0.84, 0.93, 0.91),
  });
  const owner = [safeReportText(ownerName ?? "", ""), safeReportText(ownerEmail ?? "", "")]
    .filter(Boolean)
    .join(" - ") || "Account holder";
  drawWrappedText(page, owner, {
    x: MARGIN,
    y: PAGE_HEIGHT - 194,
    maxWidth: PAGE_WIDTH - MARGIN * 2,
    size: 9,
    lineHeight: 11,
    maxLines: 1,
    font: fonts.regular,
    unicodeFonts: fonts.unicode,
    color: COLOURS.white,
  });

  const knownValueMinor = rows.reduce((total, row) => total + (row.valueMinor ?? 0), 0);
  const totalQuantity = rows.reduce((total, row) => total + row.owned.quantity, 0);
  const unvaluedLots = rows.filter((row) => row.valueMinor === undefined).length;
  const summaries = [
    [formatMoney(knownValueMinor), "Known value"],
    [String(rows.length), "Tracked lots"],
    [String(totalQuantity), "Total quantity"],
    [String(unvaluedLots), "Unvalued lots"],
  ];
  const cardWidth = (PAGE_WIDTH - MARGIN * 2 - 30) / 4;

  summaries.forEach(([value, label], index) => {
    const x = MARGIN + index * (cardWidth + 10);
    page.drawRectangle({ x, y: 522, width: cardWidth, height: 82, color: COLOURS.white, borderColor: COLOURS.rule, borderWidth: 0.7 });
    page.drawText(safeText(value), { x: x + 11, y: 563, size: 15, font: fonts.bold, color: COLOURS.ink });
    page.drawText(label, { x: x + 11, y: 541, size: 8.5, font: fonts.regular, color: COLOURS.muted });
  });

  page.drawText("Storage summary", { x: MARGIN, y: 476, size: 17, font: fonts.serif, color: COLOURS.ink });
  let y = 448;
  const locations = insuranceCoverStorageSummaries(
    insuranceStorageSummaries(rows, data.storageLocations.map((location) => location.name)),
  );

  for (const location of locations) {
    page.drawLine({ start: { x: MARGIN, y: y - 6 }, end: { x: PAGE_WIDTH - MARGIN, y: y - 6 }, color: COLOURS.rule, thickness: 0.6 });
    drawWrappedText(page, location.name, { x: MARGIN, y: y + 5, maxWidth: 210, size: 9.5, lineHeight: 11, maxLines: 1, font: fonts.bold, unicodeFonts: fonts.unicode, color: COLOURS.ink });
    page.drawText(`${location.totalQuantity} item${location.totalQuantity === 1 ? "" : "s"}`, { x: 300, y: y + 5, size: 8.5, font: fonts.regular, color: COLOURS.muted });
    page.drawText(formatMoney(location.valueMinor), { x: 455, y: y + 5, size: 9, font: fonts.bold, color: COLOURS.ink });
    y -= 30;
  }

  page.drawRectangle({ x: MARGIN, y: 88, width: PAGE_WIDTH - MARGIN * 2, height: 88, color: COLOURS.tealLight });
  drawWrappedText(
    page,
    "Important: values are market estimates based on the source and observation date shown in the schedule. They are not a guarantee of replacement cost, authenticity, condition or insurer acceptance. Verify high-value items independently and retain purchase receipts and owned-item photographs where available.",
    {
      x: MARGIN + 16,
      y: 148,
      maxWidth: PAGE_WIDTH - MARGIN * 2 - 32,
      size: 8.5,
      lineHeight: 12,
      font: fonts.regular,
      unicodeFonts: fonts.unicode,
      color: COLOURS.ink,
    },
  );
  page.drawText(`Valuation as at ${formatDateTime(generatedAt)}`, { x: MARGIN, y: 55, size: 8.5, font: fonts.regular, color: COLOURS.muted });
}

export function insuranceStorageSummaries(
  rows: Array<{
    owned: Pick<CollectionItem, "location" | "quantity">;
    valueMinor?: number;
  }>,
  preferredLocationNames: string[] = [],
) {
  const groups = new Map<string, InsuranceStorageSummary>();

  for (const row of rows) {
    const name = row.owned.location.trim() || "Unassigned";
    const key = name.toLocaleLowerCase("en-GB");
    const current = groups.get(key) ?? {
      name,
      itemCount: 0,
      totalQuantity: 0,
      valueMinor: 0,
    };
    current.itemCount += 1;
    current.totalQuantity += row.owned.quantity;
    current.valueMinor += row.valueMinor ?? 0;
    groups.set(key, current);
  }

  const preferred: InsuranceStorageSummary[] = [];
  for (const name of preferredLocationNames) {
    const key = name.trim().toLocaleLowerCase("en-GB");
    const summary = groups.get(key);
    if (!summary) continue;
    preferred.push(summary);
    groups.delete(key);
  }

  const remaining = [...groups.values()].sort((left, right) => {
    const leftUnassigned = left.name.toLocaleLowerCase("en-GB") === "unassigned";
    const rightUnassigned = right.name.toLocaleLowerCase("en-GB") === "unassigned";
    if (leftUnassigned !== rightUnassigned) return leftUnassigned ? 1 : -1;
    return left.name.localeCompare(right.name, "en-GB");
  });

  return [...preferred, ...remaining];
}

export function insuranceCoverStorageSummaries(
  summaries: InsuranceStorageSummary[],
  maxRows = 9,
) {
  const rowLimit = Math.max(2, Math.floor(maxRows));
  if (summaries.length <= rowLimit) return summaries;

  const unassignedIndex = summaries.findIndex(
    (summary) => summary.name.toLocaleLowerCase("en-GB") === "unassigned",
  );
  const unassigned = unassignedIndex >= 0 ? summaries[unassignedIndex] : undefined;
  const named = summaries.filter((_, index) => index !== unassignedIndex);
  const visibleNamedCount = rowLimit - 1 - (unassigned ? 1 : 0);
  const visible = named.slice(0, visibleNamedCount);
  const omitted = named.slice(visibleNamedCount);
  const other = omitted.reduce<InsuranceStorageSummary>((total, summary) => ({
    name: `Other locations (${omitted.length})`,
    itemCount: total.itemCount + summary.itemCount,
    totalQuantity: total.totalQuantity + summary.totalQuantity,
    valueMinor: total.valueMinor + summary.valueMinor,
  }), {
    name: `Other locations (${omitted.length})`,
    itemCount: 0,
    totalQuantity: 0,
    valueMinor: 0,
  });

  return [...visible, other, ...(unassigned ? [unassigned] : [])];
}

function drawCollectionPages({
  document,
  fonts,
  images,
  rows,
}: {
  document: PDFDocument;
  fonts: ReportFonts;
  images: Map<string, PDFImage>;
  rows: InsuranceCollectionRow[];
}) {
  if (!rows.length) {
    const page = addReportPage(document, fonts, "Collection schedule");
    page.drawText("No active collection items were recorded when this report was generated.", {
      x: MARGIN,
      y: PAGE_HEIGHT - 120,
      size: 10,
      font: fonts.regular,
      color: COLOURS.muted,
    });
    return;
  }

  let page = addReportPage(document, fonts, "Collection schedule");
  let y = drawCollectionHeader(page, fonts);

  for (const row of rows) {
    if (y < 102) {
      page = addReportPage(document, fonts, "Collection schedule - continued");
      y = drawCollectionHeader(page, fonts);
    }

    drawCollectionRow(page, fonts, images, row, y);
    y -= 67;
  }
}

function drawCollectionHeader(page: PDFPage, fonts: ReportFonts) {
  const y = PAGE_HEIGHT - 104;
  page.drawRectangle({ x: MARGIN, y: y - 8, width: PAGE_WIDTH - MARGIN * 2, height: 25, color: COLOURS.tealLight });
  const headers = [
    ["Item and evidence", 78],
    ["Qty", 278],
    ["Condition", 307],
    ["Location", 375],
    ["Paid", 436],
    ["Value", 493],
  ] as const;
  headers.forEach(([label, x]) => page.drawText(label, { x, y, size: 7.5, font: fonts.bold, color: COLOURS.teal }));
  return y - 27;
}

function drawCollectionRow(
  page: PDFPage,
  fonts: ReportFonts,
  images: Map<string, PDFImage>,
  row: InsuranceCollectionRow,
  y: number,
) {
  const { owned, catalogue, valuation } = row;
  const labels = insuranceCatalogueLabels(catalogue, owned);
  page.drawLine({ start: { x: MARGIN, y: y - 40 }, end: { x: PAGE_WIDTH - MARGIN, y: y - 40 }, color: COLOURS.rule, thickness: 0.55 });
  const image = catalogue ? images.get(catalogue.id) : undefined;

  if (image) {
    const scaled = image.scaleToFit(32, 45);
    page.drawImage(image, { x: MARGIN, y: y - 34, width: scaled.width, height: scaled.height });
  } else {
    page.drawRectangle({ x: MARGIN, y: y - 34, width: 32, height: 45, color: COLOURS.tealLight, borderColor: COLOURS.rule, borderWidth: 0.5 });
  }

  drawWrappedText(page, labels.name, {
    x: 78,
    y: y + 3,
    maxWidth: 190,
    size: 8.2,
    lineHeight: 10,
    maxLines: 2,
    font: fonts.bold,
    unicodeFonts: fonts.unicode,
    color: COLOURS.ink,
  });
  const details = [
    labels.set,
    labels.number,
    labels.language,
    labels.variant,
    owned.purchaseDate ? `Acquired ${formatDate(owned.purchaseDate)}` : null,
  ]
    .filter(Boolean)
    .join(" - ");
  drawWrappedText(page, details, { x: 78, y: y - 19, maxWidth: 190, size: 6.8, lineHeight: 8, maxLines: 2, font: fonts.regular, unicodeFonts: fonts.unicode, color: COLOURS.muted });
  page.drawText(String(owned.quantity), { x: 280, y: y - 2, size: 8, font: fonts.regular, color: COLOURS.ink });
  drawWrappedText(page, [owned.condition, owned.grade !== "Raw" ? owned.grade : null].filter(Boolean).join(" / "), {
    x: 307, y: y - 1, maxWidth: 58, size: 7.2, lineHeight: 9, maxLines: 3, font: fonts.regular, unicodeFonts: fonts.unicode, color: COLOURS.ink,
  });
  drawWrappedText(page, owned.location, { x: 375, y: y - 1, maxWidth: 52, size: 7.2, lineHeight: 9, maxLines: 3, font: fonts.regular, unicodeFonts: fonts.unicode, color: COLOURS.ink });
  page.drawText(formatMoney(owned.purchasePriceMinor), { x: 436, y: y - 1, size: 7.2, font: fonts.regular, color: COLOURS.ink });
  page.drawText(formatMoney(row.valueMinor), { x: 493, y: y - 1, size: 7.4, font: fonts.bold, color: COLOURS.ink });
  const provenance = valuation.kind === "manual"
    ? "Manual total-lot value"
    : valuation.pricePoint
      ? `${valuation.pricePoint.source} - ${formatDate(valuation.pricePoint.observedAt)} - ${valuation.pricePoint.confidence}`
      : valuation.kind === "market"
        ? `${catalogue?.priceSource ?? "Generic market estimate"} - ${catalogue?.priceObservedAt ? formatDate(catalogue.priceObservedAt) : "date unavailable"} - ${catalogue?.confidence ?? "Unknown confidence"}`
        : "No exact market valuation";
  drawWrappedText(page, provenance, { x: 307, y: y - 24, maxWidth: 226, size: 6.2, lineHeight: 8, maxLines: 2, font: fonts.regular, unicodeFonts: fonts.unicode, color: COLOURS.muted });
}

export function insuranceCatalogueLabels(
  catalogue: CatalogueItem | undefined,
  owned: Pick<CollectionItem, "language"> & { variant?: string },
) {
  return {
    name: safeReportText(
      catalogue?.displayName || catalogue?.name || "",
      catalogue?.number ? `Catalogue item ${catalogue.number}` : "Unknown catalogue item",
    ),
    set: safeReportText(catalogue?.displaySet || catalogue?.set || "", "Set unavailable"),
    number: catalogue?.number ? `No. ${catalogue.number}` : "Number unavailable",
    language: catalogue?.languageLabel || owned.language || "Language unavailable",
    variant: owned.variant
      ? safeReportText(effectiveCollectionVariant({ variant: owned.variant }, catalogue), "Finish unavailable")
      : undefined,
  };
}

function drawHistoryPages({
  catalogueById,
  document,
  events,
  fonts,
  historyNotice,
}: {
  catalogueById: Map<string, CatalogueItem>;
  document: PDFDocument;
  events: CollectionEvent[];
  fonts: ReportFonts;
  historyNotice?: string;
}) {
  const important = events
    .filter((event) => event.type === "Sold" || event.type === "Removed" || event.type === "Graded")
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

  if (!important.length) return;

  let page = addReportPage(document, fonts, "Important collection history");
  let y = PAGE_HEIGHT - 112;

  if (historyNotice) {
    drawWrappedText(page, historyNotice, {
      x: MARGIN,
      y,
      maxWidth: PAGE_WIDTH - MARGIN * 2,
      size: 7.5,
      lineHeight: 10,
      font: fonts.regular,
      unicodeFonts: fonts.unicode,
      color: COLOURS.muted,
    });
    y -= 34;
  }

  for (const event of important) {
    if (y < 90) {
      page = addReportPage(document, fonts, "Important history - continued");
      y = PAGE_HEIGHT - 112;
    }

    page.drawText(formatDate(event.occurredAt), { x: MARGIN, y, size: 7.5, font: fonts.regular, color: COLOURS.muted });
    page.drawText(event.type, { x: 112, y, size: 8, font: fonts.bold, color: COLOURS.teal });
    const catalogue = catalogueById.get(event.catalogueId);
    const eventItemName = catalogue
      ? insuranceCatalogueLabels(catalogue, { language: catalogue.languageLabel ?? catalogue.language ?? "Unknown" }).name
      : safeReportText(
          event.itemName,
          event.catalogueId ? `Catalogue item ${event.catalogueId.slice(0, 8)}` : "Collection item",
        );
    drawWrappedText(page, eventItemName, { x: 178, y: y + 1, maxWidth: 220, size: 8, lineHeight: 10, maxLines: 2, font: fonts.bold, unicodeFonts: fonts.unicode, color: COLOURS.ink });
    page.drawText(event.quantity ? String(event.quantity) : "-", { x: 414, y, size: 8, font: fonts.regular, color: COLOURS.ink });
    page.drawText(formatMoney(event.amountMinor), { x: 463, y, size: 8, font: fonts.regular, color: COLOURS.ink });
    page.drawLine({ start: { x: MARGIN, y: y - 13 }, end: { x: PAGE_WIDTH - MARGIN, y: y - 13 }, color: COLOURS.rule, thickness: 0.5 });
    y -= 31;
  }
}

function addReportPage(document: PDFDocument, fonts: ReportFonts, title: string) {
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: COLOURS.paper });
  page.drawText("MINT BINDER", { x: MARGIN, y: PAGE_HEIGHT - 42, size: 8, font: fonts.bold, color: COLOURS.teal });
  page.drawText(safeText(title), { x: MARGIN, y: PAGE_HEIGHT - 76, size: 22, font: fonts.serif, color: COLOURS.ink });
  page.drawLine({ start: { x: MARGIN, y: PAGE_HEIGHT - 87 }, end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 87 }, color: COLOURS.gold, thickness: 1.2 });
  return page;
}

function drawPageFooters(document: PDFDocument, fonts: ReportFonts, generatedAt: Date) {
  const pages = document.getPages();

  pages.forEach((page, index) => {
    page.drawText(`Mint Binder insurance report - ${formatDate(generatedAt.toISOString())}`, {
      x: MARGIN,
      y: 28,
      size: 6.8,
      font: fonts.regular,
      color: COLOURS.muted,
    });
    const label = `${index + 1} / ${pages.length}`;
    page.drawText(label, {
      x: PAGE_WIDTH - MARGIN - fonts.regular.widthOfTextAtSize(label, 6.8),
      y: 28,
      size: 6.8,
      font: fonts.regular,
      color: COLOURS.muted,
    });
  });
}

async function loadCatalogueImages(document: PDFDocument, catalogue: CatalogueItem[]) {
  // Images are supporting evidence, not a reason to hold an export open until
  // the hosting gateway times out. Prefer compact catalogue scans because the
  // report renders them as 32 x 45 point thumbnails; embedding full-resolution
  // PNGs made a small collection report exceed 20 MB without adding evidence.
  const items = [...new Map(catalogue.map((item) => [item.id, item])).values()].slice(0, 24);
  const result = new Map<string, PDFImage>();
  const deadline = Date.now() + IMAGE_DOWNLOAD_BUDGET_MS;

  for (let index = 0; index < items.length; index += 8) {
    if (Date.now() >= deadline) break;
    const batch = items.slice(index, index + 8);
    const loaded = await Promise.all(batch.map(async (item) => {
      for (const url of insuranceReportImageCandidates(item)) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) break;
        try {
          const response = await fetchInsuranceReportImage(url, Math.min(2_500, remainingMs));
          if (!response) continue;
          const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
          const contentLength = Number(response.headers.get("content-length") ?? 0);
          if (!response.ok || contentLength > 2_000_000) continue;
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length > 2_000_000) continue;
          const image = contentType.includes("png")
            ? await document.embedPng(bytes)
            : contentType.includes("jpeg") || contentType.includes("jpg")
              ? await document.embedJpg(bytes)
              : null;
          if (image) return [item.id, image] as const;
        } catch {
          // Try the next reviewed image source for this catalogue item.
        }
      }
      return null;
    }));

    loaded.forEach((entry) => {
      if (entry) result.set(entry[0], entry[1]);
    });
  }

  return result;
}

export function insuranceReportImageCandidates(item: CatalogueItem) {
  const candidates = catalogueItemImageCandidates(item);
  const compact = candidates.filter(isCompactInsuranceImageUrl);
  return [...compact, ...candidates.filter((url) => !compact.includes(url))];
}

function isCompactInsuranceImageUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname === "images.pokemontcg.io") {
      return !/_hires\.(?:png|jpe?g)$/i.test(url.pathname);
    }
    return url.hostname === "images.scrydex.com" && /\/(?:small|medium)\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export async function fetchInsuranceReportImage(url: string, timeoutMs = 2_500) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !IMAGE_HOSTS.has(parsed.hostname)) return null;

  const response = await fetchWithPolicy(parsed, { method: "GET", redirect: "manual" }, {
    maxResponseBytes: 2_000_000,
    provider: "Insurance report image",
    retryAttempts: 0,
    timeoutMs: Math.max(1, Math.min(2_500, Math.floor(timeoutMs))),
  });

  // Redirects are deliberately not followed: each hop would otherwise need a
  // fresh protocol/hostname allowlist decision to prevent server-side request forgery.
  return response.status >= 300 && response.status < 400 ? null : response;
}

async function embedRequiredUnicodeFonts(
  document: PDFDocument,
  values: Array<string | undefined>,
  standardCharacters: ReadonlySet<number>,
) {
  const reportValues = values.filter(isString);
  const needsUnicode = reportValues.some((value) => Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && !standardCharacters.has(codePoint);
  }));
  if (!needsUnicode) return [];

  const sources = await Promise.all(REPORT_FONT_FILES.map(async ({ fileName, region }) => {
    const bytes = await readFile(join(process.cwd(), "public", "fonts", fileName));
    return {
      bytes,
      characters: new Set(fontkit.create(bytes).characterSet),
      region,
    } satisfies ReportFontSource;
  }));
  const requiredRegions = new Set<ReportFontRegion>();

  for (const value of reportValues) {
    const ordered = orderUnicodeFonts(value, sources);
    for (const character of Array.from(value)) {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined || standardCharacters.has(codePoint)) continue;
      const source = ordered.find((candidate) => candidate.characters.has(codePoint));
      if (source) requiredRegions.add(source.region);
    }
  }

  // pdf-lib/fontkit currently corrupts CJK glyph maps when subsetting these
  // large fonts. Embed only the region fonts the report actually needs, but
  // embed each selected static font intact for consistent rendering and text maps.
  const embedded: UnicodeReportFont[] = [];
  for (const source of sources) {
    if (!requiredRegions.has(source.region)) continue;
    embedded.push({
      characters: source.characters,
      font: await document.embedFont(source.bytes, { subset: false }),
      region: source.region,
    });
  }
  return embedded;
}

function collectReportStrings(value: unknown, seen = new Set<object>()): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).flatMap((entry) => collectReportStrings(entry, seen));
}

function drawWrappedText(
  page: PDFPage,
  value: string,
  {
    color,
    font,
    unicodeFonts,
    lineHeight,
    maxLines = 4,
    maxWidth,
    size,
    x,
    y,
  }: {
    color: ReturnType<typeof rgb>;
    font: PDFFont;
    unicodeFonts?: UnicodeReportFont[];
    lineHeight: number;
    maxLines?: number;
    maxWidth: number;
    size: number;
    x: number;
    y: number;
  },
) {
  const { lines } = wrapReportText(value, {
    maxLines,
    maxWidth,
    measure: (text) => reportTextWidth(text, size, font, unicodeFonts),
  });

  lines.forEach((line, index) => {
    const width = reportTextWidth(line, size, font, unicodeFonts);
    const lineX = reportTextDirection(line) === "rtl"
      ? x + Math.max(0, maxWidth - width)
      : x;
    drawTextWithFallback(page, line, {
      x: lineX,
      y: y - index * lineHeight,
      size,
      font,
      unicodeFonts,
      color,
    });
  });
}

export function wrapReportText(
  value: string,
  {
    maxLines = 4,
    maxWidth,
    measure,
  }: {
    maxLines?: number;
    maxWidth: number;
    measure: (value: string) => number;
  },
) {
  const words = safeText(value).split(" ").filter(Boolean);
  const allLines: string[] = [];
  let current = "";
  let omitted = false;

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      allLines.push(current);
      current = "";
    }
    if (measure(word) <= maxWidth) {
      current = word;
      continue;
    }

    for (const grapheme of reportGraphemes(word)) {
      const chunk = `${current}${grapheme}`;
      if (current && measure(chunk) > maxWidth) {
        allLines.push(current);
        if (measure(grapheme) <= maxWidth) current = grapheme;
        else omitted = true;
      } else {
        if (measure(chunk) <= maxWidth) current = chunk;
        else omitted = true;
      }
    }
  }

  if (current) allLines.push(current);
  const lineLimit = Math.max(0, Math.floor(maxLines));
  const lines = allLines.slice(0, lineLimit);
  const truncated = omitted || allLines.length > lines.length;

  if (truncated && lines.length) {
    const suffix = "...";
    let last = lines.at(-1) ?? "";
    while (last && measure(`${last}${suffix}`) > maxWidth) {
      last = reportGraphemes(last).slice(0, -1).join("");
    }
    lines[lines.length - 1] = measure(`${last}${suffix}`) <= maxWidth
      ? `${last.trimEnd()}${suffix}`
      : "";
  }

  return { lines, truncated };
}

function drawTextWithFallback(
  page: PDFPage,
  value: string,
  {
    color,
    font,
    size,
    unicodeFonts,
    x,
    y,
  }: {
    color: ReturnType<typeof rgb>;
    font: PDFFont;
    size: number;
    unicodeFonts?: UnicodeReportFont[];
    x: number;
    y: number;
  },
) {
  let cursor = x;
  for (const run of reportFontRuns(value, font, unicodeFonts)) {
    page.drawText(run.text, { x: cursor, y, size, font: run.font, color });
    cursor += run.font.widthOfTextAtSize(run.text, size);
  }
}

function reportTextWidth(value: string, size: number, font: PDFFont, unicodeFonts: UnicodeReportFont[] = []) {
  return reportFontRuns(value, font, unicodeFonts)
    .reduce((width, run) => width + run.font.widthOfTextAtSize(run.text, size), 0);
}

function reportFontRuns(value: string, font: PDFFont, unicodeFonts: UnicodeReportFont[] = []) {
  const runs: Array<{ font: PDFFont; text: string }> = [];
  const preparedValue = prepareReportText(value);
  const ordered = orderUnicodeFonts(preparedValue, unicodeFonts);
  const standardCharacters = fontCharacterSet(font);

  for (const character of Array.from(preparedValue)) {
    const codePoint = character.codePointAt(0);
    const unicodeFont = codePoint === undefined
      ? undefined
      : ordered.find((candidate) => candidate.characters.has(codePoint));
    const supportedByStandard = codePoint !== undefined && standardCharacters.has(codePoint);
    const runFont = supportedByStandard ? font : unicodeFont?.font ?? font;
    // Emoji and rarer scripts without a bundled outline are rendered as an
    // explicit Unicode evidence marker instead of silently falsifying the
    // account/report value with a question mark.
    const runText = supportedByStandard || unicodeFont
      ? character
      : unsupportedReportGlyphLabel(character);
    const previous = runs.at(-1);
    if (previous?.font === runFont) previous.text += runText;
    else runs.push({ font: runFont, text: runText });
  }

  return runs;
}

/**
 * pdf-lib/fontkit can encode Arabic glyphs, but it does not perform paragraph-
 * level bidirectional layout across fallback-font runs. Resolve the entire line
 * first and emit contextual presentation forms so spaces, punctuation, numbers,
 * and Latin fragments retain their correct visual relationship in the PDF.
 */
export function prepareReportText(value: string) {
  if (!ARABIC_CHARACTER.test(value)) return value;
  return resolveReportBidi(value).visual;
}

function reportTextDirection(value: string) {
  if (!ARABIC_CHARACTER.test(value)) return "ltr";
  return resolveReportBidi(value).paragraphDirection;
}

function resolveReportBidi(value: string) {
  return resolveBidi(value, {
    baseDirection: "auto",
    codeContext: false,
    preserveAnsi: false,
    shaping: true,
    shapingMode: "presentation-forms",
  });
}

function orderUnicodeFonts<T extends { characters: ReadonlySet<number>; region: ReportFontRegion }>(
  value: string,
  fonts: T[],
) {
  const byRegion = new Map(fonts.map((font) => [font.region, font]));
  const characters = Array.from(value);
  const codePoints = characters
    .map((character) => character.codePointAt(0))
    .filter((codePoint): codePoint is number => codePoint !== undefined);
  const sc = byRegion.get("SC");
  const tc = byRegion.get("TC");
  const scExclusive = Boolean(sc && codePoints.some((codePoint) =>
    sc.characters.has(codePoint) && !tc?.characters.has(codePoint)));
  const tcExclusive = Boolean(tc && codePoints.some((codePoint) =>
    tc.characters.has(codePoint) && !sc?.characters.has(codePoint)));
  const preferred: ReportFontRegion = ARABIC_CHARACTER.test(value)
    ? "AR"
    : DEVANAGARI_CHARACTER.test(value)
      ? "DEVA"
      : THAI_CHARACTER.test(value)
        ? "THAI"
        : HANGUL_CHARACTER.test(value)
          ? "KR"
          : KANA_CHARACTER.test(value)
            ? "JP"
            : tcExclusive && !scExclusive
              ? "TC"
              : scExclusive && !tcExclusive
                ? "SC"
                : "JP";
  const fallbackRegions: Record<ReportFontRegion, ReportFontRegion[]> = {
    AR: ["AR", "DEVA", "THAI", "JP", "SC", "TC", "KR"],
    DEVA: ["DEVA", "THAI", "AR", "JP", "SC", "TC", "KR"],
    JP: ["JP", "SC", "TC", "KR", "AR", "DEVA", "THAI"],
    KR: ["KR", "JP", "SC", "TC", "AR", "DEVA", "THAI"],
    SC: ["SC", "TC", "JP", "KR", "AR", "DEVA", "THAI"],
    TC: ["TC", "SC", "JP", "KR", "AR", "DEVA", "THAI"],
    THAI: ["THAI", "DEVA", "AR", "JP", "SC", "TC", "KR"],
  };
  const regions = fallbackRegions[preferred];
  return regions
    .filter((region, index) => regions.indexOf(region) === index)
    .map((region) => byRegion.get(region))
    .filter((candidate): candidate is T => Boolean(candidate));
}

export function unsupportedReportGlyphLabel(character: string) {
  const codePoints = Array.from(character)
    .map((value) => value.codePointAt(0))
    .filter((value): value is number => value !== undefined);

  return codePoints.length
    ? codePoints.map((value) => `[U+${value.toString(16).toUpperCase().padStart(4, "0")}]`).join("")
    : "[UNSUPPORTED]";
}

function fontCharacterSet(font: PDFFont) {
  const cached = fontCharacterSets.get(font);
  if (cached) return cached;
  const characters = new Set(font.getCharacterSet());
  fontCharacterSets.set(font, characters);
  return characters;
}

function reportGraphemes(value: string) {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
      (entry) => entry.segment);
  }
  return Array.from(value);
}

function formatMoney(valueMinor?: number | null) {
  if (valueMinor === null || valueMinor === undefined) return "Unknown";
  return `GBP ${(valueMinor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? safeText(value)
    : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/London" }).format(date);
}

function safeText(value: string) {
  return safeReportText(value, "Unavailable");
}

export function safeReportText(value: string, fallback: string) {
  const text = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCatalogueItem(value: CatalogueItem | undefined): value is CatalogueItem {
  return Boolean(value);
}
