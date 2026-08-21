import "dotenv/config";
import nodemailer from "nodemailer";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { buildPricingHealthReport, loadPricingHealthMetrics } from "./report-pricing-health.mjs";

const defaultLookbackMinutes = 90;
const defaultStaleMinutes = 45;
const defaultDetailLimit = 10;

export async function runJobMonitor({
  alertTo = optionalEnv("JOB_MONITOR_ALERT_TO") || optionalEnv("EMAIL_SMOKE_TO"),
  detailLimit = positiveInteger(process.env.JOB_MONITOR_DETAIL_LIMIT, defaultDetailLimit),
  dryRun = booleanSetting(process.env.JOB_MONITOR_DRY_RUN, true),
  lookbackMinutes = positiveInteger(process.env.JOB_MONITOR_LOOKBACK_MINUTES, defaultLookbackMinutes),
  now = optionalDate(process.env.JOB_MONITOR_NOW) ?? new Date(),
  prisma = new PrismaClient(),
  staleMinutes = positiveInteger(process.env.JOB_MONITOR_STALE_MINUTES, defaultStaleMinutes),
  sendEmail = sendMonitorEmail,
} = {}) {
  try {
    const [runs, pricingMetrics] = await Promise.all([
      loadProblemJobRuns({ detailLimit, lookbackMinutes, now, prisma, staleMinutes }),
      loadPricingHealthMetrics({ now, prisma }),
    ]);
    const pricingHealth = buildPricingHealthReport(pricingMetrics);
    const report = buildJobMonitorReport({
      alertTo,
      detailLimit,
      dryRun,
      failedRuns: runs.failedRuns,
      lookbackMinutes,
      now,
      pricingHealth,
      staleMinutes,
      staleRuns: runs.staleRuns,
    });

    if (!shouldSendJobMonitorAlert(report)) {
      return report;
    }

    if (!alertTo) {
      throw new Error("JOB_MONITOR_ALERT_TO or EMAIL_SMOKE_TO must be set before live job monitor alerts can send.");
    }

    const email = buildJobMonitorEmail(report);
    const sent = await sendEmail({ ...email, to: alertTo });

    return {
      ...report,
      alert: {
        ...report.alert,
        emailId: sent.id,
        sent: true,
      },
    };
  } finally {
    await prisma.$disconnect();
  }
}

export function buildJobMonitorReport({
  alertTo,
  detailLimit,
  dryRun,
  failedRuns,
  lookbackMinutes,
  now,
  pricingHealth,
  staleMinutes,
  staleRuns,
}) {
  const normalizedFailedRuns = failedRuns.map(normalizeJobRun);
  const normalizedStaleRuns = staleRuns.map(normalizeJobRun);
  const problems = [
    ...(normalizedFailedRuns.length
      ? [`${normalizedFailedRuns.length} failed job run${normalizedFailedRuns.length === 1 ? "" : "s"} in the last ${lookbackMinutes} minutes.`]
      : []),
    ...(normalizedStaleRuns.length
      ? [`${normalizedStaleRuns.length} running job run${normalizedStaleRuns.length === 1 ? "" : "s"} older than ${staleMinutes} minutes.`]
      : []),
    ...(pricingHealth?.problems ?? []),
  ];

  return {
    alert: {
      dryRun,
      sent: false,
      to: alertTo ?? null,
      wouldSend: !dryRun && problems.length > 0,
    },
    detailLimit,
    generatedAt: now.toISOString(),
    lookbackMinutes,
    ok: problems.length === 0,
    problems,
    recentFailed: {
      count: normalizedFailedRuns.length,
      runs: normalizedFailedRuns,
    },
    pricingHealth: pricingHealth ?? null,
    staleMinutes,
    staleRunning: {
      count: normalizedStaleRuns.length,
      runs: normalizedStaleRuns,
    },
  };
}

