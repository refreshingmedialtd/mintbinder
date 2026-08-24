import { NextResponse } from "next/server";
import {
  handleSquareBillingWebhook,
  handleStripeBillingWebhook,
} from "@/lib/billing/webhook-route";
import { billingWebhookProviderFromHeaders } from "@/lib/billing/webhook-provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Transitional endpoint: dispatch from the provider's signed header, never
// from BILLING_PROVIDER. New provider subscriptions should use the stable
// provider-specific routes below this endpoint.
export async function POST(request: Request) {
  const provider = billingWebhookProviderFromHeaders(request.headers);

  if (provider === "square") return handleSquareBillingWebhook(request);
  if (provider === "stripe") return handleStripeBillingWebhook(request);

  return NextResponse.json(
    { error: "Webhook provider signature is missing or ambiguous." },
    { status: 400 },
  );
}
