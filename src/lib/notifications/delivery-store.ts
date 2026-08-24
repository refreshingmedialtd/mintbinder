import { createHmac } from "node:crypto";
import { NotificationDeliveryStatus, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.ts";
import { requiredAuthSecret } from "../auth/secret.ts";

const PRICE_ALERT_KIND = "price_alert_digest";

export function notificationRecipientToken({
  periodKey,
  recipient,
  secret = requiredAuthSecret(),
  userId,
}: {
  periodKey: string;
  recipient: string;
  secret?: string;
  userId: string;
}) {
  return hmacToken(
    secret,
    `delivery\0${userId}\0${recipient.trim().toLowerCase()}\0${periodKey}`,
  ).slice(0, 24);
}

export class NotificationDeliveryUnresolvedError extends Error {
  ageSeconds: number;
  deliveryStatus: NotificationDeliveryStatus;

  constructor(status: NotificationDeliveryStatus, updatedAt: Date, now = new Date()) {
    const ageSeconds = Math.max(0, Math.floor((now.getTime() - updatedAt.getTime()) / 1_000));
    super(
      `A previous notification delivery remains ${status.toLowerCase()} after ${ageSeconds} seconds and requires reconciliation.`,
    );
    this.name = "NotificationDeliveryUnresolvedError";
    this.ageSeconds = ageSeconds;
    this.deliveryStatus = status;
  }
}

export async function claimPriceAlertDelivery({
  periodKey,
  recipient,
  userId,
}: {
  periodKey: string;
  recipient: string;
  userId: string;
}) {
  const secret = requiredAuthSecret();
  const recipientKey = notificationRecipientToken({
    periodKey,
    recipient,
    secret,
    userId,
  });

  try {
    return await prisma.notificationDelivery.create({
      data: {
        kind: PRICE_ALERT_KIND,
        periodKey,
        recipientKey,
        status: NotificationDeliveryStatus.CLAIMED,
        userId,
      },
      select: { id: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.notificationDelivery.findUnique({
        where: {
          kind_periodKey_recipientKey: {
            kind: PRICE_ALERT_KIND,
            periodKey,
            recipientKey,
          },
        },
        select: { status: true, updatedAt: true },
      });

      if (existing?.status === NotificationDeliveryStatus.SENT) return null;
      if (existing) {
        throw new NotificationDeliveryUnresolvedError(existing.status, existing.updatedAt);
      }
    }
    throw error;
  }
}

export async function markNotificationDeliverySent(id: string, providerMessageId?: string) {
  const updated = await prisma.notificationDelivery.updateMany({
    where: { id, status: NotificationDeliveryStatus.CLAIMED },
    data: {
      providerMessageId: providerMessageId?.trim().slice(0, 255) || null,
      sentAt: new Date(),
      status: NotificationDeliveryStatus.SENT,
    },
  });
  if (updated.count !== 1) throw new Error("Notification delivery claim could not be completed safely.");
}

export async function markNotificationDeliveryAmbiguous(id: string, error: unknown) {
  await prisma.notificationDelivery.updateMany({
    where: { id, status: NotificationDeliveryStatus.CLAIMED },
    data: {
      errorCode: error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
      ambiguousAt: new Date(),
      status: NotificationDeliveryStatus.AMBIGUOUS,
    },
  });
}

function hmacToken(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}