export function shouldSendJobMonitorAlert(report) {
  return !report.ok && report.alert.dryRun === false;
}

export function buildJobMonitorEmail(report) {
  const subject = `[Mint Binder] Job monitor alert: ${report.problems.length} issue${report.problems.length === 1 ? "" : "s"}`;
  const failedRows = report.recentFailed.runs.map(jobRunTableRow).join("");
  const staleRows = report.staleRunning.runs.map(jobRunTableRow).join("");
  const html = `<!doctype html>
<html lang="en">
<body style="color:#111827;font-family:Arial,sans-serif;line-height:1.5;margin:0;padding:24px;">
  <h1 style="font-size:20px;margin:0 0 12px;">Mint Binder job monitor alert</h1>
  <p>The job monitor found ${report.problems.length} operational issue${report.problems.length === 1 ? "" : "s"} at ${escapeHtml(report.generatedAt)}.</p>
  <ul>${report.problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join("")}</ul>
  ${failedRows ? `<h2 style="font-size:16px;margin:20px 0 8px;">Recent failed jobs</h2>${jobRunTable(failedRows)}` : ""}
  ${staleRows ? `<h2 style="font-size:16px;margin:20px 0 8px;">Stale running jobs</h2>${jobRunTable(staleRows)}` : ""}
  <p style="color:#4b5563;margin-top:20px;">Check the Operations job history before running further imports or enabling beta recipient emails.</p>
</body>
</html>`;
  const text = [
    "Mint Binder job monitor alert",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    ...report.problems.map((problem) => `- ${problem}`),
    "",
    ...jobRunTextSection("Recent failed jobs", report.recentFailed.runs),
    ...jobRunTextSection("Stale running jobs", report.staleRunning.runs),
    "Check the Operations job history before running further imports or enabling beta recipient emails.",
  ].join("\n");

  return {
    html,
    subject,
    text,
  };
}

async function loadProblemJobRuns({ detailLimit, lookbackMinutes, now, prisma, staleMinutes }) {
  const failedSince = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
  const staleBefore = new Date(now.getTime() - staleMinutes * 60 * 1000);
  const [failedRuns, staleRuns] = await Promise.all([
    prisma.jobRun.findMany({
      orderBy: { startedAt: "desc" },
      select: jobRunSelect(),
      take: detailLimit,
      where: {
        startedAt: { gte: failedSince },
        status: "FAILED",
      },
    }),
    prisma.jobRun.findMany({
      orderBy: { startedAt: "asc" },
      select: jobRunSelect(),
      take: detailLimit,
      where: {
        finishedAt: null,
        startedAt: { lte: staleBefore },
        status: "RUNNING",
      },
    }),
  ]);

  return {
    failedRuns,
    staleRuns,
  };
}

async function sendMonitorEmail({ html, subject, text, to }) {
  const provider = emailProvider();
  const from = requiredEnv("EMAIL_FROM", "EMAIL_FROM must be set before live job monitor alerts can send.");

  if (provider === "smtp") {
    const host = requiredEnv("SMTP_HOST", "SMTP_HOST must be set before live SMTP job monitor alerts can send.");
    const user = requiredEnv("SMTP_USER", "SMTP_USER must be set before live SMTP job monitor alerts can send.");
    const pass = requiredEnv("SMTP_PASSWORD", "SMTP_PASSWORD must be set before live SMTP job monitor alerts can send.");
    const port = smtpPort();
    const transporter = nodemailer.createTransport({
      auth: {
        pass,
        user,
      },
      host,
      port,
      secure: booleanSetting(process.env.SMTP_SECURE, port === 465),
    });
    const info = await transporter.sendMail({
      from,
      headers: { "X-Mint-Binder-Monitor": "job-runs" },
      html,
      subject,
      text,
      to,
    });

    return { id: info.messageId || "sent" };
  }

  const apiKey = requiredEnv("RESEND_API_KEY", "RESEND_API_KEY must be set before live Resend job monitor alerts can send.");
  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from,
      html,
      subject,
      text,
      to,
    }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `mintbinder-job-monitor-${new Date().toISOString().slice(0, 13)}`,
    },
    method: "POST",
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message ?? data.name ?? `Job monitor email failed with HTTP ${response.status}.`);
  }

  return { id: data.id ?? "sent" };
}

