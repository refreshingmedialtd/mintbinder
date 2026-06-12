import nodemailer from "nodemailer";

type SendEmailInput = {
  html: string;
  idempotencyKey?: string;
  subject: string;
  text: string;
  to: string;
};

type ResendResponse = {
  id?: string;
  message?: string;
  name?: string;
};
type EmailProvider = "resend" | "smtp";

export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

export function isEmailConfigured() {
  return Boolean(process.env.EMAIL_FROM && (isResendConfigured() || isSmtpConfigured()));
}

export async function sendEmail({
  html,
  idempotencyKey,
  subject,
  text,
  to,
}: SendEmailInput) {
  const provider = emailProvider();

  if (provider === "smtp") {
    return sendSmtpEmail({ html, idempotencyKey, subject, text, to });
  }

  if (provider === "resend") {
    return sendResendEmail({ html, idempotencyKey, subject, text, to });
  }

  throw new EmailConfigError("Email delivery is not configured.");
}

async function sendResendEmail({
  html,
  idempotencyKey,
  subject,
  text,
  to,
}: SendEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    throw new EmailConfigError("Email delivery is not configured.");
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };

  if (idempotencyKey) {
    headers["idempotency-key"] = idempotencyKey;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from,
      html,
      subject,
      text,
      to,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as ResendResponse;

  if (!response.ok) {
    throw new Error(data.message ?? data.name ?? `Email request failed with ${response.status}.`);
  }

  return { id: data.id ?? "sent" };
}

async function sendSmtpEmail({
  html,
  idempotencyKey,
  subject,
  text,
  to,
}: SendEmailInput) {
  const from = process.env.EMAIL_FROM;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!from || !host || !user || !pass) {
    throw new EmailConfigError("SMTP email delivery is not configured.");
  }

  const port = smtpPort();
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: booleanSetting(process.env.SMTP_SECURE, port === 465),
    auth: {
      user,
      pass,
    },
  });
  const info = await transporter.sendMail({
    from,
    headers: idempotencyKey ? { "X-Mint-Binder-Idempotency-Key": idempotencyKey } : undefined,
    html,
    subject,
    text,
    to,
  });

  return { id: info.messageId || "sent" };
}

function emailProvider(): EmailProvider | undefined {
  const explicitProvider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();

  if (explicitProvider === "smtp" || explicitProvider === "resend") {
    return explicitProvider;
  }

  if (isSmtpConfigured()) {
    return "smtp";
  }

  if (isResendConfigured()) {
    return "resend";
  }

  return undefined;
}

function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

function smtpPort() {
  const port = Number.parseInt(process.env.SMTP_PORT ?? "", 10);

  return Number.isFinite(port) && port > 0 ? port : 465;
}

function booleanSetting(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
