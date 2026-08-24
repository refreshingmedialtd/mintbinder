import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { billingErrorStatus } from "@/lib/billing/errors";
import {
  cancelCurrentSquareSubscription,
  getCurrentBillingSubscription,
} from "@/lib/billing/subscription-management";
import { accountMutationGuard } from "@/lib/auth/mutation-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    return NextResponse.json({
      subscription: await getCurrentBillingSubscription(session.user.id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load billing subscription.";

    return NextResponse.json({ error: message }, { status: billingErrorStatus(error) });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const mutationError = await accountMutationGuard({
      isEmailVerified: session.user.isEmailVerified, request, userId: session.user.id,
    });
    if (mutationError) return mutationError;

    const body = await request.json().catch(() => ({})) as { action?: string };

    if (body.action !== "cancel") {
      return NextResponse.json({ error: "Unsupported billing subscription action." }, { status: 400 });
    }

    const subscription = await cancelCurrentSquareSubscription(session.user.id);

    return NextResponse.json({
      message: subscription.cancelAtPeriodEnd
        ? "Plus renewal is cancelled. Access remains active until the paid period ends."
        : "Plus subscription is already cancelled.",
      subscription,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update billing subscription.";

    return NextResponse.json({ error: message }, { status: billingErrorStatus(error) });
  }
}
