import "dotenv/config";

import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const ADMIN_EMAIL = process.env.ADMIN_QA_EMAIL?.trim() || "liam@example.com";
const SQUARE_VERSION = process.env.SQUARE_VERSION?.trim() || "2026-05-20";
const WEBHOOK_READY_TEXT = "Keep this command running while you test Square checkout.";
const CLOUDFLARED_PID_FILE = path.join(process.cwd(), ".local-tunnel", "cloudflared.pid");
const prisma = new PrismaClient();
const children = [];

try {
  const config = squareConfig();
  const admin = await loadAdminUser();

  status("Starting Square webhook tunnel helper...");
  const tunnel = startTunnelHelper();

  await waitForTunnelReady(tunnel);
  status("Square webhook tunnel is ready.");

  const monthly = await activatePlan({
    admin,
    expectedPlan: "PLUS_MONTHLY",
    label: "monthly",
    planVariationId: config.monthlyPlanVariationId,
  });

  const monthlyCancellation = monthly.usedLocalReplay
    ? await replaySquareSubscriptionWebhook({
      customerId: monthly.customerId,
      planVariationId: config.monthlyPlanVariationId,
      status: "CANCELED",
      subscriptionId: monthly.providerSubscriptionId,
    })
    : await cancelSquareSubscription(monthly.providerSubscriptionId);
  const monthlyCanceled = await waitForLocalSubscription({
    expectedCancelAtPeriodEnd: true,
    expectedPlan: "PLUS_MONTHLY",
    subscriptionId: monthly.providerSubscriptionId,
  });

  const yearly = await activatePlan({
    admin,
    expectedPlan: "PLUS_YEARLY",
    label: "yearly",
    planVariationId: config.yearlyPlanVariationId,
  });

  const latest = await latestSubscriptionForUser(admin.id);

  console.log(JSON.stringify({
    admin: {
      email: admin.email,
      id: admin.id,
    },
    monthly: {
      cancelAtPeriodEnd: monthlyCanceled.cancelAtPeriodEnd,
      createdSquareSubscriptionId: monthly.createdSquareSubscriptionId,
      localPlan: monthly.localSubscription.plan,
      localStatus: monthly.localSubscription.status,
      squareCancellationStatus: monthlyCancellation.status ?? null,
      providerSubscriptionId: monthly.providerSubscriptionId,
      usedLocalReplay: monthly.usedLocalReplay,
    },
    yearly: {
      cancelAtPeriodEnd: yearly.localSubscription.cancelAtPeriodEnd,
      createdSquareSubscriptionId: yearly.createdSquareSubscriptionId,
      localPlan: yearly.localSubscription.plan,
      localStatus: yearly.localSubscription.status,
      providerSubscriptionId: yearly.providerSubscriptionId,
      usedLocalReplay: yearly.usedLocalReplay,
    },
    latestSubscription: latest
      ? {
        cancelAtPeriodEnd: latest.cancelAtPeriodEnd,
        currentPeriodEnd: latest.currentPeriodEnd?.toISOString() ?? null,
        plan: latest.plan,
        provider: latest.provider,
        status: latest.status,
      }
      : null,
    ok: true,
  }, null, 2));
} finally {
  await shutdown();
  await prisma.$disconnect();
}

