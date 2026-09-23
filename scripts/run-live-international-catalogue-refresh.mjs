import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { appBaseUrl } from "./run-live-scheduled-job.mjs";

const defaultLanguages = "ja,zh-tw,zh-cn,ko";

export async function runLiveInternationalCatalogueRefresh({
  env = process.env,
  fetchImpl = fetch,
  prisma = new PrismaClient(),
} = {}) {
  const languages = languageList(env.TCGDEX_SCHEDULE_LANGUAGES ?? defaultLanguages);
  const pageSize = boundedPositiveInteger(env.TCGDEX_SCHEDULE_PAGE_SIZE, 100, 250);
  const maxPages = boundedPositiveInteger(env.TCGDEX_SCHEDULE_MAX_PAGES, 1, 2);
  const secret = required(
    env.JOB_SECRET,
    "JOB_SECRET must be set before running the international catalogue schedule.",
  );

  if (!languages.length) {
    throw new Error("TCGDEX_SCHEDULE_LANGUAGES did not include any language codes.");
  }

  let history;
  let incompleteSets;

  try {
    history = await prisma.$queryRaw`
      SELECT DISTINCT ON (request_payload->>'language')
        request_payload->>'language' AS language,
        NULLIF(request_payload->>'page', '')::int AS page,
        NULLIF(request_payload->>'pageSize', '')::int AS "pageSize",
        NULLIF(request_payload->>'maxPages', '')::int AS "maxPages",
        NULLIF(result_payload->>'cardsFetched', '')::int AS "cardsFetched",
        NULLIF(result_payload->>'totalCount', '')::int AS "totalCount",
        started_at AS "startedAt"
      FROM job_runs
      WHERE job_type = 'catalogue_refresh'::job_run_type
        AND status = 'succeeded'::job_run_status
        AND request_payload->>'provider' = 'tcgdex'
        AND request_payload->>'scheduled' = 'true'
        AND request_payload->>'setId' IS NULL
        AND request_payload->>'language' IS NOT NULL
      ORDER BY request_payload->>'language', started_at DESC
    `;
    incompleteSets = await prisma.$queryRaw`
      SELECT
        cs.language,
        cs.name,
        cs.provider_ids->>'tcgdex' AS "setId",
        COUNT(cp.id)::int AS imported,
        cs.total::int AS total,
        (cs.total - COUNT(cp.id))::int AS missing
      FROM card_sets cs
      LEFT JOIN card_printings cp ON cp.card_set_id = cs.id
      WHERE cs.provider_ids->>'tcgdex' IS NOT NULL
        AND cs.language <> 'en'
        AND cs.total IS NOT NULL
      GROUP BY cs.id
      HAVING COUNT(cp.id) < cs.total
      ORDER BY missing DESC, cs.release_date DESC NULLS LAST, cs.name
    `;
  } finally {
    await prisma.$disconnect();
  }

  const batch = selectInternationalCatalogueBatch({
    history,
    incompleteSets,
    languages,
    maxPages,
    pageSize,
  });
  const baseUrl = appBaseUrl(env);
  const response = await fetchImpl(new URL("/api/jobs/international-catalogue-refresh", baseUrl), {
    body: JSON.stringify({ ...batch, scheduled: true }),
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error ?? `International catalogue schedule failed with ${response.status}.`);
  }

  return {
    batch,
    response: result,
  };
}

export function selectInternationalCatalogueBatch({
  history = [],
  incompleteSets = [],
  languages,
  maxPages,
  pageSize,
}) {
  const incomplete = incompleteSets.find((set) =>
    languages.includes(String(set.language)) && String(set.setId ?? "").trim(),
  );

  if (incomplete) {
    return {
      language: String(incomplete.language),
      setId: String(incomplete.setId),
    };
  }

  const latestByLanguage = new Map(
    history
      .filter((row) => languages.includes(String(row.language)))
      .map((row) => [String(row.language), row]),
  );
  const language = [...languages].sort((left, right) => {
    const leftAt = validTime(latestByLanguage.get(left)?.startedAt);
    const rightAt = validTime(latestByLanguage.get(right)?.startedAt);

    return leftAt - rightAt || languages.indexOf(left) - languages.indexOf(right);
  })[0];
  const latest = latestByLanguage.get(language);
  const latestPage = positiveInteger(latest?.page) ?? 1;
  const latestPageSize = positiveInteger(latest?.pageSize);
  const latestMaxPages = positiveInteger(latest?.maxPages) ?? 1;
  const cardsFetched = nonNegativeInteger(latest?.cardsFetched) ?? 0;
  const totalCount = positiveInteger(latest?.totalCount);
  const consumed = (latestPage - 1) * (latestPageSize ?? pageSize) + cardsFetched;
  const shouldReset = !latest || latestPageSize !== pageSize || cardsFetched === 0 ||
    (totalCount !== undefined && consumed >= totalCount);

  return {
    language,
    maxPages,
    page: shouldReset ? 1 : latestPage + latestMaxPages,
    pageSize,
  };
}

function languageList(value) {
  return [...new Set(String(value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replaceAll("_", "-"))
    .filter(Boolean))];
}

function required(value, message) {
  const text = String(value ?? "").trim();

  if (!text) throw new Error(message);
  return text;
}

function boundedPositiveInteger(value, fallback, max) {
  return Math.min(positiveInteger(value) ?? fallback, max);
}

function positiveInteger(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
}

function nonNegativeInteger(value) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined;
}

function validTime(value) {
  const milliseconds = value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY;

  return Number.isFinite(milliseconds) ? milliseconds : Number.NEGATIVE_INFINITY;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLiveInternationalCatalogueRefresh()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
