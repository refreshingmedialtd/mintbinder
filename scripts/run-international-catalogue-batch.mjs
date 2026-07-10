import "dotenv/config";
import { positiveInteger } from "./catalogue-batch-options.mjs";
import { startJobServer, stopServer, waitForServer } from "./job-server-runner.mjs";

const port = positiveInteger(process.env.JOB_SERVER_PORT, 3016);
const language = process.env.TCGDEX_IMPORT_LANGUAGE?.trim() || "ja";
const page = positiveInteger(process.env.TCGDEX_IMPORT_PAGE, 1);
const pageSize = positiveInteger(process.env.TCGDEX_IMPORT_PAGE_SIZE, 50);
const maxPages = positiveInteger(process.env.TCGDEX_IMPORT_MAX_PAGES, 1);
const secret = process.env.JOB_SECRET?.trim();

if (!secret) {
  throw new Error("JOB_SECRET must be set before running an international catalogue batch.");
}

const { baseUrl, output, server } = startJobServer({ port });

try {
  await waitForServer({ server, url: baseUrl, output });

  const response = await fetch(`${baseUrl}/api/jobs/international-catalogue-refresh`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      language,
      maxPages,
      page,
      pageSize,
    }),
  });
  const result = await response.json();

  console.log(JSON.stringify(result, null, 2));

  if (!response.ok) {
    throw new Error(result.error ?? `International catalogue batch failed with ${response.status}.`);
  }
} finally {
  await stopServer(server);
}
