export type BillingProvider = "square" | "stripe";

export function activeBillingProvider(): BillingProvider {
  const provider = process.env.BILLING_PROVIDER?.trim().toLowerCase();

  if (provider === "stripe" || provider === "square") {
    return provider;
  }

  return "square";
}

export function billingProviderLabel(provider: BillingProvider = activeBillingProvider()) {
  return provider === "square" ? "Square" : "Stripe";
}
