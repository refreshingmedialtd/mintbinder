export type DigestPreferenceInput = {
  priceAlertsEnabled: boolean;
  wishlistTargetAlertsEnabled: boolean;
  weakPriceAlertsEnabled: boolean;
  digestFrequency: "Off" | "Daily" | "Weekly";
};

export type AlertPreferenceInput = {
  category: "Wishlist" | "Price confidence";
};

export function filterPriceAlertsForPreferences<T extends AlertPreferenceInput>(
  alerts: T[],
  preferences: DigestPreferenceInput,
) {
  if (!preferences.priceAlertsEnabled) {
    return [];
  }

  return alerts.filter((alert) => {
    if (alert.category === "Wishlist") {
      return preferences.wishlistTargetAlertsEnabled;
    }

    if (alert.category === "Price confidence") {
      return preferences.weakPriceAlertsEnabled;
    }

    return true;
  });
}

export function shouldSendDigestForFrequency(
  frequency: DigestPreferenceInput["digestFrequency"],
  now = new Date(),
) {
  if (frequency === "Off") {
    return false;
  }

  if (frequency === "Weekly") {
    return now.getUTCDay() === 1;
  }

  return true;
}