async function activatePlan({
  admin,
  expectedPlan,
  label,
  planVariationId,
}) {
  status(`Creating Square ${label} sandbox customer...`);
  const customer = await createCustomer({
    email: admin.email,
    name: admin.displayName,
    referenceId: admin.id,
    label,
  });

  status(`Adding Square sandbox card on file for ${label} customer...`);
  const card = await createCardOnFile(customer.id);

  status(`Creating Square ${label} subscription...`);
  const subscription = await createSquareSubscription({
    cardId: card.id,
    customerId: customer.id,
    planVariationId,
  });

  if (!subscription.id) {
    throw new Error(`Square did not return a ${label} subscription ID.`);
  }

  let localSubscription;
  let providerSubscriptionId = subscription.id;
  let usedLocalReplay = false;

  try {
    localSubscription = await waitForLocalSubscription({
      expectedCancelAtPeriodEnd: false,
      expectedPlan,
      subscriptionId: providerSubscriptionId,
      timeoutMs: 45_000,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Square subscription webhook did not reach the expected state.";

    status(`${detail} Replaying a signed local Square subscription webhook for repeatable QA.`);
    providerSubscriptionId = `local_qa_${label}_${Date.now()}_${randomUUID()}`;
    await replaySquareSubscriptionWebhook({
      customerId: customer.id,
      planVariationId,
      status: "ACTIVE",
      subscriptionId: providerSubscriptionId,
    });
    localSubscription = await waitForLocalSubscription({
      expectedCancelAtPeriodEnd: false,
      expectedPlan,
      subscriptionId: providerSubscriptionId,
    });
    usedLocalReplay = true;
  }

  return {
    customerId: customer.id,
    createdSquareSubscriptionId: subscription.id,
    localSubscription,
    providerSubscriptionId,
    usedLocalReplay,
  };
}

function startTunnelHelper() {
  const child = spawn(process.execPath, ["scripts/run-square-webhook-tunnel.mjs"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const record = {
    child,
    readyOutput: "",
  };
  children.push(record);

  child.stdout.on("data", (data) => {
    const text = data.toString();
    record.readyOutput += text;
    writePrefixedOutput("tunnel", text);
  });

  child.stderr.on("data", (data) => {
    const text = data.toString();
    record.readyOutput += text;
    writePrefixedOutput("tunnel", text);
  });

  child.once("exit", (code, signal) => {
    if (!record.expectedExit && code !== 0) {
      console.error(`Square tunnel helper exited early with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`);
    }
  });

  return record;
}

function waitForTunnelReady(record) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the Square webhook tunnel helper to become ready."));
    }, 180_000);

    const onOutput = () => {
      if (!record.readyOutput.includes(WEBHOOK_READY_TEXT)) {
        return;
      }

      cleanup();
      resolve();
    };

    const onExit = (code) => {
      cleanup();
      reject(new Error(`Square webhook tunnel helper exited before readiness. Exit code: ${code ?? "unknown"}.`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      record.child.stdout.off("data", onOutput);
      record.child.stderr.off("data", onOutput);
      record.child.off("exit", onExit);
    };

    record.child.stdout.on("data", onOutput);
    record.child.stderr.on("data", onOutput);
    record.child.once("exit", onExit);
    onOutput();
  });
}

async function createCustomer({
  email,
  label,
  name,
  referenceId,
}) {
  const response = await squareRequest("/v2/customers", {
    body: {
      email_address: email,
      given_name: name || "Mint Binder",
      idempotency_key: randomUUID(),
      note: `Mint Binder Square activation QA ${label}`,
      reference_id: referenceId,
    },
    method: "POST",
  });
  const customer = response.customer;

  if (!customer?.id) {
    throw new Error("Square did not return a customer ID.");
  }

  return customer;
}

async function createCardOnFile(customerId) {
  const response = await squareRequest("/v2/cards", {
    body: {
      card: {
        billing_address: {
          postal_code: "94103",
        },
        cardholder_name: "Mint Binder QA",
        customer_id: customerId,
      },
      idempotency_key: randomUUID(),
      source_id: "cnon:card-nonce-ok",
    },
    method: "POST",
  });
  const card = response.card;

  if (!card?.id) {
    throw new Error("Square did not return a card ID.");
  }

  return card;
}

async function createSquareSubscription({
  cardId,
  customerId,
  planVariationId,
}) {
  const response = await squareRequest("/v2/subscriptions", {
    body: {
      card_id: cardId,
      customer_id: customerId,
      idempotency_key: randomUUID(),
      location_id: requiredEnv("SQUARE_LOCATION_ID"),
      plan_variation_id: planVariationId,
    },
    method: "POST",
  });

  return response.subscription ?? {};
}

async function cancelSquareSubscription(subscriptionId) {
  status("Cancelling monthly Square sandbox subscription...");
  const response = await squareRequest(`/v2/subscriptions/${subscriptionId}/cancel`, {
    method: "POST",
  });

  return response.subscription ?? {};
}

async function replaySquareSubscriptionWebhook({
  customerId,
  planVariationId,
  status: squareStatus,
  subscriptionId,
}) {
  const webhookConfig = await localWebhookConfig();
  const payload = JSON.stringify({
    data: {
      object: {
        subscription: {
          canceled_date: squareStatus === "CANCELED" ? isoDate(new Date()) : undefined,
          customer_id: customerId,
          id: subscriptionId,
          plan_variation_id: planVariationId,
          status: squareStatus,
        },
      },
      type: "subscription",
    },
    event_id: `local_qa_${randomUUID()}`,
    merchant_id: "local_square_activation_qa",
    type: "subscription.updated",
  });
  const response = await fetch("http://127.0.0.1:3000/api/billing/webhook/square", {
    body: payload,
    headers: {
      "content-type": "application/json",
      "x-square-hmacsha256-signature": createSquareSignature({
        notificationUrl: webhookConfig.notificationUrl,
        payload,
        signatureKey: webhookConfig.signatureKey,
      }),
    },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Signed local Square webhook replay failed with HTTP ${response.status}: ${body}`);
  }

  return {
    replayed: true,
    status: squareStatus,
  };
}

async function waitForLocalSubscription({
  expectedCancelAtPeriodEnd,
  expectedPlan,
  subscriptionId,
  timeoutMs = 120_000,
}) {
  return waitFor(async () => {
    const subscription = await prisma.subscription.findFirst({
      where: {
        provider: "square",
        providerSubscriptionId: subscriptionId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (
      subscription &&
      subscription.plan === expectedPlan &&
      subscription.status === "ACTIVE" &&
      subscription.cancelAtPeriodEnd === expectedCancelAtPeriodEnd
    ) {
      return subscription;
    }

    return null;
  }, {
    description: `local ${expectedPlan} subscription ${subscriptionId}`,
    timeoutMs,
  });
}

async function latestSubscriptionForUser(userId) {
  return prisma.subscription.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
}

async function loadAdminUser() {
  const user = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
    select: {
      displayName: true,
      email: true,
      id: true,
      role: true,
    },
  });

  if (!user) {
    throw new Error(`Admin QA user ${ADMIN_EMAIL} was not found.`);
  }

  if (user.role !== "ADMIN") {
    throw new Error(`QA user ${ADMIN_EMAIL} is not an admin.`);
  }

  return user;
}

async function squareRequest(path, { body, method }) {
  const response = await fetch(`${squareApiBaseUrl()}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      authorization: `Bearer ${requiredEnv("SQUARE_ACCESS_TOKEN")}`,
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

async function waitFor(callback, {
  description,
  timeoutMs,
}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await callback();

    if (value) {
      return value;
    }

    await delay(3_000);
  }

  throw new Error(`Timed out waiting for ${description}.`);
}

function squareConfig() {
  return {
    monthlyPlanVariationId: requiredEnv("SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID"),
    yearlyPlanVariationId: requiredEnv("SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID"),
  };
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

async function localWebhookConfig() {
  const env = parseEnv(await readFile(".env", "utf8"));
  const notificationUrl = env.SQUARE_WEBHOOK_NOTIFICATION_URL?.trim();
  const signatureKey = env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim();

  if (!notificationUrl || !signatureKey) {
    throw new Error("Local Square webhook URL/signature key were not written by the tunnel helper.");
  }

  return {
    notificationUrl,
    signatureKey,
  };
}

function createSquareSignature({
  notificationUrl,
  payload,
  signatureKey,
}) {
  return createHmac("sha256", signatureKey)
    .update(`${notificationUrl}${payload}`, "utf8")
    .digest("base64");
}

function parseEnv(content) {
  const env = {};

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);

    if (!match) {
      continue;
    }

    env[match[1]] = unquoteEnvValue(match[2]);
  }

  return env;
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();

  if (!trimmed.startsWith("\"") || !trimmed.endsWith("\"")) {
    return trimmed;
  }

  return trimmed
    .slice(1, -1)
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function requiredEnv(key) {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`${key} must be set before running Square activation QA.`);
  }

  return value;
}

async function shutdown() {
  for (const record of [...children].reverse()) {
    record.expectedExit = true;
    await stopChild(record.child);
  }

  await stopCloudflaredPidFile();
}

async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    await taskkill(child.pid);
    await waitForChildExit(child, 2_000);
    return;
  }

  child.kill("SIGTERM");

  if (await waitForChildExit(child, 8_000)) {
    return;
  }

  child.kill("SIGKILL");
  await waitForChildExit(child, 2_000);
}

async function stopCloudflaredPidFile() {
  const pid = await readPidFile(CLOUDFLARED_PID_FILE);

  if (pid) {
    await taskkill(pid);
  }

  await rm(CLOUDFLARED_PID_FILE, { force: true });
}

async function readPidFile(pidFile) {
  try {
    const pid = Number((await readFile(pidFile, "utf8")).trim());

    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
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

function taskkill(pid) {
  return new Promise((resolve) => {
    const child = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });

    child.once("error", resolve);
    child.once("exit", resolve);
  });
}

function writePrefixedOutput(prefix, text) {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) {
      console.error(`[${prefix}] ${line}`);
    }
  }
}

function status(message) {
  console.error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
