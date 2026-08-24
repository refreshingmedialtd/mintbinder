export type BillingWebhookProvider = "square" | "stripe";

export function billingWebhookProviderFromHeaders(headers: Pick<Headers, "get">): BillingWebhookProvider | null {
  const square = Boolean(headers.get("x-square-hmacsha256-signature")?.trim());
  const stripe = Boolean(headers.get("stripe-signature")?.trim());

  if (square === stripe) return null;
  return square ? "square" : "stripe";
}
