import "dotenv/config";
import { execFileSync, spawn } from "node:child_process";
import { pageFromStatus, pageSetting, positiveInteger } from "./catalogue-batch-options.mjs";

const port = positiveInteger(process.env.JOB_SERVER_PORT, 3016);
const requestedPage = pageSetting(process.env.POKEMON_TCG_IMPORT_PAGE, 1);
const pageSize = positiveInteger(process.env.POKEMON_TCG_IMPORT_PAGE_SIZE, 250);
const maxPages = positiveInteger(process.env.POKEMON_TCG_IMPORT_MAX_PAGES, 5);
const query = process.env.POKEMON_TCG_IMPORT_QUERY?.trim();
const secret = process.env.JOB_SECRET?.trim();

if (!secret) {
  throw new Error("JOB_SECRET must be set before running a catalogue batch.");
}

const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(serverCommand(), serverArgs(), {
  cwd: process.cwd(),
  env: cleanChildEnv({
    AUTH_TRUST_HOST: "true",
    AUTH_URL: baseUrl,
  }),
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let serverOutput = "";

server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  await waitForServer(baseUrl);

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
  stopServer();
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

async function waitForServer(url) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Server exited before it was ready.\n${serverOutput}`);
    }

    try {
      const response = await fetch(url);

      if (response.status < 500) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Timed out waiting for ${url}.\n${serverOutput}`);
}

function stopServer() {
  if (!server.pid) {
    return;
  }

  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
      return;
    } catch {
      // Fall through to the portable kill as a last attempt.
    }
  }

  server.kill();
}

function cleanChildEnv(overrides) {
  const env = {};
  const seen = new Set();

  for (const [key, value] of Object.entries(process.env)) {
    const normalized = process.platform === "win32" ? key.toLowerCase() : key;

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    env[key] = value;
  }

  return {
    ...env,
    ...overrides,
  };
}

function npmExecutable() {
  if (process.platform !== "win32") {
    return "npm";
  }

  return "C:\\Progra~1\\nodejs\\npm.cmd";
}

function serverCommand() {
  return process.platform === "win32" ? "cmd.exe" : npmExecutable();
}

function serverArgs() {
  if (process.platform !== "win32") {
    return ["run", "start", "--", "--port", String(port)];
  }

  return ["/d", "/c", `${npmExecutable()} run start -- --port ${port}`];
}
