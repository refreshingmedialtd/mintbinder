import { execFile, spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function startJobServer({ port }) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawnServer(port);
  let output = "";

  server.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  server.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  return {
    baseUrl,
    server,
    output() {
      return output;
    },
  };
}

export async function waitForServer({ server, url, output }) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Server exited before it was ready.\n${output()}`);
    }

    try {
      const response = await fetch(url);

      if (response.status < 500) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await wait(1000);
  }

  throw new Error(`Timed out waiting for ${url}.\n${output()}`);
}

export async function stopServer(server) {
  if (!server.pid || server.exitCode !== null) {
    cleanupServerHandles(server);
    return;
  }

  const closed = new Promise((resolve) => {
    server.once("close", resolve);
  });

  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/pid", String(server.pid), "/t", "/f"], {
        timeout: 5000,
        windowsHide: true,
      });
    } catch {
      server.kill();
    }
  } else {
    server.kill();
  }

  await Promise.race([closed, wait(5000)]);
  cleanupServerHandles(server);
}

export function cleanChildEnv(overrides) {
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

function spawnServer(port) {
  return spawn(serverCommand(), serverArgs(port), {
    cwd: process.cwd(),
    env: cleanChildEnv({
      AUTH_TRUST_HOST: "true",
      AUTH_URL: `http://127.0.0.1:${port}`,
    }),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function cleanupServerHandles(server) {
  server.stdout?.destroy();
  server.stderr?.destroy();
  server.unref();
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

function serverArgs(port) {
  if (process.platform !== "win32") {
    return ["run", "start", "--", "--port", String(port)];
  }

  return ["/d", "/c", `${npmExecutable()} run start -- --port ${port}`];
}