function normalizeJobRun(run) {
  return {
    durationMs: numberOrNull(run.durationMs),
    errorMessage: run.errorMessage ?? null,
    finishedAt: dateStringOrNull(run.finishedAt),
    jobType: jobTypeLabel(run.jobType),
    startedAt: dateStringOrNull(run.startedAt),
    status: jobStatusLabel(run.status),
  };
}

function jobRunSelect() {
  return {
    durationMs: true,
    errorMessage: true,
    finishedAt: true,
    jobType: true,
    startedAt: true,
    status: true,
  };
}

function jobRunTable(rows) {
  return `<table style="border-collapse:collapse;width:100%;">
    <thead>
      <tr>
        <th align="left" style="border-bottom:1px solid #d1d5db;padding:8px;">Type</th>
        <th align="left" style="border-bottom:1px solid #d1d5db;padding:8px;">Status</th>
        <th align="left" style="border-bottom:1px solid #d1d5db;padding:8px;">Started</th>
        <th align="left" style="border-bottom:1px solid #d1d5db;padding:8px;">Error</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function jobRunTableRow(run) {
  return `<tr>
    <td style="border-bottom:1px solid #e5e7eb;padding:8px;">${escapeHtml(run.jobType)}</td>
    <td style="border-bottom:1px solid #e5e7eb;padding:8px;">${escapeHtml(run.status)}</td>
    <td style="border-bottom:1px solid #e5e7eb;padding:8px;">${escapeHtml(run.startedAt ?? "-")}</td>
    <td style="border-bottom:1px solid #e5e7eb;padding:8px;">${escapeHtml(run.errorMessage ?? "-")}</td>
  </tr>`;
}

function jobRunTextSection(title, runs) {
  if (!runs.length) {
    return [];
  }

  return [
    title,
    ...runs.map(
      (run) =>
        `- ${run.jobType} ${run.status} started ${run.startedAt ?? "unknown"}${run.errorMessage ? `: ${run.errorMessage}` : ""}`,
    ),
    "",
  ];
}

function jobTypeLabel(value) {
  return String(value).toLowerCase();
}

function jobStatusLabel(value) {
  return String(value).toLowerCase();
}

function dateStringOrNull(value) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : String(value);
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function emailProvider() {
  const explicitProvider = optionalEnv("EMAIL_PROVIDER")?.toLowerCase();

  if (explicitProvider === "smtp" || explicitProvider === "resend") {
    return explicitProvider;
  }

  if (optionalEnv("SMTP_HOST") && optionalEnv("SMTP_USER") && optionalEnv("SMTP_PASSWORD")) {
    return "smtp";
  }

  if (optionalEnv("RESEND_API_KEY")) {
    return "resend";
  }

  throw new Error("Email delivery is not configured for live job monitor alerts.");
}

function requiredEnv(name, message) {
  const value = optionalEnv(name);

  if (!value) {
    throw new Error(message);
  }

  return value;
}

function optionalEnv(name) {
  const value = process.env[name]?.trim();

  return value || undefined;
}

function optionalDate(value) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const date = new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    throw new Error("JOB_MONITOR_NOW must be a valid ISO date/time.");
  }

  return date;
}

function positiveInteger(value, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.floor(number);
}

function smtpPort() {
  const port = Number.parseInt(process.env.SMTP_PORT ?? "", 10);

  return Number.isFinite(port) && port > 0 ? port : 465;
}

function booleanSetting(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (match) => {
    switch (match) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runJobMonitor();

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}
