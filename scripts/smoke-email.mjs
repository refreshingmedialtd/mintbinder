import "dotenv/config";
import nodemailer from "nodemailer";
import { smtpSecurityOptions } from "./smtp-policy.mjs";

const provider = emailProvider();
const from = required("EMAIL_FROM", "Set EMAIL_FROM to a verified sender, for example Mint Binder <alerts@mintbinder.co.uk>.");
const to = required("EMAIL_SMOKE_TO", "Set EMAIL_SMOKE_TO to a mailbox you control before running the smoke test.");
const appUrl = optional("NEXT_PUBLIC_APP_URL") ?? "https://mintbinder.co.uk";
const sentAt = new Date().toISOString();
const subject = optional("EMAIL_SMOKE_SUBJECT") ?? `Mint Binder email smoke test - ${sentAt}`;
const message = {
  from,
  html: `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">
      <h1 style="font-size:20px;margin:0 0 12px;">Mint Binder email delivery is configured.</h1>
      <p>Transactional email is ready for controlled beta testing.</p>
      <p><strong>App URL:</strong> ${escapeHtml(appUrl)}</p>
      <p><strong>Provider:</strong> ${escapeHtml(provider)}</p>
      <p><strong>Sent at:</strong> ${escapeHtml(sentAt)}</p>
      <p style="color:#4b5563;">Next, run a controlled price-alert digest smoke before enabling real beta recipient emails.</p>
    </div>
  `,
  subject,
  text: [
    "Mint Binder email delivery is configured.",
    "",
    `App URL: ${appUrl}`,
    `Provider: ${provider}`,
    `Sent at: ${sentAt}`,
    "",
    "You can now run a controlled price-alert digest smoke before enabling real beta recipient emails.",
  ].join("\n"),
  to,
};

const result = provider === "smtp" ? await sendSmtpSmoke(message) : await sendResendSmoke(message);

console.log(
  JSON.stringify(
    {
      ok: true,
      provider,
      id: result.id,
      from,
      to,
      subject,
      sentAt,
    },
    null,
    2,
  ),
);

async function sendSmtpSmoke(message) {
  const host = required("SMTP_HOST", "Set SMTP_HOST to the outgoing mail server, for example smtp.stackmail.com.");
  const user = required("SMTP_USER", "Set SMTP_USER to the 20i mailbox username.");
  const pass = required("SMTP_PASSWORD", "Set SMTP_PASSWORD to the 20i mailbox password.");
  const port = smtpPort();
  const security = smtpSecurityOptions(port, process.env.SMTP_SECURE);
  const transporter = nodemailer.createTransport({
    host,
    port,
    ...security,
    auth: {
      user,
      pass,
    },
  });
  const info = await transporter.sendMail(message);

  return { id: info.messageId || "sent" };
}

async function sendResendSmoke(message) {
  const apiKey = required("RESEND_API_KEY", "Create a Resend sending API key and add it to .env.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `mintbinder-email-smoke-${sentAt}`,
    },
    body: JSON.stringify(message),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message ?? data.name ?? `Resend smoke failed with HTTP ${response.status}.`);
  }

  return { id: data.id ?? "sent" };
}

function emailProvider() {
  const explicitProvider = optional("EMAIL_PROVIDER")?.toLowerCase();

  if (explicitProvider === "smtp" || explicitProvider === "resend") {
    return explicitProvider;
  }

  if (optional("SMTP_HOST") && optional("SMTP_USER") && optional("SMTP_PASSWORD")) {
    return "smtp";
  }

  if (optional("RESEND_API_KEY")) {
    return "resend";
  }

  throw new Error("Email delivery is not configured. Set EMAIL_PROVIDER=smtp with SMTP_* values, or configure RESEND_API_KEY.");
}

function required(name, help) {
  const value = optional(name);

  if (!value) {
    throw new Error(`${name} is required. ${help}`);
  }

  return value;
}

function optional(name) {
  const value = process.env[name]?.trim();

  return value || undefined;
}

function smtpPort() {
  const port = Number.parseInt(process.env.SMTP_PORT ?? "", 10);

  return Number.isFinite(port) && port > 0 ? port : 465;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (match) => {
    switch (match) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
