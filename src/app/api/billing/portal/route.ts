import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { accountMutationGuard } from "@/lib/auth/mutation-guard";
import { getBillingCustomer } from "@/lib/billing/customers";
import { billingErrorStatus } from "@/lib/billing/errors";
import { activeBillingProvider } from "@/lib/billing/provider";
import { getCurrentBillingSubscription } from "@/lib/billing/subscription-management";
import { createStripePortalSession } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const mutationError = await accountMutationGuard({
      isEmailVerified: session.user.isEmailVerified, request, userId: session.user.id,
    });
    if (mutationError) return mutationError;

    const provider = activeBillingProvider();
    const customerId = await getBillingCustomer(session.user.id);

    if (!customerId) {
      return NextResponse.json({ error: "No billing customer found. Start checkout first." }, { status: 400 });
    }

    if (provider === "square") {
      const manageUrl = process.env.SQUARE_CUSTOMER_PORTAL_URL?.trim();

      if (manageUrl) {
        return NextResponse.json({ provider, url: manageUrl });
      }

      return NextResponse.json({
        message: "Square billing is managed in Mint Binder during beta.",
        provider,
        subscription: await getCurrentBillingSubscription(session.user.id),
      });
    }

    const portalSession = await createStripePortalSession({
      customerId,
      origin: requestOrigin(request),
    });

    if (!portalSession.url) {
      throw new Error("Stripe did not return a billing portal URL.");
    }

    return NextResponse.json({ provider, url: portalSession.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open billing portal.";

    return NextResponse.json({ error: message }, { status: billingErrorStatus(error) });
  }
}

function requestOrigin(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
}
