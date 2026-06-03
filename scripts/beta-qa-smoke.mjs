import "dotenv/config";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  startJobServer,
  stopServer,
  waitForServer,
} from "./job-server-runner.mjs";

const DEFAULT_PORT = 3105;
const DEFAULT_TIMEOUT_MS = 8000;
const AUTH_REQUIRED = ["Authentication required."];
const JOB_SECRET_REQUIRED = ["JOB_SECRET is not configured.", "Job authentication failed."];

export const betaQaChecks = [
  {
    id: "app-shell",
    gate: "Main app shell",
    method: "GET",
    path: "/",
    expectedStatuses: [200],
    requiredText: ["PokeStop"],
  },
  {
    id: "auth-session-public",
    gate: "Auth",
    method: "GET",
    path: "/api/auth/session",
    expectedStatuses: [200],
    contentTypeIncludes: "application/json",
  },
  {
    id: "app-data-auth-required",
    gate: "Auth",
    method: "GET",
    path: "/api/app-data",
    expectedStatuses: [401],
    allowedJsonErrors: AUTH_REQUIRED,
  },
  {
    id: "collection-create-auth-required",
    gate: "Collection",
    method: "POST",
    path: "/api/collection-items",
    body: { catalogueId: "qa-smoke", quantity: 1 },
    expectedStatuses: [401],
    allowedJsonErrors: AUTH_REQUIRED,
  },
  {
    id: "wishlist-create-auth-required",
    gate: "Wishlist",
    method: "POST",
    path: "/api/wishlist-items",
    body: { catalogueId: "qa-smoke" },
    expectedStatuses: [401],
    allowedJsonErrors: AUTH_REQUIRED,
  },
  {
    id: "notification-preferences-auth-required",
    gate: "Notifications",
    method: "GET",
    path: "/api/notification-preferences",
    expectedStatuses: [401],
    allowedJsonErrors: AUTH_REQUIRED,
  },
  {
    id: "notification-preferences-update-auth-required",
    gate: "Notifications",
    method: "PATCH",
    path: "/api/notification-preferences",
    body: { digestFrequency: "Weekly" },
    expectedStatuses: [401],
    allowedJsonErrors: AUTH_REQUIRED,
  },
  {
    id: "price-alerts-auth-required",
    gate: "Plus alerts",
    method: "GET",
    path: "/api/alerts/price",
    expectedStatuses: [401],
    allowedJsonErrors: AUTH_REQUIRED,
  },
  {
    id: "insurance-report-auth-required",
    gate: "Reports",
    method: "GET",
    path: "/api/reports/insurance",
    expectedStatuses: [401],
    allowedJsonErrors: AUTH_REQUIRED,
  },
  {
    id: "billing-checkout-auth-required",
    gate: "Billing",
    method: "POST",
    path: "/api/billing/checkout",
    body: { plan: "monthly" },
    expectedStatuses: [401],
    allowedJsonErrors: AUTH_REQUIRED,
  },
  {
    id: "billing-portal-auth-required",
    gate: "Billing",
    method: "POST",
    path: "/api/billing/portal",
    expectedStatuses: [401],
    allowedJsonErrors: AUTH_REQUIRED,
  },
  {
    id: "billing-subscription-auth-required",
    gate: "Billing",
    method: "GET",
    path: "/api/billing/subscription",
    expectedStatuses: [401],
    allowedJsonErrors: AUTH_REQUIRED,
  },
  {
    id: "billing-subscription-cancel-auth-required",
    gate: "Billing",
    method: "PATCH",
    path: "/api/billing/subscription",
    body: { action: "cancel" },
    expectedStatuses: [401],
    allowedJsonErrors: AUTH_REQUIRED,
  },
  {
    id: "catalogue-status-job-secret-required",
    gate: "Operations",
    method: "GET",
    path: "/api/jobs/catalogue-status",
    expectedStatuses: [401, 501],
    allowedJsonErrors: JOB_SECRET_REQUIRED,
  },
  {
    id: "catalogue-gaps-job-secret-required",
    gate: "Operations",
    method: "GET",
    path: "/api/jobs/catalogue-gaps",
    expectedStatuses: [401, 501],
    allowedJsonErrors: JOB_SECRET_REQUIRED,
  },
  {
    id: "job-runs-job-secret-required",
    gate: "Operations",
    method: "GET",
    path: "/api/jobs/runs",
    expectedStatuses: [401, 501],
    allowedJsonErrors: JOB_SECRET_REQUIRED,
  },
  {
    id: "price-alert-job-secret-required",
    gate: "Operations",
    method: "POST",
    path: "/api/jobs/price-alerts",
    body: { dryRun: true },
    expectedStatuses: [401, 501],
    allowedJsonErrors: JOB_SECRET_REQUIRED,
  },
  {
    id: "not-found-route",
    gate: "Routing",
    method: "GET",
    path: "/__pokestop_beta_smoke_missing__",
    expectedStatuses: [404],
  },
];

