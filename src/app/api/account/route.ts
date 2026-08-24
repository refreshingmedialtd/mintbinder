import { NextResponse } from "next/server";
import { Prisma, SubscriptionStatus } from "@prisma/client";
import { auth } from "@/auth";
import {
  deleteSquareBillingForAccount,
} from "@/lib/billing/subscription-management";
import {
  deleteAccountData,
} from "@/lib/account/deletion";
import {
  AuthRateLimitError,
  clearAuthFailures,
  consumeAuthAttempt,
} from "@/lib/auth/rate-limit";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword } from "@/lib/auth/password";
import {
  clearBillingAccountDeletionFence,
  fenceBillingForAccountDeletion,
  retireBillingCheckoutIntentsForAccount,
} from "@/lib/billing/checkout-intents";

export const dynamic = "force-dynamic";

const DELETE_CONFIRMATION = "DELETE MY ACCOUNT";

export async function DELETE(request: Request) {
  let fencedUserId: string | null = null;

  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({})) as {
      confirmation?: unknown;
      email?: unknown;
      password?: unknown;
    };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const rateLimitContext = { action: "credentials" as const, email, request };

    if (body.confirmation !== DELETE_CONFIRMATION) {
      return NextResponse.json(
        { error: `Type ${DELETE_CONFIRMATION} to confirm permanent deletion.` },
        { status: 400 },
      );
    }

    const rateLimitReservation = await consumeAuthAttempt(rateLimitContext);

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        email: true,
        passwordHash: true,
        subscriptions: { orderBy: { updatedAt: "desc" } },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    if (email !== user.email.toLowerCase() || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json({ error: "Email or password confirmation did not match." }, { status: 403 });
    }

    await clearAuthFailures(rateLimitReservation).catch(() => undefined);

    const subscriptionsNeedingCancellation = user.subscriptions.filter(subscriptionNeedsCancellation);
    const unsupportedSubscriptions = subscriptionsNeedingCancellation.filter((subscription) =>
      subscription.provider !== "square" && subscription.provider !== "local");
    const incompleteSquareSubscriptions = subscriptionsNeedingCancellation.filter((subscription) =>
      subscription.provider === "square" &&
      !subscription.providerSubscriptionId &&
      !subscription.providerCustomerId);

    if (unsupportedSubscriptions.length || incompleteSquareSubscriptions.length) {
      return NextResponse.json(
        { error: "One or more billing subscriptions require support cancellation before this account can be deleted." },
        { status: 409 },
      );
    }

    await fenceBillingForAccountDeletion(session.user.id);
    fencedUserId = session.user.id;
    await retireBillingCheckoutIntentsForAccount(session.user.id);

    // Always inspect the provenance ledger as well as subscriptions. A remote
    // customer can have been created before a later local subscription write;
    // skipping this step based only on the earlier subscription snapshot would
    // orphan that profile during an account-deletion race.
    await deleteSquareBillingForAccount(session.user.id);

    await prisma.$transaction(async (transaction) => {
      return deleteAccountData(transaction, session.user.id);
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    return NextResponse.json({
      ok: true,
      message: "Account and collection data permanently deleted. Please sign out on this device.",
    });
  } catch (error) {
    if (fencedUserId) {
      await clearBillingAccountDeletionFence(fencedUserId).catch((fenceError) => {
        console.error("Unable to clear account-deletion billing fence after a safe abort.", fenceError);
      });
    }

    if (error instanceof AuthRateLimitError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }

    console.error("Unable to delete account.", error);
    return NextResponse.json(
      {
        error: "Account deletion could not be completed. Account data was not deleted; provider billing or customer changes may already have been accepted. Review Billing or contact support before retrying.",
      },
      { status: 500 },
    );
  }
}

function subscriptionNeedsCancellation(subscription: {
  cancelAtPeriodEnd: boolean;
  provider: string;
  providerSubscriptionId: string | null;
  status: SubscriptionStatus;
}) {
  if (subscription.provider === "local") {
    return false;
  }

  return !subscription.cancelAtPeriodEnd &&
    subscription.status !== SubscriptionStatus.CANCELED &&
    subscription.status !== SubscriptionStatus.INCOMPLETE_EXPIRED;
}
