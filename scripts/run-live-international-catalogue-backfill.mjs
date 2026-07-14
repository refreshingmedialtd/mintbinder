import "dotenv/config";

const defaultLanguages = "zh-cn,ko";
const baseUrl = appBaseUrl(process.env);
const languages = languageList(process.env.TCGDEX_BACKFILL_LANGUAGES ?? defaultLanguages);
const pageSize = positiveInteger(process.env.TCGDEX_BACKFILL_PAGE_SIZE, 250);
const chunkPages = positiveInteger(process.env.TCGDEX_BACKFILL_CHUNK_PAGES, 2);
const startPage = positiveInteger(process.env.TCGDEX_BACKFILL_START_PAGE, 1);
const waitMs = nonNegativeInteger(process.env.TCGDEX_BACKFILL_WAIT_MS, 250);
const secret = required(process.env.JOB_SECRET, "JOB_SECRET must be set before running a live international catalogue backfill.");

if (!languages.length) {
  throw new Error("TCGDEX_BACKFILL_LANGUAGES did not include any language codes.");
}

const summary = [];

for (const language of languages) {
  summary.push(await backfillLanguage(language));
}

console.log(JSON.stringify({
  baseUrl,
  complete: true,
  languages: summary,
}, null, 2));

async function backfillLanguage(language) {
  let page = startPage;
  let imported = 0;
  let fetchedTotal = 0;
  let totalCount = Number.POSITIVE_INFINITY;
  const batches = [];

  while ((page - 1) * pageSize < totalCount) {
    const result = await runBatch({ language, page });
    const fetched = Number(result.cardsFetched ?? 0);
    const upserted = Number(result.cardsUpserted ?? 0);

    fetchedTotal += fetched;
    imported += upserted;
    totalCount = Number(result.totalCount ?? totalCount);
    batches.push({
      cardsFetched: fetched,
      cardsUpserted: upserted,
      jobRunId: result.jobRun?.id,
      page,
      setsUpserted: result.setsUpserted,
    });

    console.log(JSON.stringify({
      cardsFetched: fetched,
      cardsUpserted: upserted,
      jobRunId: result.jobRun?.id,
      language,
      page,
      pageSize,
      provider: result.provider,
      setsUpserted: result.setsUpserted,
      totalCount,
    }));

    if (fetched === 0 || fetched < pageSize * chunkPages) {
      break;
    }

    page += chunkPages;
    await wait(waitMs);
  }

  return {
    batches,
    fetched: fetchedTotal,
    imported,
    language,
    totalCount: Number.isFinite(totalCount) ? totalCount : null,
  };
}

async function runBatch({ language, page }) {
  const response = await fetch(new URL("/api/jobs/international-catalogue-refresh", baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      language,
      maxPages: chunkPages,
      page,
      pageSize,
    }),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error ?? `International catalogue batch failed with ${response.status}.`);
  }

  return result;
}

function appBaseUrl(env = process.env) {
  const raw =
    env.SCHEDULED_JOB_APP_URL ||
    env.NEXT_PUBLIC_APP_URL ||
    env.AUTH_URL ||
    "https://mintbinder.co.uk";
  const url = new URL(raw);

  url.pathname = "/";
  url.search = "";
  url.hash = "";

  return url.toString();
}

function required(value, message) {
  const trimmed = optionalString(value);

  if (!trimmed) {
    throw new Error(message);
  }

  return trimmed;
}

function optionalString(value) {
  const trimmed = String(value ?? "").trim();

  return trimmed || undefined;
}

function languageList(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function positiveInteger(value, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.floor(number);
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

async function wait(ms) {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
}
