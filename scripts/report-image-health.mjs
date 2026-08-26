import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

const reviewedImageHosts = new Set([
  "assets.tcgdex.net",
  "images.pokemontcg.io",
  "images.scrydex.com",
  "tcgplayer-cdn.tcgplayer.com",
]);

export function buildImageHealthReport({ counts, generatedAt = new Date(), probes }) {
  const kinds = ["card", "sealed"].map((kind) => {
    const count = counts.find((row) => String(row.kind) === kind) ?? {};
    const rows = probes.filter((row) => row.kind === kind);
    const total = numberValue(count.total);
    const urlPresent = numberValue(count.urlPresent);
    const reachable = rows.filter((row) => row.reachable).length;
    const verifiedImage = rows.filter((row) => row.reachable && row.imageResponse).length;

    return {
      failedSample: rows
        .filter((row) => !row.reachable || !row.imageResponse)
        .slice(0, 10)
        .map(({ id, imageResponse, reason, status, url }) => ({ id, imageResponse, reason, status, url })),
      kind,
      sampled: rows.length,
      total,
      urlMissing: Math.max(0, total - urlPresent),
      urlPresent,
      urlPresentPercent: percent(urlPresent, total),
      verifiedImage,
      verifiedImageSamplePercent: percent(verifiedImage, rows.length),
      verifiedReachable: reachable,
      verifiedReachableSamplePercent: percent(reachable, rows.length),
    };
  });
  const sampled = kinds.reduce((total, row) => total + row.sampled, 0);
  const failed = kinds.reduce((total, row) => total + row.sampled - row.verifiedImage, 0);

  return {
    generatedAt: generatedAt.toISOString(),
    kinds,
    ok: sampled > 0 && failed === 0,
    verification: {
      explanation: "Reachability is a bounded sample and must not be read as full-catalogue verification.",
      failed,
      sampled,
      scope: "sample",
    },
  };
}

export async function probeImageUrl({ fetchImpl = fetch, id, kind, timeoutMs = 5_000, url }) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    return { id, imageResponse: false, kind, reachable: false, reason: "invalid_url", status: null, url };
  }

  if (parsed.protocol !== "https:") {
    return { id, imageResponse: false, kind, reachable: false, reason: "unsupported_protocol", status: null, url };
  }

  if (!reviewedImageHosts.has(parsed.hostname.toLowerCase())) {
    return { id, imageResponse: false, kind, reachable: false, reason: "unapproved_host", status: null, url };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(parsed, {
      headers: { accept: "image/avif,image/webp,image/*,*/*;q=0.8", range: "bytes=0-0" },
      redirect: "manual",
      signal: controller.signal,
    });
    const contentType = response.headers?.get?.("content-type")?.toLowerCase() ?? "";
    const redirect = Number(response.status) >= 300 && Number(response.status) < 400;
    const reachable = Boolean(response.ok) && !redirect;
    const imageResponse = reachable && contentType.startsWith("image/");

    await response.body?.cancel?.().catch?.(() => undefined);

    return {
      contentType: contentType || null,
      id,
      imageResponse,
      kind,
      reachable,
      reason: redirect
        ? "redirect_not_allowed"
        : reachable
          ? (imageResponse ? null : "non_image_content_type")
          : "http_error",
      status: Number(response.status) || null,
      url,
    };
  } catch (error) {
    return {
      id,
      imageResponse: false,
      kind,
      reachable: false,
      reason: error?.name === "AbortError" ? "timeout" : "network_error",
      status: null,
      url,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runImageHealthReport({
  concurrency = boundedPositiveInteger(process.env.IMAGE_HEALTH_CONCURRENCY, 5, 10),
  fetchImpl = fetch,
  now = new Date(),
  prisma = new PrismaClient(),
  sampleLimit = boundedPositiveInteger(process.env.IMAGE_HEALTH_SAMPLE_LIMIT, 20, 100),
  timeoutMs = boundedPositiveInteger(process.env.IMAGE_HEALTH_TIMEOUT_MS, 5_000, 15_000),
} = {}) {
  let counts;
  let candidates;

  try {
    [counts, candidates] = await Promise.all([
      prisma.$queryRaw`
        SELECT 'card' AS kind, COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE NULLIF(BTRIM(COALESCE(image_large_url, image_small_url, '')), '') IS NOT NULL
          )::int AS "urlPresent"
        FROM card_printings
        UNION ALL
        SELECT 'sealed', COUNT(*)::int,
          COUNT(*) FILTER (
            WHERE NULLIF(BTRIM(COALESCE(image_url, '')), '') IS NOT NULL
          )::int
        FROM sealed_products
        WHERE visibility = 'global'::catalogue_visibility
      `,
      Promise.all([
        prisma.$queryRaw`
          SELECT id::text, 'card' AS kind,
            COALESCE(NULLIF(BTRIM(image_large_url), ''), NULLIF(BTRIM(image_small_url), '')) AS url
          FROM card_printings
          WHERE COALESCE(NULLIF(BTRIM(image_large_url), ''), NULLIF(BTRIM(image_small_url), '')) IS NOT NULL
          ORDER BY updated_at ASC, id
          LIMIT ${sampleLimit}
        `,
        prisma.$queryRaw`
          SELECT id::text, 'sealed' AS kind, BTRIM(image_url) AS url
          FROM sealed_products
          WHERE visibility = 'global'::catalogue_visibility
            AND NULLIF(BTRIM(COALESCE(image_url, '')), '') IS NOT NULL
          ORDER BY updated_at ASC, id
          LIMIT ${sampleLimit}
        `,
      ]).then((groups) => groups.flat()),
    ]);
  } finally {
    await prisma.$disconnect();
  }

  const probes = await mapConcurrent(candidates, concurrency, (candidate) =>
    probeImageUrl({ ...candidate, fetchImpl, timeoutMs }));

  return buildImageHealthReport({ counts, generatedAt: now, probes });
}

async function mapConcurrent(items, concurrency, mapper) {
  const output = new Array(items.length);
  let next = 0;

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await mapper(items[index]);
    }
  }));

  return output;
}

function boundedPositiveInteger(value, fallback, max) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.min(max, Math.floor(number)) : fallback;
}

function numberValue(value) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function percent(value, total) {
  return total > 0 ? Math.round((value / total) * 1_000) / 10 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runImageHealthReport();

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
