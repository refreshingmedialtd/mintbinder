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

export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail({
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
