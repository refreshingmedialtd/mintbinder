import "dotenv/config";
import { setTimeout as wait } from "node:timers/promises";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import { startJobServer, stopServer, waitForServer } from "./job-server-runner.mjs";

const secret = process.env.JOB_SECRET?.trim();

if (!secret) {
  throw new Error("JOB_SECRET must be set before running the production catalogue bootstrap.");
}

const port = positiveInteger(process.env.JOB_SERVER_PORT, 3021);
const pageSize = positiveInteger(process.env.BOOTSTRAP_PAGE_SIZE, 50);
const maxPagesPerJob = Math.min(20, positiveInteger(process.env.BOOTSTRAP_MAX_PAGES_PER_JOB, 10));
const maxJobs = positiveInteger(process.env.BOOTSTRAP_MAX_JOBS, 50);
const retryLimit = positiveInteger(process.env.BOOTSTRAP_RETRY_LIMIT, 2);
const waitMs = positiveInteger(process.env.BOOTSTRAP_WAIT_MS, 1000);
const query = process.env.BOOTSTRAP_QUERY?.trim() ?? "";
const skipCatalogue = booleanSetting(process.env.BOOTSTRAP_SKIP_CATALOGUE, false);
const skipPricing = booleanSetting(process.env.BOOTSTRAP_SKIP_PRICING, false);
const catalogueStartPage = positiveInteger(process.env.BOOTSTRAP_CATALOGUE_START_PAGE, 1);
const pricingStartPage = positiveInteger(process.env.BOOTSTRAP_PRICING_START_PAGE, 1);
const priceOnlyUnpriced = booleanSetting(process.env.BOOTSTRAP_PRICE_ONLY_UNPRICED, true);

const { baseUrl, output, server } = startJobServer({ port });

try {
  await waitForServer({ server, url: baseUrl, output });

  const summary = {
    baseUrl,
    pageSize,
    maxPagesPerJob,
    query,
    catalogue: skipCatalogue
      ? { skipped: true }
      : await runPagedJob({
        body: { q: query || undefined },
        label: "catalogue",
        path: "/api/jobs/catalogue-refresh",
        startPage: catalogueStartPage,
      }),
    pricing: skipPricing
      ? { skipped: true }
      : await runPagedJob({
        body: {
          priceOnlyUnpriced,
          q: query || undefined,
        },
        label: "pricing",
        path: "/api/jobs/pricing-refresh",
        startPage: pricingStartPage,
      }),
  };

  console.log(JSON.stringify(summary, null, 2));
} finally {
  await stopServer(server);
}

async function runPagedJob({
  body,
  label,
  path,
  startPage,
}) {
  let complete = false;
  let failedAttempts = 0;
  let page = startPage;
  const jobs = [];
  const totals = {
    cardsFetched: 0,
    cardsUpserted: 0,
    pagesProcessed: 0,
    pricingSnapshotsCreated: 0,
    setsUpserted: 0,
  };

  while (!complete && jobs.length < maxJobs) {
    console.error(`[${label}] starting job ${jobs.length + 1}/${maxJobs} at page ${page}`);

    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        maxPages: maxPagesPerJob,
        page,
        pageSize,
      }),
    });
    const result = await response.json().catch(() => ({}));
    const payload = resultPayload(result);
    const nextPage = positivePage(payload.nextPage);
    const pagesProcessed = Number(payload.pagesProcessed ?? 0);
    const jobSummary = {
      cardsFetched: Number(payload.cardsFetched ?? 0),
      cardsUpserted: Number(payload.cardsUpserted ?? 0),
      complete: Boolean(payload.complete),
      error: response.ok ? undefined : result.error ?? `Job failed with ${response.status}.`,
      jobRunId: result.jobRun?.id,
      nextPage,
      page,
      pagesProcessed,
      pricingSnapshotsCreated: Number(payload.pricingSnapshotsCreated ?? 0),
      status: response.ok ? "succeeded" : "failed",
      totalCount: Number(payload.totalCount ?? 0),
    };

    if (!response.ok && pagesProcessed === 0) {
      if (failedAttempts < retryLimit) {
        failedAttempts += 1;
        console.error(`[${label}] retry ${failedAttempts}/${retryLimit} after ${jobSummary.error}`);
        await wait(waitMs * failedAttempts);
        continue;
      }

      throw new Error(`${label} failed at page ${page}: ${jobSummary.error}`);
    }

    failedAttempts = 0;
    jobs.push(jobSummary);
    totals.cardsFetched += jobSummary.cardsFetched;
    totals.cardsUpserted += jobSummary.cardsUpserted;
    totals.pagesProcessed += pagesProcessed;
    totals.pricingSnapshotsCreated += jobSummary.pricingSnapshotsCreated;
    totals.setsUpserted += Number(payload.setsUpserted ?? 0);

    complete = jobSummary.complete;

    if (!complete) {
      if (!nextPage) {
        throw new Error(`${label} did not finish and did not return a next page.`);
      }

      page = nextPage;
    }

    if (!response.ok) {
      console.error(`[${label}] partial job failed after ${pagesProcessed} pages; resuming at page ${page}`);
    }

    if (!complete && waitMs > 0) {
      await wait(waitMs);
    }
  }

  return {
    complete,
    jobs,
    nextPage: complete ? null : page,
    totals,
  };
}

function resultPayload(result) {
  return result?.jobRun?.resultPayload && typeof result.jobRun.resultPayload === "object"
    ? result.jobRun.resultPayload
    : result;
}

function positivePage(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}
