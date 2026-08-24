export function billingProviderLifecycleSettings(env = process.env) {
  const checkoutProvider = String(env.BILLING_PROVIDER ?? "").trim().toLowerCase() || "square";

  return {
    checkoutProvider,
    squareWebhookEnabled: checkoutProvider === "square" || enabled(env.SQUARE_WEBHOOK_ENABLED),
    stripeWebhookEnabled: checkoutProvider === "stripe" || enabled(env.STRIPE_WEBHOOK_ENABLED),
  };
}

export function authAndJobSecretsAreIndependent(env = process.env) {
  const authSecret = String(env.AUTH_SECRET ?? "").trim();
  const jobSecret = String(env.JOB_SECRET ?? "").trim();

  return !authSecret || !jobSecret || authSecret !== jobSecret;
}

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}
