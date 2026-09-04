import { NextResponse } from "next/server";
import { CatalogueVisibility, Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { canonicalVariantLabelForItemType } from "@/lib/catalogue/variants";
import {
  isValidPriceHistorySource,
  priceHistoryTruncation,
  serializePriceHistoryRows,
  type PriceHistoryRow,
} from "@/lib/pricing/price-history-response";
import {
  customerVisiblePriceSource,
  priceChartingLicenceConfirmed,
} from "@/lib/pricing/provider-permissions.mjs";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const url = new URL(request.url);
    const catalogueId = url.searchParams.get("catalogueId")?.trim() ?? "";
    const range = normalizeRange(url.searchParams.get("range"));
    const sourceValue = url.searchParams.get("source");

    if (!isValidPriceHistorySource(sourceValue)) {
      return NextResponse.json({ error: "Price source filter is invalid." }, { status: 400 });
    }

    const source = sourceValue?.trim() || null;

    if (source && !customerVisiblePriceSource(source)) {
      return NextResponse.json({ error: "Price source is not available." }, { status: 400 });
    }

    if (!UUID_PATTERN.test(catalogueId)) {
      return NextResponse.json({ error: "A valid catalogueId is required." }, { status: 400 });
    }

    const itemType = await visibleItemType(session.user.id, catalogueId);

    if (!itemType) {
      return NextResponse.json({ error: "Catalogue item not found." }, { status: 404 });
    }

    const { bucket, from } = rangeConfig(range);
    const sourceFilter = source ? Prisma.sql`AND "source" = ${source}` : Prisma.empty;
    const providerPermissionFilter = priceChartingLicenceConfirmed()
      ? Prisma.empty
      : Prisma.sql`AND "source" NOT IN ('pricecharting-graded-card', 'pricecharting-sealed')`;
    const fromFilter = from ? Prisma.sql`AND "observed_at" >= ${from}` : Prisma.empty;
    const itemFilter = itemType === "card"
      ? Prisma.sql`"card_printing_id" = ${catalogueId}::uuid`
      : Prisma.sql`"sealed_product_id" = ${catalogueId}::uuid`;
    const variantLabelExpression = itemType === "sealed"
      ? Prisma.sql`
          CASE
            WHEN regexp_replace(LOWER(COALESCE("variant_label", '')), '[^a-z0-9]+', '', 'g')
              IN ('normal', 'standard', 'sealed', 'factorysealed', 'newsealed', 'unopenedsealed')
              THEN 'Factory sealed'
            ELSE "variant_label"
          END
        `
      : Prisma.sql`"variant_label"`;

    const rows = await prisma.$queryRaw<Array<PriceHistoryRow & { availablePointCount: number }>>(Prisma.sql`
      WITH "bucketed_history" AS (
        SELECT
          date_trunc(${bucket}, "observed_at") AS "bucket",
          "source",
          "currency",
          "condition",
          "language",
          ${variantLabelExpression} AS "variantLabel",
          "graded_company" AS "gradedCompany",
          "graded_score" AS "gradedScore",
          "price_minor" AS "priceMinor",
          "confidence_score" AS "confidenceScore",
          "sample_size" AS "sampleSize",
          "observed_at" AS "observedAt"
        FROM "price_snapshots"
        WHERE ${itemFilter}
          ${fromFilter}
          ${sourceFilter}
          ${providerPermissionFilter}
      ),
      "grouped_history" AS (
        SELECT
          "bucket",
          "source",
          "currency",
          "condition",
          "language",
          "variantLabel",
          "gradedCompany",
          "gradedScore",
          ROUND(AVG("priceMinor"))::int AS "priceMinor",
          ROUND(AVG("confidenceScore"))::int AS "confidenceScore",
          CASE WHEN COUNT("sampleSize") = 0 THEN NULL ELSE SUM("sampleSize")::int END AS "sampleSize",
          COUNT(*)::int AS "pointCount",
          MAX("observedAt") AS "observedAt"
        FROM "bucketed_history"
        GROUP BY
          "bucket",
          "source",
          "currency",
          "condition",
          "language",
          "variantLabel",
          "gradedCompany",
          "gradedScore"
      ),
      "newest_history" AS (
        SELECT
          "grouped_history".*,
          COUNT(*) OVER()::int AS "availablePointCount"
        FROM "grouped_history"
        ORDER BY
          "bucket" DESC,
          "source" ASC,
          "variantLabel" ASC,
          "gradedCompany" ASC NULLS FIRST,
          "gradedScore" ASC NULLS FIRST
        LIMIT 5000
      )
      SELECT *
      FROM "newest_history"
      ORDER BY
        "bucket" ASC,
        "source" ASC,
        "variantLabel" ASC,
        "gradedCompany" ASC NULLS FIRST,
        "gradedScore" ASC NULLS FIRST
    `);

    const availablePointCount = Number(rows[0]?.availablePointCount ?? 0);

    return NextResponse.json({
      catalogueId,
      itemType,
      range,
      bucket,
      source: source ?? "all",
      ...priceHistoryTruncation(availablePointCount, rows.length),
      points: serializePriceHistoryRows(rows).map((point) => ({
        ...point,
        variantLabel: canonicalVariantLabelForItemType(itemType, point.variantLabel) ?? null,
      })),
    });
  } catch (error) {
    console.error("Unable to load price history.", error);
    return NextResponse.json({ error: "Unable to load price history." }, { status: 500 });
  }
}

async function visibleItemType(userId: string, catalogueId: string) {
  const card = await prisma.cardPrinting.findUnique({ where: { id: catalogueId }, select: { id: true } });
  if (card) return "card" as const;

  const sealed = await prisma.sealedProduct.findFirst({
    where: {
      id: catalogueId,
      OR: [
        { visibility: CatalogueVisibility.GLOBAL },
        { createdByUserId: userId },
      ],
    },
    select: { id: true },
  });

  return sealed ? "sealed" as const : null;
}

function normalizeRange(value: string | null) {
  return value === "7d" || value === "30d" || value === "90d" || value === "1y" || value === "all"
    ? value
    : "90d";
}

function rangeConfig(range: ReturnType<typeof normalizeRange>) {
  const now = Date.now();

  if (range === "7d") return { bucket: "day", from: new Date(now - 7 * 86_400_000) };
  if (range === "30d") return { bucket: "day", from: new Date(now - 30 * 86_400_000) };
  if (range === "90d") return { bucket: "day", from: new Date(now - 90 * 86_400_000) };
  if (range === "1y") return { bucket: "week", from: new Date(now - 365 * 86_400_000) };
  return { bucket: "month", from: null };
}
