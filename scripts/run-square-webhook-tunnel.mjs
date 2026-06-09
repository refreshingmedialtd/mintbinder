import "dotenv/config";
import { createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEBHOOK_EVENTS = ["subscription.created", "subscription.updated", "invoice.payment_made"];
const DEFAULT_WEBHOOK_NAME = "Mint Binder Local Billing Webhook";
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";
const SQUARE_VERSION = process.env.SQUARE_VERSION?.trim() || "2026-05-20";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const args = new Set(process.argv.slice(2));
const runOnce = args.has("--once");
const runTunnelSelfCheck = process.env.SQUARE_TUNNEL_SELF_CHECK?.trim().toLowerCase() === "true";
const port = positiveInteger(process.env.SQUARE_TUNNEL_PORT, DEFAULT_PORT);
const tunnelSettleMs = positiveInteger(process.env.SQUARE_TUNNEL_SETTLE_MS, 5_000);
const host = process.env.SQUARE_TUNNEL_HOST?.trim() || DEFAULT_HOST;
const localBaseUrl = `http://${host}:${port}`;
const webhookName = process.env.SQUARE_WEBHOOK_SUBSCRIPTION_NAME?.trim() || DEFAULT_WEBHOOK_NAME;
const envPath = path.join(repoRoot, ".env");
const localTunnelDir = path.join(repoRoot, ".local-tunnel");
const cloudflaredPidFile = path.join(localTunnelDir, "cloudflared.pid");
const children = [];

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Square tunnel setup failed.";

  console.error(message);
  await shutdown();
  process.exitCode = 1;
}

async function main() {
  await assertBuiltApp();

  status("Starting Cloudflare quick tunnel...");
  const tunnel = await startCloudflareTunnel(localBaseUrl);
  const notificationUrl = `${tunnel.url}/api/billing/webhook`;
  status(`Cloudflare tunnel ready: ${tunnel.url}`);

  status("Starting local app for Square URL validation...");
  let app = await startNextServer();

  await waitForLocalApp(localBaseUrl);
  await waitForTunnelSettle();
  await maybeSoftCheckTunnel(notificationUrl);

  status("Creating or updating Square webhook subscription...");
  const subscription = await createOrUpdateWebhookSubscription(notificationUrl);
  const signatureKey = requiredWebhookSignatureKey(subscription);

  await updateLocalEnv({
    SQUARE_WEBHOOK_NOTIFICATION_URL: notificationUrl,
    SQUARE_WEBHOOK_SIGNATURE_KEY: signatureKey,
    SQUARE_WEBHOOK_SUBSCRIPTION_ID: subscription.id,
  });

  status("Restarting local app with the Square webhook signature key...");
  await stopChild(app);
  app = await startNextServer({
    SQUARE_WEBHOOK_NOTIFICATION_URL: notificationUrl,
    SQUARE_WEBHOOK_SIGNATURE_KEY: signatureKey,
  });

  await waitForLocalApp(localBaseUrl);
  await waitForTunnelSettle();
  await maybeSoftCheckTunnel(notificationUrl);

  const localWebhookSelfCheck = await sendLocalWebhookSelfCheck({
    notificationUrl,
    signatureKey,
  });

  if (localWebhookSelfCheck.statusCode < 200 || localWebhookSelfCheck.statusCode >= 300) {
    throw new Error(`Local signed webhook self-check failed with HTTP ${localWebhookSelfCheck.statusCode}.`);
  }

  status("Sending Square test webhook...");
  const testResult = await sendSquareTestWebhook(subscription.id, "subscription.updated");
  const testWebhook = squareTestWebhookSummary(testResult);

  console.log(JSON.stringify({
    app: {
      localUrl: localBaseUrl,
    },
    square: {
      eventTypes: WEBHOOK_EVENTS,
      localWebhookSelfCheck,
      testWebhook,
      webhookSubscriptionId: subscription.id,
    },
    tunnel: {
      notificationUrl,
      url: tunnel.url,
    },
  }, null, 2));

  if (!testWebhook.success) {
    throw new Error(`Square test webhook failed with HTTP ${testWebhook.statusCode ?? "unknown"}.`);
  }

  if (runOnce) {
    await shutdown();
  } else {
    status("\nKeep this command running while you test Square checkout. Press Ctrl+C to stop the tunnel.");
    await waitForStopSignal();
    await shutdown();
  }
}

