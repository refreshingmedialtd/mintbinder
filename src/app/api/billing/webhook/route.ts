import { NextResponse } from "next/server";
import { BillingConfigError, billingErrorStatus } from "@/lib/billing/errors";
import { activeBillingProvider } from "@/lib/billing/provider";
import { fulfillSquareWebhookEvent, fulfillStripeWebhookEvent } from "@/lib/billing/subscriptions";
import { verifySquareWebhookPayload, verifyStripeWebhookPayload } from "@/lib/billing/webhook-signature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const provider = activeBillingProvider();

  if (provider === "square") {
    return handleSquareWebhook(request);
  }

  return handleStripeWebhook(request);
}

async function handleSquareWebhook(request: Request) {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim();

  if (!signatureKey) {
    return NextResponse.json(
      { error: "Square webhook signature key is not configured." },
      { status: billingErrorStatus(new BillingConfigError("Missing Square webhook signature key.")) },
    );
  }

  const payload = await request.text();

  try {
    const event = verifySquareWebhookPayload({
      notificationUrl: squareWebhookNotificationUrl(request),
      payload,
      signatureHeader: request.headers.get("x-square-hmacsha256-signature"),
      signatureKey,
    });
    const result = await fulfillSquareWebhookEvent(event);

    return NextResponse.json({ provider: "square", received: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Square webhook.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function handleStripeWebhook(request: Request) {
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

    return NextResponse.json({ provider: "stripe", received: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Stripe webhook.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function squareWebhookNotificationUrl(request: Request) {
  return process.env.SQUARE_WEBHOOK_NOTIFICATION_URL?.trim() || request.url;
}
