import { booleanSetting } from "./catalogue-batch-options.mjs";

export function priceAlertScheduleSettings(env = process.env) {
  const dryRun = booleanSetting(env.PRICE_ALERT_DIGEST_DRY_RUN, true);
  const allowLiveRecipients = booleanSetting(env.PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS, false);
  const explicitTestRecipient = optionalString(env.PRICE_ALERT_DIGEST_TEST_RECIPIENT);
  const smokeTestRecipient = optionalString(env.EMAIL_SMOKE_TO);
  const testRecipient = explicitTestRecipient || (!allowLiveRecipients ? smokeTestRecipient : undefined);
  const emailConfigured = isEmailConfigured(env);
  const problems = [];

  if (!dryRun && !emailConfigured) {
    problems.push("Live price-alert delivery is enabled but email delivery is not fully configured.");
  }

  if (!dryRun && !testRecipient && !allowLiveRecipients) {
    problems.push(
      "Live price-alert delivery needs a test recipient or PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS=true.",
    );
  }

  const mode = dryRun
    ? "dry_run"
    : testRecipient
      ? "live_test"
      : allowLiveRecipients
        ? "live_recipients"
        : "blocked";

  return {
    allowLiveRecipients,
    dryRun,
    emailConfigured,
    mode,
    ok: problems.length === 0,
    problems,
    testRecipient,
    testRecipientConfigured: Boolean(testRecipient),
  };
}

function isEmailConfigured(env) {
  const provider = optionalString(env.EMAIL_PROVIDER)?.toLowerCase();
  const from = optionalString(env.EMAIL_FROM);
  const smtp = optionalString(env.SMTP_HOST) && optionalString(env.SMTP_USER) && optionalString(env.SMTP_PASSWORD);
  const resend = optionalString(env.RESEND_API_KEY);

  if (!from) {
    return false;
  }

  if (provider === "smtp") {
    return Boolean(smtp);
  }

  if (provider === "resend") {
    return Boolean(resend);
  }

  return Boolean(smtp || resend);
}

function optionalString(value) {
  const text = String(value ?? "").trim();

  return text || undefined;
}
