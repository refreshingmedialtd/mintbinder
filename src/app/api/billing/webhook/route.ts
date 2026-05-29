import { NextResponse } from "next/server";
import { fulfillStripeWebhookEvent } from "@/lib/billing/subscriptions";
import { verifyStripeWebhookPayload } from "@/lib/billing/webhook-signature";
import { BillingConfigError, billingErrorStatus } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook secret is not configured." },
      { status: billingErrorStatus(new BillingConfigError("Missing Stripe webhook secret.")) },
    );
  }

  const payload = await request.text();

  try {
    const event = verifyStripeWebhookPayload({
      payload,
      secret: webhookSecret,
      signatureHeader: request.headers.get("stripe-signature"),
    });
    const result = await fulfillStripeWebhookEvent(event);

    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Stripe webhook.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
