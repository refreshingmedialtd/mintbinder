import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import type { NotificationPreferences } from "@/lib/types";

type DbNotificationPreference = {
  price_alerts_enabled: boolean;
  wishlist_target_alerts_enabled: boolean;
  weak_price_alerts_enabled: boolean;
  digest_frequency: "off" | "daily" | "weekly";
};

export const defaultNotificationPreferences: NotificationPreferences = {
  priceAlertsEnabled: true,
  wishlistTargetAlertsEnabled: true,
  weakPriceAlertsEnabled: true,
  digestFrequency: "Daily",
};

export type NotificationPreferenceUpdate = Partial<NotificationPreferences>;

export async function ensureNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  return updateNotificationPreferences(userId, {});
}

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const rows = await prisma.$queryRaw<DbNotificationPreference[]>`
      SELECT
        price_alerts_enabled,
        wishlist_target_alerts_enabled,
        weak_price_alerts_enabled,
        digest_frequency
      FROM notification_preferences
      WHERE user_id = ${userId}::uuid
      LIMIT 1
    `.catch((error) => {
      console.warn("Notification preferences unavailable; using defaults.", error);
      return [] as DbNotificationPreference[];
    });

  return rows[0] ? mapNotificationPreferences(rows[0]) : defaultNotificationPreferences;
}

export async function updateNotificationPreferences(
  userId: string,
  input: NotificationPreferenceUpdate,
): Promise<NotificationPreferences> {
  const current = await getNotificationPreferences(userId);
  const next = { ...current, ...input };
  const digestFrequency = digestFrequencyToDb(next.digestFrequency);
  const rows = await prisma.$queryRaw<DbNotificationPreference[]>`
    INSERT INTO notification_preferences (
      id,
      user_id,
      price_alerts_enabled,
      wishlist_target_alerts_enabled,
      weak_price_alerts_enabled,
      digest_frequency,
      updated_at
    )
    VALUES (
      ${randomUUID()}::uuid,
      ${userId}::uuid,
      ${next.priceAlertsEnabled},
      ${next.wishlistTargetAlertsEnabled},
      ${next.weakPriceAlertsEnabled},
      ${digestFrequency}::notification_digest_frequency,
      NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      price_alerts_enabled = EXCLUDED.price_alerts_enabled,
      wishlist_target_alerts_enabled = EXCLUDED.wishlist_target_alerts_enabled,
      weak_price_alerts_enabled = EXCLUDED.weak_price_alerts_enabled,
      digest_frequency = EXCLUDED.digest_frequency,
      updated_at = NOW()
    RETURNING
      price_alerts_enabled,
      wishlist_target_alerts_enabled,
      weak_price_alerts_enabled,
      digest_frequency
  `;

  return rows[0] ? mapNotificationPreferences(rows[0]) : next;
}

function mapNotificationPreferences(preferences: DbNotificationPreference): NotificationPreferences {
  return {
    priceAlertsEnabled: preferences.price_alerts_enabled,
    wishlistTargetAlertsEnabled: preferences.wishlist_target_alerts_enabled,
    weakPriceAlertsEnabled: preferences.weak_price_alerts_enabled,
    digestFrequency: digestFrequencyFromDb(preferences.digest_frequency),
  };
}

function digestFrequencyFromDb(frequency: DbNotificationPreference["digest_frequency"]) {
  if (frequency === "off") {
    return "Off";
  }

  if (frequency === "weekly") {
    return "Weekly";
  }

  return "Daily";
}

function digestFrequencyToDb(frequency: NotificationPreferences["digestFrequency"]) {
  if (frequency === "Off") {
    return "off";
  }

  if (frequency === "Weekly") {
    return "weekly";
  }

  return "daily";
}
