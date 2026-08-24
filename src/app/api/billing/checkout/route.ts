import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrCreateBillingCustomer } from "@/lib/billing/customers";
import { BillingConfigError, billingErrorStatus } from "@/lib/billing/errors";
import { activeBillingProvider } from "@/lib/billing/provider";
import {
  BillingCheckoutConflictError,
  assertBillingCheckoutIntentAvailable,
  beginBillingCheckoutRetirement,
  claimBillingCheckoutIntent,
  completeBillingCheckoutIntent,
  completeBillingCheckoutRetirement,
  failBillingCheckoutIntent,
  markBillingCheckoutIntentRecoverable,
  retireProviderCheckout,
} from "@/lib/billing/checkout-intents";
import {
  createSquareSubscriptionCheckout,
  searchSquareSubscriptions,
  squareCheckoutExpectation,
} from "@/lib/billing/square";
import { squareSubscriptionBlocksCheckout } from "@/lib/billing/subscription-safety";
import {
  createStripeCheckoutSession,
  stripeCheckoutPriceId,
} from "@/lib/billing/stripe";
import { BillingAccountDeletionError } from "@/lib/billing/checkout-lock";
import { accountMutationGuard } from "@/lib/auth/mutation-guard";
import {
  ProviderSubscriptionStillActiveError,
  reconcileExpiredScheduledCancellations,
} from "@/lib/billing/scheduled-cancellation-reconciliation";

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

    const body = await request.json().catch(() => ({})) as { plan?: string };
    const plan = body.plan === "yearly" ? "yearly" : "monthly";
    const provider = activeBillingProvider();
    const origin = requestOrigin(request);
    if (provider === "square" && process.env.SQUARE_PAYMENT_CORRELATION_VERIFIED?.trim().toLowerCase() !== "true") {
      throw new BillingConfigError(
        "Square checkout is disabled until payment.updated correlation has passed the documented sandbox smoke test.",
      );
    }
    await reconcileExpiredScheduledCancellations({ userId: session.user.id });
    const expectation = provider === "square"
      ? squareCheckoutExpectation(plan)
      : { planVariationId: stripeCheckoutPriceId(plan) };

    let intent = await claimBillingCheckoutIntent({
      expectation,
      origin,
      plan,
      provider,
      userId: session.user.id,
    });

    if (intent.kind === "retire") {
      await retireProviderCheckout(intent.provider, intent.providerCheckoutId, intent.providerOrderId);
      await completeBillingCheckoutRetirement(intent.id, intent.idempotencyKey);
      intent = await claimBillingCheckoutIntent({
        expectation,
        origin,
        plan,
        provider,
        userId: session.user.id,
      });
    }

    if (intent.kind === "retire") {
      throw new BillingCheckoutConflictError("The previous checkout could not be retired safely.");
    }

    if (intent.kind === "reuse") {
      if (provider === "square") {
        const customerId = await getOrCreateBillingCustomer({
          email: session.user.email,
          idempotencyKey: intent.idempotencyKey,
          name: session.user.name,
          userId: session.user.id,
        });
        const remoteSubscriptions = await searchSquareSubscriptions(customerId);

        if (remoteSubscriptions.some(squareSubscriptionBlocksCheckout)) {
          await beginBillingCheckoutRetirement(intent.id, intent.idempotencyKey);
          await retireProviderCheckout(intent.provider, intent.providerCheckoutId, intent.providerOrderId);
          await completeBillingCheckoutRetirement(intent.id, intent.idempotencyKey);
          throw new BillingCheckoutConflictError(
            "A Square subscription already exists for this account. Use Billing or contact support before starting another checkout.",
          );
        }
      }

      return NextResponse.json({ provider, reused: true, url: intent.url });
    }

    try {
      const customerId = await getOrCreateBillingCustomer({
        email: session.user.email,
        idempotencyKey: intent.idempotencyKey,
        name: session.user.name,
        userId: session.user.id,
      });

      if (provider === "square") {
        const remoteSubscriptions = await searchSquareSubscriptions(customerId);

        if (remoteSubscriptions.some(squareSubscriptionBlocksCheckout)) {
          throw new BillingCheckoutConflictError(
            "A Square subscription already exists for this account. Use Billing or contact support before starting another checkout.",
          );
        }
      }

      await assertBillingCheckoutIntentAvailable({
        customerId,
        id: intent.id,
        idempotencyKey: intent.idempotencyKey,
        leaseToken: intent.leaseToken,
        provider,
        userId: session.user.id,
      });

      const checkoutSession =
        provider === "square"
          ? await createSquareSubscriptionCheckout({
              email: session.user.email,
              expectation: squareExpectationFromIntent(intent),
              idempotencyKey: intent.idempotencyKey,
              origin: intent.checkoutOrigin,
              plan,
            })
          : await createStripeCheckoutSession({
              checkoutIntentId: intent.id,
              customerId,
              idempotencyKey: intent.idempotencyKey,
              origin: intent.checkoutOrigin,
              plan,
              priceId: stripePriceFromIntent(intent),
              userId: session.user.id,
            });

      if (!checkoutSession.url) {
        throw new Error(`${provider === "square" ? "Square" : "Stripe"} did not return a checkout URL.`);
      }
      const providerOrderId = "orderId" in checkoutSession ? checkoutSession.orderId : undefined;

      const completion = await completeBillingCheckoutIntent({
        id: intent.id,
        idempotencyKey: intent.idempotencyKey,
        leaseToken: intent.leaseToken,
        providerCheckoutId: checkoutSession.id,
        providerOrderId,
        url: checkoutSession.url,
      });

      if (completion.kind === "retire") {
        await retireProviderCheckout(provider, checkoutSession.id, providerOrderId);
        await completeBillingCheckoutRetirement(intent.id, intent.idempotencyKey);
        throw new BillingCheckoutConflictError(
          "Checkout was retired because account deletion or another terminal operation won the race.",
        );
      }
      if (completion.kind === "reconciled") {
        throw new BillingCheckoutConflictError("Payment already completed and is being reconciled.");
      }
      if (completion.kind === "superseded") {
        throw new BillingCheckoutConflictError("A newer checkout request owns this attempt. Please try again shortly.");
      }
      if (completion.kind === "ambiguous") {
        throw new BillingCheckoutConflictError(
          "The provider returned a different checkout reference. Contact support before continuing.",
        );
      }

      return NextResponse.json({
        provider,
        reused: completion.kind === "reuse",
        url: completion.url,
      });
    } catch (error) {
      if (error instanceof BillingCheckoutConflictError) {
        await failBillingCheckoutIntent(intent.id, intent.idempotencyKey, intent.leaseToken);
      } else {
        await markBillingCheckoutIntentRecoverable(intent.id, intent.idempotencyKey, intent.leaseToken);
      }
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start checkout.";

    return NextResponse.json(
      { error: message },
      {
        status: error instanceof BillingCheckoutConflictError || error instanceof BillingAccountDeletionError
          || error instanceof ProviderSubscriptionStillActiveError
          ? 409
          : billingErrorStatus(error),
      },
    );
  }
}

function stripePriceFromIntent(intent: { providerPlanVariationId: string | null }) {
  if (!intent.providerPlanVariationId) {
    throw new BillingCheckoutConflictError("Stripe checkout pricing was not recorded safely.");
  }
  return intent.providerPlanVariationId;
}

function requestOrigin(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
}

function squareExpectationFromIntent(intent: {
  expectedAmountMinor: number | null;
  expectedCurrency: string | null;
  providerPlanVariationId: string | null;
}) {
  if (!intent.expectedAmountMinor || !intent.expectedCurrency || !intent.providerPlanVariationId) {
    throw new BillingCheckoutConflictError("Square checkout pricing was not recorded safely.");
  }
  return {
    amountMinor: intent.expectedAmountMinor,
    currency: intent.expectedCurrency,
    planVariationId: intent.providerPlanVariationId,
  };
}
