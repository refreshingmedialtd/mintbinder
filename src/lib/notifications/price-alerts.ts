import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { getAppData } from "@/lib/db/app-data";
import { prisma } from "@/lib/db/prisma";
import { formatMoney } from "@/lib/format";
import { buildCollectionIntelligence, type PriceAlertInsight } from "@/lib/insights";
import { isEmailConfigured, sendEmail } from "@/lib/notifications/email";
import {
  filterPriceAlertsForPreferences,
  shouldSendDigestForFrequency,
} from "@/lib/notifications/preference-filter";

type PriceAlertDigestResult = {
  alerts: number;
  emailId?: string;
  email: string;
  status: "sent" | "dry_run" | "skipped" | "failed" | "filtered" | "not_scheduled" | "preferences_off";
  userId: string;
  error?: string;
};

export async function sendPriceAlertDigests({
  dryRun = false,
  now = new Date(),
}: {
  dryRun?: boolean;
  now?: Date;
} = {}) {
  const users = await prisma.user.findMany({
    where: {
      email: { not: "" },
      subscriptions: {
        some: {
          plan: { in: [SubscriptionPlan.PLUS_MONTHLY, SubscriptionPlan.PLUS_YEARLY] },
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        },
      },
    },
    select: {
      displayName: true,
      email: true,
      id: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const emailReady = isEmailConfigured();
  const results: PriceAlertDigestResult[] = [];

  for (const user of users) {
    const data = await getAppData(user.id);
    const intelligence = buildCollectionIntelligence({
      catalogueById: new Map(data.catalogue.map((item) => [item.id, item])),
      collection: data.collection,
      events: data.events,
      sets: data.sets,
      storageLocations: data.storageLocations,
      wishlist: data.wishlist,
    });
    const alerts = filterPriceAlertsForPreferences(
      intelligence.priceAlerts,
      data.notificationPreferences,
    );

    if (data.notificationPreferences.digestFrequency === "Off") {
      results.push({
        alerts: 0,
        email: user.email,
        status: "preferences_off",
        userId: user.id,
      });
      continue;
    }

    if (!shouldSendDigestForFrequency(data.notificationPreferences.digestFrequency, now)) {
      results.push({
        alerts: alerts.length,
        email: user.email,
        status: "not_scheduled",
        userId: user.id,
      });
      continue;
    }

    if (!alerts.length) {
      results.push({
        alerts: intelligence.priceAlerts.length,
        email: user.email,
        status: intelligence.priceAlerts.length ? "filtered" : "skipped",
        userId: user.id,
      });
      continue;
    }

    if (dryRun || !emailReady) {
      results.push({
        alerts: alerts.length,
        email: user.email,
        status: "dry_run",
        userId: user.id,
      });
      continue;
    }

    try {
      const email = buildPriceAlertDigestEmail({
        alerts,
        ownerName: user.displayName ?? "Collector",
      });
      const sent = await sendEmail({
        ...email,
        idempotencyKey: `price-alerts-${user.id}-${dateStamp()}`,
        to: user.email,
      });

      results.push({
        alerts: alerts.length,
        email: user.email,
        emailId: sent.id,
        status: "sent",
        userId: user.id,
      });
    } catch (error) {
      results.push({
        alerts: alerts.length,
        email: user.email,
        error: error instanceof Error ? error.message : "Unknown email error.",
        status: "failed",
        userId: user.id,
      });
    }
  }

  return {
    dryRun: dryRun || !emailReady,
    emailConfigured: emailReady,
    results,
    users: users.length,
  };
}

function buildPriceAlertDigestEmail({
  alerts,
  ownerName,
}: {
  alerts: PriceAlertInsight[];
  ownerName: string;
}) {
  const rows = alerts
    .map(
      (alert) => `<tr>
        <td>${escapeHtml(alert.status)}</td>
        <td>${escapeHtml(alert.itemName)}</td>
        <td>${escapeHtml(alert.category)}</td>
        <td>${escapeHtml(formatMoney(alert.currentValueMinor))}</td>
        <td>${escapeHtml(alert.targetValueMinor === undefined ? "-" : formatMoney(alert.targetValueMinor))}</td>
      </tr>`,
    )
    .join("");
  const text = [
    `Hi ${ownerName},`,
    "",
    "Your PokeStop price watchlist has new items to review:",
    ...alerts.map((alert) => `- ${alert.status}: ${alert.itemName} (${formatMoney(alert.currentValueMinor)})`),
    "",
    "Open PokeStop to review your wishlist and price-confidence alerts.",
  ].join("\n");

  return {
    html: `<!doctype html>
<html lang="en">
<body style="color:#171717;font-family:Arial,sans-serif;margin:0;padding:24px;">
  <h1 style="margin:0 0 8px;">Price alerts are ready</h1>
  <p style="color:#626b77;">Hi ${escapeHtml(ownerName)}, your PokeStop watchlist has ${alerts.length} item${alerts.length === 1 ? "" : "s"} to review.</p>
  <table style="border-collapse:collapse;width:100%;">
    <thead>
      <tr>
        <th align="left" style="border-bottom:1px solid #e5e7eb;padding:8px;">Status</th>
        <th align="left" style="border-bottom:1px solid #e5e7eb;padding:8px;">Item</th>
        <th align="left" style="border-bottom:1px solid #e5e7eb;padding:8px;">Type</th>
        <th align="left" style="border-bottom:1px solid #e5e7eb;padding:8px;">Current</th>
        <th align="left" style="border-bottom:1px solid #e5e7eb;padding:8px;">Target</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`,
    subject: `PokeStop price alerts: ${alerts.length} to review`,
    text,
  };
}

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