async function startCloudflareTunnel(targetUrl) {
  await mkdir(localTunnelDir, { recursive: true });
  await rm(cloudflaredPidFile, { force: true });

  const npm = npmInvocation();
  const child = spawn(
    npm.command,
    [
      ...npm.args,
      "exec",
      "--yes",
      "cloudflared",
      "--",
      "tunnel",
      "--pidfile",
      cloudflaredPidFile,
      "--url",
      targetUrl,
    ],
    {
      cwd: repoRoot,
      env: sanitizedEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  children.push({ child, name: "cloudflared tunnel" });

  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for Cloudflare to create a tunnel URL."));
    }, 60_000);

    const onData = (data) => {
      const text = data.toString();
      output += text;
      const tunnelUrl = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0] ??
        output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0];

      if (tunnelUrl) {
        clearTimeout(timeout);
        resolve({ process: child, url: tunnelUrl.replace(/\/$/, "") });
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);

      if (!output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)) {
        reject(new Error(`Cloudflare tunnel exited before returning a URL. Exit code: ${code ?? "unknown"}.`));
      }
    });
  });
}

async function createOrUpdateWebhookSubscription(notificationUrl) {
  await assertWebhookEventTypes(WEBHOOK_EVENTS);

  const existing = await findExistingWebhookSubscription();
  const body = {
    subscription: {
      api_version: SQUARE_VERSION,
      enabled: true,
      event_types: WEBHOOK_EVENTS,
      name: webhookName,
      notification_url: notificationUrl,
    },
  };
  const response = existing
    ? await squareRequest(`/v2/webhooks/subscriptions/${existing.id}`, {
      body,
      method: "PUT",
    })
    : await squareRequest("/v2/webhooks/subscriptions", {
      body: {
        idempotency_key: randomUUID(),
        ...body,
      },
      method: "POST",
    });

  const subscription = response.subscription;

  if (!subscription?.id) {
    throw new Error("Square did not return a webhook subscription ID.");
  }

  if (!subscription.signature_key) {
    return retrieveWebhookSubscription(subscription.id);
  }

  return subscription;
}

async function assertWebhookEventTypes(eventTypes) {
  const response = await squareRequest(
    `/v2/webhooks/event-types?api_version=${encodeURIComponent(SQUARE_VERSION)}`,
    { method: "GET" },
  );
  const availableTypes = new Set((response.event_types ?? []).map((eventType) => {
    if (typeof eventType === "string") {
      return eventType;
    }

    return eventType?.event_type ?? eventType?.name;
  }).filter(Boolean));
  const missingTypes = eventTypes.filter((eventType) => !availableTypes.has(eventType));

  if (missingTypes.length > 0) {
    throw new Error(`Square does not list these webhook events for API ${SQUARE_VERSION}: ${missingTypes.join(", ")}`);
  }
}

async function findExistingWebhookSubscription() {
  const configuredId = process.env.SQUARE_WEBHOOK_SUBSCRIPTION_ID?.trim();

  if (configuredId) {
    return retrieveWebhookSubscription(configuredId);
  }

  const response = await squareRequest("/v2/webhooks/subscriptions", { method: "GET" });

  return (response.subscriptions ?? []).find((subscription) => subscription.name === webhookName) ?? null;
}

async function retrieveWebhookSubscription(subscriptionId) {
  const response = await squareRequest(`/v2/webhooks/subscriptions/${subscriptionId}`, { method: "GET" });
  const subscription = response.subscription;

  if (!subscription?.id) {
    throw new Error(`Square webhook subscription ${subscriptionId} was not found.`);
  }

  return subscription;
}

async function sendSquareTestWebhook(subscriptionId, eventType) {
  return squareRequest(`/v2/webhooks/subscriptions/${subscriptionId}/test`, {
    body: {
      event_type: eventType,
    },
    method: "POST",
  });
}

