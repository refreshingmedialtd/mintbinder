import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getStripeCustomer } from "@/lib/billing/customers";
import { billingErrorStatus, createStripePortalSession } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const customerId = await getStripeCustomer(session.user.id);

    if (!customerId) {
      return NextResponse.json({ error: "No Stripe customer found. Start checkout first." }, { status: 400 });
    }

    const portalSession = await createStripePortalSession({
      customerId,
      origin: requestOrigin(request),
    });

    if (!portalSession.url) {
      throw new Error("Stripe did not return a billing portal URL.");
    }

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open billing portal.";

    return NextResponse.json({ error: message }, { status: billingErrorStatus(error) });
  }
}

function requestOrigin(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
}