export async function runBetaQaSmoke({
  baseUrl = process.env.BETA_QA_BASE_URL?.trim(),
  checks = betaQaChecks,
  port = numberFromEnv("BETA_QA_PORT", DEFAULT_PORT),
} = {}) {
  let serverHandle;
  const startedServer = !baseUrl;

  if (startedServer && !existsSync(".next/BUILD_ID")) {
    return buildReport({
      baseUrl: null,
      checks: [],
      failures: ["Build output is missing. Run npm run build before npm run qa:beta."],
      startedServer,
    });
  }

  try {
    if (!baseUrl) {
      serverHandle = startJobServer({ port });
      baseUrl = serverHandle.baseUrl;
      await waitForServer({
        output: serverHandle.output,
        server: serverHandle.server,
        url: baseUrl,
      });
    }

    const results = [];

    for (const check of checks) {
      results.push(await runRouteCheck(baseUrl, check));
    }

    return buildReport({
      baseUrl,
      checks: results,
      failures: results.flatMap((result) =>
        result.ok ? [] : result.problems.map((problem) => `${result.id}: ${problem}`),
      ),
      startedServer,
    });
  } catch (error) {
    return buildReport({
      baseUrl: baseUrl ?? null,
      checks: [],
      failures: [error instanceof Error ? error.message : "Unknown beta QA smoke failure."],
      startedServer,
    });
  } finally {
    if (serverHandle) {
      await stopServer(serverHandle.server);
    }
  }
}

export async function runRouteCheck(baseUrl, check) {
  const url = new URL(check.path, baseUrl);
  const init = {
    headers: check.body ? { "content-type": "application/json" } : undefined,
    method: check.method,
    redirect: "manual",
    signal: AbortSignal.timeout(check.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  };

  if (check.body) {
    init.body = JSON.stringify(check.body);
  }

  try {
    const response = await fetch(url, init);
    const text = await response.text();

    return evaluateRouteResult(check, {
      contentType: response.headers.get("content-type") ?? "",
      status: response.status,
      text,
    });
  } catch (error) {
    return {
      contentType: "",
      expectedStatuses: check.expectedStatuses,
      gate: check.gate,
      id: check.id,
      method: check.method,
      ok: false,
      path: check.path,
      problems: [error instanceof Error ? error.message : "Request failed."],
      status: null,
    };
  }
}

export function evaluateRouteResult(check, result) {
  const json = parseJson(result.text);
  const problems = [
    ...statusProblems(check, result.status),
    ...contentTypeProblems(check, result.contentType),
    ...requiredTextProblems(check, result.text),
    ...jsonErrorProblems(check, json),
  ];

  return {
    bodySample: sampleBody(result.text),
    contentType: result.contentType,
    expectedStatuses: check.expectedStatuses,
    gate: check.gate,
    id: check.id,
    method: check.method,
    ok: problems.length === 0,
    path: check.path,
    problems,
    status: result.status,
  };
}

function buildReport({ baseUrl, checks, failures, startedServer }) {
  return {
    baseUrl,
    checks,
    failures,
    generatedAt: new Date().toISOString(),
    ok: failures.length === 0,
    startedServer,
    summary: {
      failed: failures.length,
      passed: checks.filter((check) => check.ok).length,
      total: checks.length,
    },
  };
}

function statusProblems(check, status) {
  return check.expectedStatuses.includes(status)
    ? []
    : [`Expected status ${check.expectedStatuses.join(" or ")}, got ${status}.`];
}

function contentTypeProblems(check, contentType) {
  if (!check.contentTypeIncludes) {
    return [];
  }

  return contentType.toLowerCase().includes(check.contentTypeIncludes.toLowerCase())
    ? []
    : [`Expected content-type containing ${check.contentTypeIncludes}, got ${contentType || "none"}.`];
}

function requiredTextProblems(check, text) {
  return (check.requiredText ?? [])
    .filter((value) => !text.includes(value))
    .map((value) => `Response body did not include ${JSON.stringify(value)}.`);
}

function jsonErrorProblems(check, json) {
  if (!check.allowedJsonErrors) {
    return [];
  }

  const error = typeof json?.error === "string" ? json.error : "";

  return check.allowedJsonErrors.includes(error)
    ? []
    : [`Expected JSON error ${check.allowedJsonErrors.join(" or ")}, got ${error || "none"}.`];
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sampleBody(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

function numberFromEnv(key, fallback) {
  const value = Number(process.env[key]);

  return Number.isInteger(value) && value > 0 ? value : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runBetaQaSmoke();

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}