async function sendLocalWebhookSelfCheck({ notificationUrl, signatureKey }) {
  const payload = JSON.stringify({
    data: {
      object: {},
      type: "local_test",
    },
    event_id: `local_${randomUUID()}`,
    merchant_id: "local_self_check",
    type: "mintbinder.local_webhook_self_check",
  });
  const response = await fetch(`${localBaseUrl}/api/billing/webhook`, {
    body: payload,
    headers: {
      "content-type": "application/json",
      "x-square-hmacsha256-signature": signSquarePayload({
        notificationUrl,
        payload,
        signatureKey,
      }),
    },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });

  return {
    body: truncate(await response.text(), 500),
    statusCode: response.status,
  };
}

async function startNextServer(extraEnv) {
  const nextBin = path.join(repoRoot, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(
    process.execPath,
    [nextBin, "start", "--hostname", host, "--port", String(port)],
    {
      cwd: repoRoot,
      env: sanitizedEnv(extraEnv),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const childRecord = { child, name: "Next.js app" };
  children.push(childRecord);

  child.stdout.on("data", (data) => writeChildOutput("next", data));
  child.stderr.on("data", (data) => writeChildOutput("next", data));

  child.once("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`Next.js app exited with code ${code}.`);
    }
  });

  return childRecord;
}

async function waitForLocalApp(baseUrl) {
  await waitForFetch(baseUrl, {
    description: "local Next.js app",
    timeoutMs: 45_000,
  });
}

async function waitForTunnelSettle() {
  if (tunnelSettleMs <= 0) {
    return;
  }

  status(`Waiting ${tunnelSettleMs}ms for the Cloudflare tunnel to settle...`);
  await delay(tunnelSettleMs);
}

async function softCheckTunnel(notificationUrl) {
  try {
    await waitForFetch(notificationUrl, {
      description: `Cloudflare tunnel at ${notificationUrl}`,
      timeoutMs: 5_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cloudflare tunnel self-check failed.";

    status(`${message} Continuing to Square's validation.`);
  }
}

async function maybeSoftCheckTunnel(notificationUrl) {
  if (runTunnelSelfCheck) {
    await softCheckTunnel(notificationUrl);
  }
}

async function waitForFetch(url, { description, timeoutMs }) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3_000),
      });

      if (response.status < 500) {
        return;
      }

      lastError = new Error(`${description} returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }

    await delay(750);
  }

  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";

  throw new Error(`Timed out waiting for ${description}.${detail}`);
}

async function assertBuiltApp() {
  try {
    await access(path.join(repoRoot, ".next", "BUILD_ID"));
  } catch {
    throw new Error("The production app has not been built yet. Run npm run build before starting the Square tunnel.");
  }
}

async function updateLocalEnv(updates) {
  let content = "";

  try {
    content = await readFile(envPath, "utf8");
  } catch {
    content = "";
  }

  const lines = content ? content.split(/\r?\n/) : [];
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);

    if (!match || !(match[1] in updates)) {
      return line;
    }

    seen.add(match[1]);

    return `${match[1]}=${quoteEnvValue(updates[match[1]])}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;

    if (!seen.has(key)) {
      nextLines.push(`${key}=${quoteEnvValue(value)}`);
    }
  }

  await writeFile(envPath, `${nextLines.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}

async function squareRequest(pathname, { body, method }) {
  const accessToken = requiredEnv("SQUARE_ACCESS_TOKEN");
  const response = await fetch(`${squareApiBaseUrl()}${pathname}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "square-version": SQUARE_VERSION,
    },
    method,
    signal: AbortSignal.timeout(45_000),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(squareErrorMessage(data.errors) ?? `Square request failed with HTTP ${response.status}.`);
  }

  return data;
}

function squareApiBaseUrl() {
  return process.env.SQUARE_ENVIRONMENT?.trim().toLowerCase() === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

function squareErrorMessage(errors) {
  return errors
    ?.map((error) => error.detail || error.code)
    .filter(Boolean)
    .join(" ");
}

function requiredEnv(key) {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`${key} must be set before starting the Square tunnel.`);
  }

  return value;
}

