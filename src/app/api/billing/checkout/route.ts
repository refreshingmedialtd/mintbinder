import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrCreateBillingCustomer } from "@/lib/billing/customers";
import { billingErrorStatus } from "@/lib/billing/errors";
import { activeBillingProvider } from "@/lib/billing/provider";
import { createSquareSubscriptionCheckout } from "@/lib/billing/square";
import {
  createStripeCheckoutSession,
} from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({})) as { plan?: string };
    const plan = body.plan === "yearly" ? "yearly" : "monthly";
    const customerId = await getOrCreateBillingCustomer({
      email: session.user.email,
      name: session.user.name,
      userId: session.user.id,
    });
    const provider = activeBillingProvider();
    const checkoutSession =
      provider === "square"
        ? await createSquareSubscriptionCheckout({
            customerId,
            email: session.user.email,
            origin: requestOrigin(request),
            plan,
            userId: session.user.id,
          })
        : await createStripeCheckoutSession({
            customerId,
            origin: requestOrigin(request),
            plan,
            userId: session.user.id,
          });

    if (!checkoutSession.url) {
      throw new Error(`${provider === "square" ? "Square" : "Stripe"} did not return a checkout URL.`);
    }

    return NextResponse.json({ provider, url: checkoutSession.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start checkout.";

    return NextResponse.json({ error: message }, { status: billingErrorStatus(error) });
  }
}

function requestOrigin(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
}
