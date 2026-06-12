import "dotenv/config";

const apiKey = required("RESEND_API_KEY", "Create a Resend sending API key and add it to .env.");
const from = required("EMAIL_FROM", "Set EMAIL_FROM to a verified sender, for example Mint Binder <alerts@notifications.mintbinder.co.uk>.");
const to = required(
  "EMAIL_SMOKE_TO",
  "Set EMAIL_SMOKE_TO to a mailbox you control before running the smoke test.",
);
const appUrl = optional("NEXT_PUBLIC_APP_URL") ?? "https://mintbinder.co.uk";
const sentAt = new Date().toISOString();
const subject = optional("EMAIL_SMOKE_SUBJECT") ?? `Mint Binder email smoke test - ${sentAt}`;

const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "idempotency-key": `mintbinder-email-smoke-${sentAt}`,
  },
  body: JSON.stringify({
    from,
    to,
    subject,
    text: [
      "Mint Binder email delivery is configured.",
      "",
      `App URL: ${appUrl}`,
      `Sent at: ${sentAt}`,
      "",
      "You can now run a controlled price-alert digest smoke before enabling real beta recipient emails.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">
        <h1 style="font-size:20px;margin:0 0 12px;">Mint Binder email delivery is configured.</h1>
        <p>Transactional email is ready for controlled beta testing.</p>
        <p><strong>App URL:</strong> ${escapeHtml(appUrl)}</p>
        <p><strong>Sent at:</strong> ${escapeHtml(sentAt)}</p>
        <p style="color:#4b5563;">Next, run a controlled price-alert digest smoke before enabling real beta recipient emails.</p>
      </div>
    `,
  }),
});

const data = await response.json().catch(() => ({}));

if (!response.ok) {
  throw new Error(data.message ?? data.name ?? `Resend smoke failed with HTTP ${response.status}.`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      provider: "resend",
      id: data.id ?? "sent",
      from,
      to,
      subject,
      sentAt,
    },
    null,
    2,
  ),
);

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
