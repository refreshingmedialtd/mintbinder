import "dotenv/config";
import { pageFromStatus, pageSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import { startJobServer, stopServer, waitForServer } from "./job-server-runner.mjs";

const port = positiveInteger(process.env.JOB_SERVER_PORT, 3016);
const requestedPage = pageSetting(process.env.POKEMON_TCG_IMPORT_PAGE, 1);
const pageSize = positiveInteger(process.env.POKEMON_TCG_IMPORT_PAGE_SIZE, 250);
const maxPages = positiveInteger(process.env.POKEMON_TCG_IMPORT_MAX_PAGES, 5);
const query = process.env.POKEMON_TCG_IMPORT_QUERY?.trim();
const secret = process.env.JOB_SECRET?.trim();

if (!secret) {
  throw new Error("JOB_SECRET must be set before running a catalogue batch.");
}

const { baseUrl, output, server } = startJobServer({ port });

try {
  await waitForServer({ server, url: baseUrl, output });

  const page = requestedPage === "auto" ? await autoPage() : requestedPage;
  const response = await fetch(`${baseUrl}/api/jobs/catalogue-refresh`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      maxPages,
      page,
      pageSize,
      q: query || undefined,
    }),
  });
  const result = await response.json();

  console.log(JSON.stringify(result, null, 2));

  if (!response.ok) {
    throw new Error(result.error ?? `Catalogue batch failed with ${response.status}.`);
  }
} finally {
  await stopServer(server);
}

async function autoPage() {
  const response = await fetch(`${baseUrl}/api/jobs/catalogue-status`, {
    headers: {
      authorization: `Bearer ${secret}`,
    },
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error ?? `Catalogue status failed with ${response.status}.`);
  }

  return pageFromStatus(result, query ?? "");
}
