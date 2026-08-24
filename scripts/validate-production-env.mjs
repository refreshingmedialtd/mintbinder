import "dotenv/config";
import {
  authAndJobSecretsAreIndependent,
  billingProviderLifecycleSettings,
} from "./billing-provider-lifecycle.mjs";
import { smtpSecurityOptions } from "./smtp-policy.mjs";

const jsonOutput = process.argv.includes("--json");
const deploymentCheck = process.argv.includes("--deployment");

const checks = [];

required("DATABASE_URL", "Set the production PostgreSQL connection string.", {
  validate: (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
  problem: "DATABASE_URL must be a PostgreSQL connection string.",
});
notLocalUrl("DATABASE_URL", "DATABASE_URL should point to hosted production PostgreSQL, not localhost.");

required("AUTH_SECRET", "Set a high-entropy Auth.js secret.");
minLength("AUTH_SECRET", 32, "AUTH_SECRET should be at least 32 characters.");
notPlaceholder("AUTH_SECRET", ["replace", "secret", "password"], "AUTH_SECRET still looks like a placeholder.");

required("AUTH_URL", "Set AUTH_URL to the production app origin.");
httpsUrl("AUTH_URL", "AUTH_URL must be a public HTTPS URL.");
required("AUTH_TRUST_HOST", "Set AUTH_TRUST_HOST=true for the deployed host.");
exact("AUTH_TRUST_HOST", "true", "AUTH_TRUST_HOST should be true.");

required("NEXT_PUBLIC_APP_URL", "Set NEXT_PUBLIC_APP_URL to the production app origin.");
httpsUrl("NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_APP_URL must be a public HTTPS URL.");
sameOrigin("AUTH_URL", "NEXT_PUBLIC_APP_URL", "AUTH_URL and NEXT_PUBLIC_APP_URL should use the same origin.");

required("SCHEDULED_JOB_APP_URL", "Set the HTTPS production origin used by protected scheduled-job helpers.");
httpsUrl("SCHEDULED_JOB_APP_URL", "SCHEDULED_JOB_APP_URL must be a public HTTPS URL.");
sameOrigin(
  "SCHEDULED_JOB_APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "SCHEDULED_JOB_APP_URL and NEXT_PUBLIC_APP_URL should use the same origin.",
);

required("JOB_SECRET", "Set a high-entropy secret for protected job routes.");
minLength("JOB_SECRET", 32, "JOB_SECRET should be at least 32 characters.");
notPlaceholder("JOB_SECRET", ["replace", "secret", "password"], "JOB_SECRET still looks like a placeholder.");
if (!authAndJobSecretsAreIndependent(process.env)) {
  blocker(
    "JOB_SECRET",
    "AUTH_SECRET and JOB_SECRET must be independently generated values. Rotate both if either has been reused or exposed.",
  );
}

oneOf("BILLING_PROVIDER", ["square", "stripe", ""], "BILLING_PROVIDER should be square or stripe. Empty defaults to square.");
oneOf("SQUARE_WEBHOOK_ENABLED", ["true", "false", ""], "SQUARE_WEBHOOK_ENABLED should be true or false.");
oneOf("STRIPE_WEBHOOK_ENABLED", ["true", "false", ""], "STRIPE_WEBHOOK_ENABLED should be true or false.");

const lifecycle = billingProviderLifecycleSettings(process.env);
const billingProvider = lifecycle.checkoutProvider;

if (lifecycle.squareWebhookEnabled) {
  required("SQUARE_ACCESS_TOKEN", "Set the Square access token while Square webhooks remain enabled.");
  required("SQUARE_ENVIRONMENT", "Set SQUARE_ENVIRONMENT while Square webhooks remain enabled.");
  required("SQUARE_WEBHOOK_NOTIFICATION_URL", "Set the Square webhook URL.");
  httpsUrl("SQUARE_WEBHOOK_NOTIFICATION_URL", "SQUARE_WEBHOOK_NOTIFICATION_URL must be HTTPS.");
  webhookPath("SQUARE_WEBHOOK_NOTIFICATION_URL", "/api/billing/webhook/square", "Square webhook URL should end with /api/billing/webhook/square.");
  sameOrigin("SQUARE_WEBHOOK_NOTIFICATION_URL", "NEXT_PUBLIC_APP_URL", "Square webhook URL should share the app origin.");
  required("SQUARE_WEBHOOK_SIGNATURE_KEY", "Copy the Square webhook signature key.");
  required("SQUARE_WEBHOOK_SUBSCRIPTION_ID", "Record the Square webhook subscription ID.");
}

if (lifecycle.stripeWebhookEnabled) {
  required("STRIPE_SECRET_KEY", "Set STRIPE_SECRET_KEY while Stripe webhooks remain enabled.");
  required("STRIPE_WEBHOOK_SECRET", "Set STRIPE_WEBHOOK_SECRET while Stripe webhooks remain enabled.");
  required("STRIPE_WEBHOOK_NOTIFICATION_URL", "Record the Stripe webhook URL while Stripe webhooks remain enabled.");
  httpsUrl("STRIPE_WEBHOOK_NOTIFICATION_URL", "STRIPE_WEBHOOK_NOTIFICATION_URL must be HTTPS.");
  webhookPath("STRIPE_WEBHOOK_NOTIFICATION_URL", "/api/billing/webhook/stripe", "Stripe webhook URL should end with /api/billing/webhook/stripe.");
  sameOrigin("STRIPE_WEBHOOK_NOTIFICATION_URL", "NEXT_PUBLIC_APP_URL", "Stripe webhook URL should share the app origin.");
}

if (billingProvider === "square") {
  required("SQUARE_LOCATION_ID", "Set the production Square location ID.");
  if (deploymentCheck) {
    warnIf(
      normalized("SQUARE_ENVIRONMENT") !== "production",
      "SQUARE_ENVIRONMENT",
      "Square is not in production mode; paid public checkout must remain a beta/sandbox test.",
    );
  } else {
    exact("SQUARE_ENVIRONMENT", "production", "SQUARE_ENVIRONMENT must be production for public launch.");
  }
  if (deploymentCheck) {
    warnIf(
      normalized("SQUARE_PAYMENT_CORRELATION_VERIFIED") !== "true",
      "SQUARE_PAYMENT_CORRELATION_VERIFIED",
      "Paid Square checkout remains disabled until the hosted-checkout payment correlation smoke has passed.",
    );
  } else {
    exact(
      "SQUARE_PAYMENT_CORRELATION_VERIFIED",
      "true",
      "Set SQUARE_PAYMENT_CORRELATION_VERIFIED=true only after payment.created/payment.updated hosted-checkout correlation passes end to end.",
    );
  }
  required("SQUARE_PLUS_MONTHLY_PLAN_VARIATION_ID", "Set the Square Plus monthly plan variation ID.");
  required("SQUARE_PLUS_YEARLY_PLAN_VARIATION_ID", "Set the Square Plus yearly plan variation ID.");
  exact("SQUARE_CURRENCY", "GBP", "SQUARE_CURRENCY should be GBP.");
  positiveInteger("SQUARE_PLUS_MONTHLY_AMOUNT_MINOR", "SQUARE_PLUS_MONTHLY_AMOUNT_MINOR should be a positive integer.");
  positiveInteger("SQUARE_PLUS_YEARLY_AMOUNT_MINOR", "SQUARE_PLUS_YEARLY_AMOUNT_MINOR should be a positive integer.");
  warnIf(
    normalized("SQUARE_PLUS_MONTHLY_AMOUNT_MINOR") !== "249",
    "SQUARE_PLUS_MONTHLY_AMOUNT_MINOR",
    "Monthly Plus is expected to be GBP 2.49 unless pricing changes deliberately.",
  );
  warnIf(
    normalized("SQUARE_PLUS_YEARLY_AMOUNT_MINOR") !== "1999",
    "SQUARE_PLUS_YEARLY_AMOUNT_MINOR",
    "Yearly Plus is expected to be GBP 19.99 unless pricing changes deliberately.",
  );
}

if (billingProvider === "stripe") {
  required("STRIPE_PLUS_MONTHLY_PRICE_ID", "Set the Stripe monthly price ID when Stripe is active.");
  required("STRIPE_PLUS_YEARLY_PRICE_ID", "Set the Stripe yearly price ID when Stripe is active.");
}

required("EMAIL_FROM", "Set EMAIL_FROM to a verified sender on the production domain.");
notPlaceholder("EMAIL_FROM", ["example.com", "alerts@example.com"], "EMAIL_FROM still uses the example sender.");
oneOf("EMAIL_PROVIDER", ["smtp", "resend", ""], "EMAIL_PROVIDER should be smtp or resend. Empty auto-detects from configured values.");
const emailProvider = normalized("EMAIL_PROVIDER") || (normalized("SMTP_HOST") ? "smtp" : normalized("RESEND_API_KEY") ? "resend" : "");
if (!emailProvider) {
  blocker("EMAIL_PROVIDER", "Configure 20i SMTP settings or a Resend API key before live notification email.");
}
if (emailProvider === "smtp") {
  required("SMTP_HOST", "Set the 20i outgoing SMTP host, for example smtp.stackmail.com.");
  oneOf("SMTP_PORT", ["465", "587"], "SMTP_PORT must be 465 for implicit TLS or 587 for STARTTLS.");
  oneOf("SMTP_SECURE", ["true", "false"], "SMTP_SECURE must be exactly true or false.");
  if (normalized("SMTP_PORT") && normalized("SMTP_SECURE")) {
    try {
      smtpSecurityOptions(normalized("SMTP_PORT"), normalized("SMTP_SECURE"));
    } catch (error) {
      blocker("SMTP_SECURE", error instanceof Error ? error.message : "SMTP TLS settings are invalid.");
    }
  }
  required("SMTP_USER", "Set SMTP_USER to the 20i mailbox username.");
  required("SMTP_PASSWORD", "Set SMTP_PASSWORD to the 20i mailbox password.");
}
if (emailProvider === "resend") {
  required("RESEND_API_KEY", "Set a Resend API key before live notification email.");
}
warnIf(
  normalized("PRICE_ALERT_DIGEST_DRY_RUN") !== "false",
  "PRICE_ALERT_DIGEST_DRY_RUN",
  "Keep this true until live-smoke testing, then set false before real Plus digests.",
);
warnIf(
  normalized("PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS") !== "true",
  "PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS",
  "Live beta digests will not email real users until this is explicitly true.",
);

oneOf("EXCHANGE_RATES_PROVIDER", ["frankfurter", "manual", ""], "EXCHANGE_RATES_PROVIDER should be frankfurter or manual. Empty defaults to frankfurter.");
const manualExchangeRates =
  normalized("EXCHANGE_RATES_PROVIDER") === "manual" || optionalBoolean("EXCHANGE_RATES_AUTO") === false;

if (normalized("EXCHANGE_RATES_API_URL")) {
  httpsUrl("EXCHANGE_RATES_API_URL", "EXCHANGE_RATES_API_URL should be an HTTPS Frankfurter-compatible endpoint.");
}

if (manualExchangeRates) {
  positiveNumber("POKEMON_TCG_USD_TO_GBP_RATE", "Set a positive USD-to-GBP rate when automatic exchange rates are disabled.");
  warnIf(
    !positiveNumberValue("POKEMON_TCG_EUR_TO_GBP_RATE"),
    "POKEMON_TCG_EUR_TO_GBP_RATE",
    "Pokemon TCG API Cardmarket fallback prices need a positive EUR-to-GBP rate when automatic exchange rates are disabled.",
  );
  warnIf(
    !positiveNumberValue("TCGCSV_USD_TO_GBP_RATE") && !positiveNumberValue("POKEMON_TCG_USD_TO_GBP_RATE"),
    "TCGCSV_USD_TO_GBP_RATE",
    "Sealed/card TCGCSV pricing needs TCGCSV_USD_TO_GBP_RATE or the Pokemon USD fallback when automatic exchange rates are disabled.",
  );
} else {
  warnIf(
    !positiveNumberValue("POKEMON_TCG_USD_TO_GBP_RATE"),
    "POKEMON_TCG_USD_TO_GBP_RATE",
    "Automatic exchange rates are enabled; add this only as a USD fallback for provider outages.",
  );
  warnIf(
    !positiveNumberValue("POKEMON_TCG_EUR_TO_GBP_RATE"),
    "POKEMON_TCG_EUR_TO_GBP_RATE",
    "Automatic exchange rates are enabled; add this only as an EUR fallback for Pokemon TCG API Cardmarket fallback prices.",
  );
  warnIf(
    !positiveNumberValue("TCGCSV_USD_TO_GBP_RATE") && !positiveNumberValue("POKEMON_TCG_USD_TO_GBP_RATE"),
    "TCGCSV_USD_TO_GBP_RATE",
    "Automatic exchange rates are enabled; add this only as a TCGCSV USD fallback for provider outages.",
  );
}
warnIf(
  !normalized("CARDTRADER_API_TOKEN") && !normalized("CARDTRADER_TOKEN"),
  "CARDTRADER_API_TOKEN",
  "CardTrader sealed-price enrichment is unavailable without a bearer token from the service account settings.",
);

const blockers = checks.filter((check) => check.level === "blocker");
const warnings = checks.filter((check) => check.level === "warning");
const report = {
  blockers: blockers.map(publicCheck),
  generatedAt: new Date().toISOString(),
  ok: blockers.length === 0,
  summary: {
    blockers: blockers.length,
    reported: checks.length,
    warnings: warnings.length,
  },
  warnings: warnings.map(publicCheck),
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHumanReport(report);
}

if (blockers.length) {
  process.exitCode = 1;
}

function required(key, message, options = {}) {
  const value = normalized(key);
  if (!value) {
    blocker(key, message);
    return;
  }

  if (options.validate && !options.validate(value)) {
    blocker(key, options.problem ?? message);
  }
}

function exact(key, expected, message) {
  const value = normalized(key);
  if (!value) {
    return;
  }

  if (value !== expected) {
    blocker(key, message);
  }
}

function oneOf(key, values, message) {
  const value = normalized(key);
  if (!values.includes(value)) {
    blocker(key, message);
  }
}

function minLength(key, length, message) {
  const value = normalized(key);
  if (value && value.length < length) {
    blocker(key, message);
  }
}

function notPlaceholder(key, fragments, message) {
  const value = normalized(key).toLowerCase();
  if (value && fragments.some((fragment) => value.includes(fragment))) {
    blocker(key, message);
  }
}

function httpsUrl(key, message) {
  const parsed = parseUrl(key);
  if (normalized(key) && (!parsed || parsed.protocol !== "https:")) {
    blocker(key, message);
  }
}

function notLocalUrl(key, message) {
  const value = normalized(key);
  if (!value) {
    return;
  }

  if (/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(value)) {
    blocker(key, message);
  }
}

function sameOrigin(leftKey, rightKey, message) {
  const left = parseUrl(leftKey);
  const right = parseUrl(rightKey);
  if (left && right && left.origin !== right.origin) {
    blocker(leftKey, message);
  }
}

function webhookPath(key, expectedPath, message) {
  const parsed = parseUrl(key);
  if (parsed && parsed.pathname !== expectedPath) {
    blocker(key, message);
  }
}

function positiveInteger(key, message) {
  const value = normalized(key);
  const number = Number(value);
  if (value && (!Number.isFinite(number) || number <= 0 || !Number.isInteger(number))) {
    blocker(key, message);
  }
}

function positiveNumber(key, message) {
  const value = normalized(key);
  const number = Number(value);
  if (!value || !Number.isFinite(number) || number <= 0) {
    blocker(key, message);
  }
}

function positiveNumberValue(key) {
  const number = Number(normalized(key));
  return Number.isFinite(number) && number > 0;
}

function optionalBoolean(key) {
  const value = normalized(key).toLowerCase();

  if (!value) {
    return undefined;
  }

  if (["1", "true", "yes", "y", "on"].includes(value)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(value)) {
    return false;
  }

  return undefined;
}

function warnIf(condition, key, message) {
  if (condition) {
    warning(key, message);
  }
}

function blocker(key, message) {
  checks.push({ key, level: "blocker", message });
}

function warning(key, message) {
  checks.push({ key, level: "warning", message });
}

function normalized(key) {
  return process.env[key]?.trim() ?? "";
}

function parseUrl(key) {
  const value = normalized(key);
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    blocker(key, `${key} must be a valid URL.`);
    return null;
  }
}

function publicCheck(check) {
  return {
    key: check.key,
    message: check.message,
  };
}

function printHumanReport(result) {
  console.log(deploymentCheck
    ? "Mint Binder deployment environment validation"
    : "Mint Binder production environment validation");
  console.log(`Generated: ${result.generatedAt}`);
  console.log(`Summary: ${result.summary.blockers} blocker(s), ${result.summary.warnings} warning(s), ${result.summary.reported} reported signal(s).`);
  console.log("");

  if (result.blockers.length) {
    console.log("Blockers");
    for (const entry of result.blockers) {
      console.log(`- ${entry.key}: ${entry.message}`);
    }
    console.log("");
  }

  if (result.warnings.length) {
    console.log("Warnings");
    for (const entry of result.warnings) {
      console.log(`- ${entry.key}: ${entry.message}`);
    }
    console.log("");
  }

  if (result.ok) {
    console.log("Production environment looks ready for staging/launch smoke tests.");
  } else {
    console.log("Production environment is not ready yet. Fix blockers before staging or public launch.");
  }
}
