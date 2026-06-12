import "dotenv/config";

const secret = required("JOB_SECRET", "Set JOB_SECRET before running the production email smoke.");
const baseUrl = (process.env.EMAIL_SMOKE_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://mintbinder.co.uk").trim().replace(/\/$/, "");
const subject = process.env.EMAIL_SMOKE_SUBJECT?.trim();
const note = process.env.EMAIL_SMOKE_NOTE?.trim() ?? "Triggered by the Mint Binder production smoke command.";

const response = await fetch(`${baseUrl}/api/jobs/email-smoke`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    note,
    subject,
  }),
});
const result = await response.json().catch(() => ({}));

console.log(JSON.stringify({
  baseUrl,
  status: response.status,
  ...result,
}, null, 2));

if (!response.ok) {
  throw new Error(result.error ?? `Production email smoke failed with HTTP ${response.status}.`);
}

function required(name, help) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required. ${help}`);
  }

  return value;
}
