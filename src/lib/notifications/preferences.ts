import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.ts";
import type { NotificationPreferences } from "../types.ts";

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

type NotificationPreferenceQueryClient = Pick<typeof prisma, "$queryRaw">;

type NotificationPreferenceOptions = {
  client?: NotificationPreferenceQueryClient;
};

export class NotificationPreferenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationPreferenceValidationError";
  }
}

export async function ensureNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  return updateNotificationPreferences(userId, {});
}

export async function getNotificationPreferences(
  userId: string,
  {
    client = prisma,
    fallback = "throw",
  }: NotificationPreferenceOptions & { fallback?: "default" | "throw" } = {},
): Promise<NotificationPreferences> {
  const query = client.$queryRaw<DbNotificationPreference[]>`
      SELECT
        price_alerts_enabled,
        wishlist_target_alerts_enabled,
        weak_price_alerts_enabled,
        digest_frequency
      FROM notification_preferences
      WHERE user_id = ${userId}::uuid
      LIMIT 1
    `;
  const rows = fallback === "throw"
    ? await query
    : await query.catch((error) => {
      console.warn("Notification preferences unavailable; using defaults.", error);
      return [] as DbNotificationPreference[];
    });

  return rows[0] ? mapNotificationPreferences(rows[0]) : defaultNotificationPreferences;
}

export async function updateNotificationPreferences(
  userId: string,
  input: unknown,
  { client = prisma }: NotificationPreferenceOptions = {},
): Promise<NotificationPreferences> {
  const update = normalizeNotificationPreferenceUpdate(input);
  const rows = await client.$queryRaw<DbNotificationPreference[]>`
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
      ${update.priceAlertsEnabled.value},
      ${update.wishlistTargetAlertsEnabled.value},
      ${update.weakPriceAlertsEnabled.value},
      ${update.digestFrequency.value}::notification_digest_frequency,
      NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      price_alerts_enabled = CASE
        WHEN ${update.priceAlertsEnabled.provided}
        THEN EXCLUDED.price_alerts_enabled
        ELSE notification_preferences.price_alerts_enabled
      END,
      wishlist_target_alerts_enabled = CASE
        WHEN ${update.wishlistTargetAlertsEnabled.provided}
        THEN EXCLUDED.wishlist_target_alerts_enabled
        ELSE notification_preferences.wishlist_target_alerts_enabled
      END,
      weak_price_alerts_enabled = CASE
        WHEN ${update.weakPriceAlertsEnabled.provided}
        THEN EXCLUDED.weak_price_alerts_enabled
        ELSE notification_preferences.weak_price_alerts_enabled
      END,
      digest_frequency = CASE
        WHEN ${update.digestFrequency.provided}
        THEN EXCLUDED.digest_frequency
        ELSE notification_preferences.digest_frequency
      END,
      updated_at = NOW()
    RETURNING
      price_alerts_enabled,
      wishlist_target_alerts_enabled,
      weak_price_alerts_enabled,
      digest_frequency
  `;

  if (!rows[0]) {
    throw new Error("Notification preference update did not return a row.");
  }

  return mapNotificationPreferences(rows[0]);
}

function normalizeNotificationPreferenceUpdate(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new NotificationPreferenceValidationError("Notification preferences must be an object.");
  }

  const value = input as Record<string, unknown>;

  return {
    digestFrequency: normalizeDigestUpdate(value),
    priceAlertsEnabled: normalizeBooleanUpdate(value, "priceAlertsEnabled", defaultNotificationPreferences.priceAlertsEnabled),
    weakPriceAlertsEnabled: normalizeBooleanUpdate(
      value,
      "weakPriceAlertsEnabled",
      defaultNotificationPreferences.weakPriceAlertsEnabled,
    ),
    wishlistTargetAlertsEnabled: normalizeBooleanUpdate(
      value,
      "wishlistTargetAlertsEnabled",
      defaultNotificationPreferences.wishlistTargetAlertsEnabled,
    ),
  };
}

function normalizeBooleanUpdate(
  input: Record<string, unknown>,
  field: keyof Pick<
    NotificationPreferences,
    "priceAlertsEnabled" | "weakPriceAlertsEnabled" | "wishlistTargetAlertsEnabled"
  >,
  defaultValue: boolean,
) {
  const provided = Object.prototype.hasOwnProperty.call(input, field);
  const value = provided ? input[field] : defaultValue;

  if (typeof value !== "boolean") {
    throw new NotificationPreferenceValidationError(`${field} must be a boolean.`);
  }

  return { provided, value };
}

function normalizeDigestUpdate(input: Record<string, unknown>) {
  const provided = Object.prototype.hasOwnProperty.call(input, "digestFrequency");
  const value = provided ? input.digestFrequency : defaultNotificationPreferences.digestFrequency;

  if (value !== "Off" && value !== "Daily" && value !== "Weekly") {
    throw new NotificationPreferenceValidationError("digestFrequency must be Off, Daily, or Weekly.");
  }

  return { provided, value: digestFrequencyToDb(value) };
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
