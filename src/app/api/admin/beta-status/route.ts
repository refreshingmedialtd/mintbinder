import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canUseOperationsForUser } from "@/lib/auth/roles";
import { catalogueStatus } from "@/lib/jobs/catalogue-status";
import { recentJobRuns } from "@/lib/jobs/runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StatusLevel = "good" | "watch" | "action";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id || !canUseOperationsForUser(session.user.role)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  try {
    const [catalogue, jobRuns] = await Promise.all([
      catalogueStatus(),
      recentJobRuns({ limit: 8 }),
    ]);
    const env = betaEnvironmentSnapshot();

    return NextResponse.json({
      catalogue,
      env,
      generatedAt: new Date().toISOString(),
      jobRuns,
      launchChecks: betaLaunchChecks({ catalogue: catalogue.status, env }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load beta status.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function betaEnvironmentSnapshot() {
  return {
    appUrl: publicValue(process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL),
    authUrl: publicValue(process.env.AUTH_URL),
    billingProvider: publicValue(process.env.BILLING_PROVIDER ?? "square"),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    emailProvider: publicValue(process.env.EMAIL_PROVIDER ?? "smtp"),
    emailSmokeToConfigured: Boolean(process.env.EMAIL_SMOKE_TO),
    jobMonitorDryRun: process.env.JOB_MONITOR_DRY_RUN !== "false",
    jobSecretConfigured: Boolean(process.env.JOB_SECRET),
    priceAlertAllowLiveRecipients: process.env.PRICE_ALERT_DIGEST_ALLOW_LIVE_RECIPIENTS === "true",
    priceAlertDryRun: process.env.PRICE_ALERT_DIGEST_DRY_RUN !== "false",
    squareEnvironment: publicValue(process.env.SQUARE_ENVIRONMENT ?? "sandbox"),
  };
}

function betaLaunchChecks({
  catalogue,
  env,
}: {
  catalogue: Awaited<ReturnType<typeof catalogueStatus>>["status"];
  env: ReturnType<typeof betaEnvironmentSnapshot>;
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
      `${catalogue.cardCount.toLocaleString()} cards, ${formatPercent(catalogue.cardImageCoveragePercent)} image coverage.`,
      "Card catalogue or image coverage needs review.",
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
      env.jobMonitorDryRun,
      "Job monitor is still in dry-run mode.",
      "Job monitor alerting is live.",
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
