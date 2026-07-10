import "dotenv/config";
import { positiveInteger } from "./catalogue-batch-options.mjs";
import { startJobServer, stopServer, waitForServer } from "./job-server-runner.mjs";

const port = positiveInteger(process.env.JOB_SERVER_PORT, 3016);
const languages = languageList(process.env.TCGDEX_BACKFILL_LANGUAGES ?? "ja,zh-tw,zh-cn,ko");
const pageSize = positiveInteger(process.env.TCGDEX_BACKFILL_PAGE_SIZE, 250);
const chunkPages = positiveInteger(process.env.TCGDEX_BACKFILL_CHUNK_PAGES, 2);
const startPage = positiveInteger(process.env.TCGDEX_BACKFILL_START_PAGE, 1);
const secret = process.env.JOB_SECRET?.trim();

if (!secret) {
  throw new Error("JOB_SECRET must be set before running an international catalogue backfill.");
}

if (!languages.length) {
  throw new Error("TCGDEX_BACKFILL_LANGUAGES did not include any language codes.");
}

const { baseUrl, output, server } = startJobServer({ port });

try {
  await waitForServer({ server, url: baseUrl, output });

  for (const language of languages) {
    await backfillLanguage(language);
  }
} finally {
  await stopServer(server);
}

async function backfillLanguage(language) {
  let page = startPage;
  let imported = 0;
  let totalCount = Number.POSITIVE_INFINITY;

  while ((page - 1) * pageSize < totalCount) {
    const result = await runBatch({ language, page });
    const fetched = Number(result.cardsFetched ?? 0);
    const upserted = Number(result.cardsUpserted ?? 0);

    imported += upserted;
    totalCount = Number(result.totalCount ?? totalCount);

    console.log(JSON.stringify({
      cardsFetched: fetched,
      cardsUpserted: upserted,
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
  }

  console.log(JSON.stringify({ complete: true, imported, language, totalCount }));
}

async function runBatch({ language, page }) {
  const response = await fetch(`${baseUrl}/api/jobs/international-catalogue-refresh`, {
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
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error ?? `International catalogue batch failed with ${response.status}.`);
  }

  return result;
}

function languageList(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
