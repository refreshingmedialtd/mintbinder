import { NextResponse } from "next/server";
import { BillingConfigError, billingErrorStatus } from "@/lib/billing/errors";
import { fulfillSquareWebhookEvent, fulfillStripeWebhookEvent } from "@/lib/billing/subscriptions";
import { processBillingWebhookEvent } from "@/lib/billing/webhook-events";
import {
  squareWebhookOccurredAt,
  stripeWebhookOccurredAt,
  type SquareWebhookEvent,
  type StripeWebhookEvent,
  verifySquareWebhookPayload,
  verifyStripeWebhookPayload,
} from "@/lib/billing/webhook-signature";

export async function handleSquareBillingWebhook(request: Request) {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim();

  if (!signatureKey) {
    return NextResponse.json(
      { error: "Square webhook signature key is not configured." },
      { status: billingErrorStatus(new BillingConfigError("Missing Square webhook signature key.")) },
    );
  }

  const payload = await request.text();
  let event: SquareWebhookEvent;

  try {
    event = verifySquareWebhookPayload({
      notificationUrl: squareWebhookNotificationUrl(request),
      payload,
      signatureHeader: request.headers.get("x-square-hmacsha256-signature"),
      signatureKey,
    });
  } catch (error) {
    console.error("Unable to verify Square webhook.", error);
    return NextResponse.json({ error: "Invalid Square webhook." }, { status: 400 });
  }

  try {
    const processing = await processBillingWebhookEvent({
      provider: "square",
      eventId: event.event_id ?? "",
      eventType: event.type,
      occurredAt: squareWebhookOccurredAt(event),
      fulfill: () => fulfillSquareWebhookEvent(event),
    });

    return duplicateOrSuccessResponse("square", processing);
  } catch (error) {
    console.error("Unable to fulfil Square webhook.", error);
    return NextResponse.json({ error: "Unable to process Square webhook." }, { status: 500 });
  }
}

export async function handleStripeBillingWebhook(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook secret is not configured." },
      { status: billingErrorStatus(new BillingConfigError("Missing Stripe webhook secret.")) },
    );
  }

  const payload = await request.text();
  let event: StripeWebhookEvent;

  try {
    event = verifyStripeWebhookPayload({
      payload,
      secret: webhookSecret,
      signatureHeader: request.headers.get("stripe-signature"),
    });
  } catch (error) {
    console.error("Unable to verify Stripe webhook.", error);
    return NextResponse.json({ error: "Invalid Stripe webhook." }, { status: 400 });
  }

  try {
    const processing = await processBillingWebhookEvent({
      provider: "stripe",
      eventId: event.id,
      eventType: event.type,
      occurredAt: stripeWebhookOccurredAt(event),
      fulfill: () => fulfillStripeWebhookEvent(event),
    });

    return duplicateOrSuccessResponse("stripe", processing);
  } catch (error) {
    console.error("Unable to fulfil Stripe webhook.", error);
    return NextResponse.json({ error: "Unable to process Stripe webhook." }, { status: 500 });
  }
}

function duplicateOrSuccessResponse(
  provider: "square" | "stripe",
  processing: {
    duplicate: boolean;
    inProgress?: boolean;
    result?: { handled: boolean; message: string };
  },
) {
  if (processing.duplicate) {
    if (processing.inProgress) {
      return NextResponse.json(
        {
          provider,
          received: true,
          duplicate: true,
          handled: false,
          message: `${provider === "square" ? "Square" : "Stripe"} webhook processing is still in progress; retry later.`,
        },
        { status: 503, headers: { "retry-after": "30" } },
      );
    }

    return NextResponse.json({
      provider,
      received: true,
      duplicate: true,
      handled: false,
      message: `${provider === "square" ? "Square" : "Stripe"} webhook was already processed.`,
    });
  }

  return NextResponse.json({ provider, received: true, duplicate: false, ...processing.result });
}

function squareWebhookNotificationUrl(request: Request) {
  return process.env.SQUARE_WEBHOOK_NOTIFICATION_URL?.trim() || request.url;
}
