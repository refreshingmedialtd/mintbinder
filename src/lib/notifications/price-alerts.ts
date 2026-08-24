import { getAppData } from "@/lib/db/app-data";
import { prisma } from "@/lib/db/prisma";
import { formatMoney } from "@/lib/format";
import { buildCollectionIntelligence, type PriceAlertInsight } from "@/lib/insights";
import { isEmailConfigured, sendEmail } from "@/lib/notifications/email";
import {
  filterPriceAlertsForPreferences,
  shouldSendDigestForFrequency,
} from "@/lib/notifications/preference-filter";
import { effectivePlusAccessWhere } from "@/lib/billing/effective-access";
import { loadRecipientDataFailClosed } from "@/lib/notifications/fail-closed-recipient";
import { deliverNotificationOnce } from "@/lib/notifications/delivery-guard";
import {
  claimPriceAlertDelivery,
  markNotificationDeliveryAmbiguous,
  markNotificationDeliverySent,
  notificationRecipientToken,
} from "@/lib/notifications/delivery-store";

type PriceAlertDigestResult = {
  alerts: number;
  recipientToken: string;
  status: "sent" | "duplicate" | "dry_run" | "skipped" | "failed" | "filtered" | "not_scheduled" | "preferences_off";
  error?: string;
};

type PriceAlertDigestRunResult = {
  dryRun: boolean;
  emailConfigured: boolean;
  results: PriceAlertDigestResult[];
  users: number;
};

export class PriceAlertDigestIncompleteError extends Error {
  resultPayload: PriceAlertDigestRunResult;

  constructor(result: PriceAlertDigestRunResult) {
    const failures = result.results.filter((entry) => entry.status === "failed").length;
    super(`Price-alert digest needs attention: ${failures} recipient delivery or data failure(s).`);
    this.name = "PriceAlertDigestIncompleteError";
    this.resultPayload = result;
  }
}

export function assertPriceAlertDigestHealthy(result: PriceAlertDigestRunResult) {
  if (result.results.some((entry) => entry.status === "failed")) {
    throw new PriceAlertDigestIncompleteError(result);
  }
  return result;
}

export async function sendPriceAlertDigests({
  dryRun = false,
  now = new Date(),
  testRecipient,
}: {
  dryRun?: boolean;
  now?: Date;
  testRecipient?: string;
} = {}) {
  const testRecipientEmail = optionalEmail(testRecipient, "Price alert digest test recipient");
  const users = await prisma.user.findMany({
    where: {
      email: { not: "" },
      emailVerifiedAt: { not: null },
      subscriptions: {
        some: {
          ...effectivePlusAccessWhere(now),
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
    const deliveryEmail = testRecipientEmail ?? user.email;
    const periodKey = dateStamp(now);
    const recipientToken = notificationRecipientToken({
      periodKey,
      recipient: deliveryEmail,
      userId: user.id,
    });
    const processed = await loadRecipientDataFailClosed({
      load: () =>
        getAppData(user.id, {
          catalogueScope: "referenced",
          fallback: "throw",
        }),
      process: async (data) => {
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
            recipientToken,
            status: "preferences_off",
          });
          return;
        }

        if (!shouldSendDigestForFrequency(data.notificationPreferences.digestFrequency, now)) {
          results.push({
            alerts: alerts.length,
            recipientToken,
            status: "not_scheduled",
          });
          return;
        }

        if (!alerts.length) {
          results.push({
            alerts: intelligence.priceAlerts.length,
            recipientToken,
            status: intelligence.priceAlerts.length ? "filtered" : "skipped",
          });
          return;
        }

        if (dryRun || !emailReady) {
          results.push({
            alerts: alerts.length,
            recipientToken,
            status: "dry_run",
          });
          return;
        }

        const email = buildPriceAlertDigestEmail({
          alerts,
          ownerName: user.displayName ?? "Collector",
        });
        let deliveryId: string | undefined;
        const delivery = await deliverNotificationOnce({
          claim: async () => {
            const claimed = await claimPriceAlertDelivery({
              periodKey,
              recipient: deliveryEmail,
              userId: user.id,
            });
            deliveryId = claimed?.id;
            return Boolean(claimed);
          },
          markAmbiguous: async (error) => {
            if (deliveryId) await markNotificationDeliveryAmbiguous(deliveryId, error);
          },
          markSent: async (sent) => {
            if (!deliveryId) throw new Error("Notification delivery claim was lost.");
            await markNotificationDeliverySent(deliveryId, sent.id);
          },
          send: () => sendEmail({
            ...email,
            idempotencyKey: `price-alerts-${recipientToken}-${periodKey}`,
            to: deliveryEmail,
          }),
        });

        if (delivery.status === "duplicate") {
          results.push({ alerts: alerts.length, recipientToken, status: "duplicate" });
          return;
        }
        if (delivery.status === "ambiguous") {
          console.error(`Price-alert delivery ${recipientToken} has an ambiguous outcome.`, delivery.error);
          results.push({
            alerts: alerts.length,
            recipientToken,
            error: "The email provider outcome was ambiguous; automatic retry is suppressed.",
            status: "failed",
          });
          return;
        }

        results.push({ alerts: alerts.length, recipientToken, status: "sent" });
      },
    });

    if (!processed.ok) {
      results.push({
        alerts: 0,
        recipientToken,
        error: "Recipient data could not be loaded or processed safely.",
        status: "failed",
      });
      console.error(`Price-alert recipient ${recipientToken} failed before delivery.`, processed.error);
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
        <td>${escapeHtml(alert.explanation)}</td>
        <td>${escapeHtml(formatMoney(alert.currentValueMinor))}</td>
        <td>${escapeHtml(alert.targetValueMinor === undefined ? "-" : formatMoney(alert.targetValueMinor))}</td>
      </tr>`,
    )
    .join("");
  const text = [
    `Hi ${ownerName},`,
    "",
    "Your Mint Binder price watchlist has new items to review:",
    ...alerts.map(
      (alert) =>
        `- ${alert.status}: ${alert.itemName} (${formatMoney(alert.currentValueMinor)}) - ${alert.explanation}`,
    ),
    "",
    "Open Mint Binder to review your wishlist and price-confidence alerts.",
  ].join("\n");

  return {
    html: `<!doctype html>
<html lang="en">
<body style="color:#171717;font-family:Arial,sans-serif;margin:0;padding:24px;">
  <h1 style="margin:0 0 8px;">Price alerts are ready</h1>
  <p style="color:#626b77;">Hi ${escapeHtml(ownerName)}, your Mint Binder watchlist has ${alerts.length} item${alerts.length === 1 ? "" : "s"} to review.</p>
  <table style="border-collapse:collapse;width:100%;">
    <thead>
      <tr>
        <th align="left" style="border-bottom:1px solid #e5e7eb;padding:8px;">Status</th>
        <th align="left" style="border-bottom:1px solid #e5e7eb;padding:8px;">Item</th>
        <th align="left" style="border-bottom:1px solid #e5e7eb;padding:8px;">Type</th>
        <th align="left" style="border-bottom:1px solid #e5e7eb;padding:8px;">Reason</th>
        <th align="left" style="border-bottom:1px solid #e5e7eb;padding:8px;">Current</th>
        <th align="left" style="border-bottom:1px solid #e5e7eb;padding:8px;">Target</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`,
    subject: `Mint Binder price alerts: ${alerts.length} to review`,
    text,
  };
}

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function optionalEmail(value: string | undefined, label: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error(`${label} must be a valid email address.`);
  }

  return trimmed;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