function requiredWebhookSignatureKey(subscription) {
  const signatureKey = subscription.signature_key?.trim();

  if (!signatureKey) {
    throw new Error("Square did not return a webhook signature key.");
  }

  return signatureKey;
}

function squareTestWebhookSummary(response) {
  const result = response.test_result ?? response;
  const payload = result.payload ?? null;
  const responseBody = result.response_body ?? result.responseBody ?? null;

  return {
    eventType: result.event_type ?? "subscription.updated",
    payloadEventId: squarePayloadValue(payload, "event_id"),
    payloadType: squarePayloadType(payload),
    responseBody: truncate(responseBody, 500),
    statusCode: result.status_code ?? result.response_status_code ?? null,
    success: result.success ?? (result.status_code ? result.status_code === 200 : null),
  };
}

function signSquarePayload({
  notificationUrl,
  payload,
  signatureKey,
}) {
  return createHmac("sha256", signatureKey)
    .update(`${notificationUrl}${payload}`, "utf8")
    .digest("base64");
}

function squarePayloadType(payload) {
  return squarePayloadValue(payload, "type");
}

function squarePayloadValue(payload, key) {
  if (!payload || typeof payload !== "string") {
    return typeof payload === "object" && payload !== null ? payload[key] ?? null : null;
  }

  try {
    return JSON.parse(payload)[key] ?? null;
  } catch {
    return null;
  }
}

function truncate(value, maxLength) {
  if (!value || typeof value !== "string") {
    return value ?? null;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function sanitizedEnv(extraEnv = {}) {
  const env = {};
  const pathValue = process.env.Path ?? process.env.PATH;

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.toLowerCase() === "path") {
      continue;
    }

    env[key] = value;
  }

  if (pathValue) {
    env.Path = pathValue;
  }

  return {
    ...env,
    ...extraEnv,
  };
}

function npmInvocation() {
  const npmExecPath = process.env.npm_execpath?.trim();

  if (npmExecPath) {
    return {
      args: [npmExecPath],
      command: process.execPath,
    };
  }

  return {
    args: [],
    command: process.platform === "win32" ? "npm.cmd" : "npm",
  };
}

function quoteEnvValue(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function positiveInteger(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function writeChildOutput(prefix, data) {
  const text = data.toString().trim();

  if (text) {
    status(`[${prefix}] ${text}`);
  }
}

function status(message) {
  console.error(message);
}

function waitForStopSignal() {
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

async function shutdown() {
  for (const childRecord of [...children].reverse()) {
    await stopChild(childRecord);
  }

  await stopCloudflaredPidFile();
  await delay(500);
}

async function stopChild({ child, name }) {
  if (child.killed || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  status(`Stopping ${name}...`);
  child.kill("SIGTERM");

  const exited = await waitForChildExit(child, 5_000);

  if (!exited && process.platform === "win32" && child.pid) {
    await forceKillWindowsProcessTree(child.pid);
    await waitForChildExit(child, 2_000);
  }

  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("exit", onExit);
    };

    child.once("exit", onExit);
  });
}

function forceKillWindowsProcessTree(pid) {
  return new Promise((resolve) => {
    const taskkill = spawn(
      "taskkill.exe",
      ["/PID", String(pid), "/T", "/F"],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );

    taskkill.once("exit", resolve);
    taskkill.once("error", resolve);
  });
}

async function stopCloudflaredPidFile() {
  const pid = await readPidFile(cloudflaredPidFile);

  if (!pid) {
    return;
  }

  status(`Stopping cloudflared pid ${pid}...`);

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The process may already be gone.
  }

  await delay(500);

  try {
    process.kill(pid, 0);

    if (process.platform === "win32") {
      await forceKillWindowsProcessTree(pid);
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // The process exited cleanly.
  }

  await rm(cloudflaredPidFile, { force: true });
}

async function readPidFile(pidFile) {
  try {
    const pid = Number((await readFile(pidFile, "utf8")).trim());

    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
