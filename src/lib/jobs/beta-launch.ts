type StatusLevel = "good" | "watch" | "action";

type BetaCatalogueStatus = {
  cardCount: number;
  cardImageCoveragePercent: number | null;
  pricingCoveragePercent: number | null;
  sealedPricingCoveragePercent: number | null;
};

export type BetaEnvironmentSnapshot = {
  appUrl: string;
  authUrl: string;
  billingProvider: string;
  databaseConfigured: boolean;
  emailProvider: string;
  emailSmokeToConfigured: boolean;
  jobMonitorAlertToConfigured: boolean;
  jobMonitorDryRun: boolean;
  jobSecretConfigured: boolean;
  priceAlertAllowLiveRecipients: boolean;
  priceAlertDryRun: boolean;
  squareEnvironment: string;
};

export function betaEnvironmentSnapshot(
  env: Record<string, string | undefined> = process.env,
): BetaEnvironmentSnapshot {
  return {
    appUrl: publicValue(env.NEXT_PUBLIC_APP_URL || env.AUTH_URL),
    authUrl: publicValue(env.AUTH_URL),
    billingProvider: publicValue(env.BILLING_PROVIDER ?? "square"),
    databaseConfigured: Boolean(env.DATABASE_URL?.trim()),
    emailProvider: publicValue(env.EMAIL_PROVIDER ?? "smtp"),
    emailSmokeToConfigured: Boolean(env.EMAIL_SMOKE_TO?.trim()),
    jobMonitorAlertToConfigured: Boolean(
      env.JOB_MONITOR_ALERT_TO?.trim() || env.EMAIL_SMOKE_TO?.trim(),
    ),
    jobMonitorDryRun: env.JOB_MONITOR_DRY_RUN?.trim().toLowerCase() !== "false",
    jobSecretConfigured: Boolean(env.JOB_SECRET?.trim()),
    priceAlertAllowLiveRecipients:
      env.PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS?.trim().toLowerCase() === "true",
    priceAlertDryRun: env.PRICE_ALERT_DIGEST_DRY_RUN?.trim().toLowerCase() !== "false",
    squareEnvironment: publicValue(env.SQUARE_ENVIRONMENT ?? "sandbox"),
  };
}

export function betaLaunchChecks({
  catalogue,
  env,
}: {
  catalogue: BetaCatalogueStatus;
  env: BetaEnvironmentSnapshot;
}) {
  return [
    check(
      "Database",
      env.databaseConfigured,
      "Database connection is configured.",
      "DATABASE_URL is missing.",
    ),
    check(
      "Job protection",
      env.jobSecretConfigured,
      "Protected job routes have a job secret.",
      "JOB_SECRET is missing.",
    ),
    check(
      "Card catalogue",
      catalogue.cardCount >= 20000 && catalogue.cardImageCoveragePercent === 100,
      `${catalogue.cardCount.toLocaleString()} cards, ${formatPercent(catalogue.cardImageCoveragePercent)} image URL coverage.`,
      "Card catalogue or image URL coverage needs review.",
    ),
    check(
      "Card pricing",
      (catalogue.pricingCoveragePercent ?? 0) >= 90,
      `${formatPercent(catalogue.pricingCoveragePercent)} card pricing coverage.`,
      "Card pricing coverage is below the beta target.",
    ),
    check(
      "Sealed pricing",
      (catalogue.sealedPricingCoveragePercent ?? 0) >= 75,
      `${formatPercent(catalogue.sealedPricingCoveragePercent)} sealed pricing coverage.`,
      "Sealed pricing is below the current beta baseline.",
      "watch",
    ),
    check(
      "Billing mode",
      env.squareEnvironment === "production",
      `Square mode is ${env.squareEnvironment}.`,
      "Square is not in production mode yet.",
      "watch",
    ),
    check(
      "Email safety",
      env.priceAlertDryRun && !env.priceAlertAllowLiveRecipients,
      "Price-alert recipient emails are safely disabled.",
      "Live price-alert recipient emails are enabled.",
      "watch",
    ),
    check(
      "Monitoring",
      !env.jobMonitorDryRun && env.jobMonitorAlertToConfigured,
      "Job-monitor alerting is live and has a recipient.",
      env.jobMonitorDryRun
        ? "Job-monitor alerting is still in dry-run mode."
        : "Job-monitor alerting has no recipient.",
      "watch",
    ),
  ];
}

function check(
  label: string,
  passed: boolean,
  good: string,
  bad: string,
  failedLevel: StatusLevel = "action",
) {
  return {
    detail: passed ? good : bad,
    label,
    level: passed ? "good" as const : failedLevel,
    passed,
  };
}

function publicValue(value?: string | null) {
  return value?.trim() || "not configured";
}

function formatPercent(value: number | null) {
  return value === null ? "unknown" : `${value}%`;
}
