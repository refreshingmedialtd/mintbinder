import {
  SubscriptionPlan,
  SubscriptionStatus,
  type BillingCheckoutIntent,
  type Prisma,
} from "@prisma/client";
import {
  squarePaymentMatchesCheckout,
  squarePaymentOrderMatchesCheckout,
} from "./square-checkout-correlation.ts";
import { squareSubscriptionPeriodEnd } from "./subscription-mapping.ts";
import {
  selectSquarePaymentActivationTarget,
  selectSquareTerminalCustomerRowsToDetach,
} from "./subscription-selection.ts";
import {
  assertNoConflictingExternalPaidAgreement,
  lockBillingCheckout,
} from "./checkout-lock.ts";

type CheckoutIntentSnapshot = Pick<
  BillingCheckoutIntent,
  | "expectedAmountMinor"
  | "expectedCurrency"
  | "id"
  | "idempotencyKey"
  | "plan"
  | "provider"
  | "providerCustomerId"
  | "providerOrderId"
  | "providerPlanVariationId"
  | "userId"
>;

type SquarePaymentTransactionClient = Pick<
  Prisma.TransactionClient,
  "$executeRaw" | "$queryRaw" | "billingCheckoutIntent" | "subscription"
>;

const RECONCILABLE_INTENT_STATUSES = new Set([
  "creating",
  "recoverable",
  "ready",
  "retiring",
  "paid_pending_subscription",
  "completed",
]);

/**
 * Revalidates and applies a completed Square payment while the checkout intent
 * row is locked. Keeping this boundary injectable gives the race-sensitive
 * path executable coverage without weakening the production transaction.
 */
export async function reconcileSquareCheckoutPaymentTransaction({
  claimCustomerOwnership,
  customerId,
  idempotencyKey,
  initialIntent,
  now = new Date(),
  payment,
  paymentId,
  transaction,
}: {
  claimCustomerOwnership: (input: { customerId: string; userId: string }) => Promise<unknown>;
  customerId: string;
  idempotencyKey: string;
  initialIntent: CheckoutIntentSnapshot;
  now?: Date;
  payment: {
    amount_money?: { amount?: number | null; currency?: string | null } | null;
    order_id?: string | null;
  };
  paymentId: string;
  transaction: SquarePaymentTransactionClient;
}) {
  // Every billing path takes the account/provider advisory lock before a
  // checkout row lock. Keeping one global order prevents webhook reconciliation
  // from deadlocking checkout completion or account deletion.
  await lockBillingCheckout(
    transaction,
    initialIntent.userId,
  );
  await transaction.$queryRaw`
    SELECT "id"
    FROM "billing_checkout_intents"
    WHERE "id" = ${initialIntent.id}::uuid
    FOR UPDATE
  `;
  const lockedIntent = await transaction.billingCheckoutIntent.findUnique({
    where: { id: initialIntent.id },
  });

  if (
    !lockedIntent ||
    lockedIntent.idempotencyKey !== idempotencyKey ||
    lockedIntent.provider !== "square" ||
    lockedIntent.userId !== initialIntent.userId
  ) {
    throw reconciliationError("Square checkout intent changed during payment reconciliation.");
  }

  if (
    lockedIntent.providerOrderId !== initialIntent.providerOrderId ||
    !squarePaymentOrderMatchesCheckout({
      orderId: payment.order_id,
      expectedOrderId: lockedIntent.providerOrderId,
    })
  ) {
    throw reconciliationError(
      "Square checkout intent order ID changed during payment reconciliation.",
    );
  }

  if (
    lockedIntent.expectedAmountMinor !== initialIntent.expectedAmountMinor ||
    lockedIntent.expectedCurrency !== initialIntent.expectedCurrency ||
    !squarePaymentMatchesCheckout({
      amountMinor: payment.amount_money?.amount,
      currency: payment.amount_money?.currency,
      expectedAmountMinor: lockedIntent.expectedAmountMinor,
      expectedCurrency: lockedIntent.expectedCurrency,
    })
  ) {
    throw reconciliationError(
      "Square checkout intent amount or currency changed during payment reconciliation.",
    );
  }

  const preparedCustomerId = lockedIntent.providerCustomerId?.trim() ?? "";
  if (
    lockedIntent.providerCustomerId !== initialIntent.providerCustomerId ||
    !preparedCustomerId ||
    lockedIntent.providerCustomerId !== preparedCustomerId
  ) {
    throw reconciliationError(
      "Square checkout intent prepared customer changed during payment reconciliation.",
    );
  }

  const paymentCustomerId = customerId.trim();
  if (!paymentCustomerId || paymentCustomerId !== customerId) {
    throw reconciliationError("Square payment customer ID was not exact.");
  }

  if (
    lockedIntent.plan !== initialIntent.plan ||
    lockedIntent.providerPlanVariationId !== initialIntent.providerPlanVariationId ||
    !lockedIntent.providerPlanVariationId?.trim() ||
    (
      lockedIntent.plan !== SubscriptionPlan.PLUS_MONTHLY &&
      lockedIntent.plan !== SubscriptionPlan.PLUS_YEARLY
    )
  ) {
    throw reconciliationError("Square checkout intent plan changed during payment reconciliation.");
  }

  if (!RECONCILABLE_INTENT_STATUSES.has(lockedIntent.status)) {
    throw reconciliationError("Square payment matched a terminal checkout intent.");
  }

  if (lockedIntent.providerPaymentId) {
    if (lockedIntent.providerPaymentId !== paymentId) {
      throw reconciliationError("Square checkout intent was already completed by a different payment.");
    }
    return { activated: false, intentId: lockedIntent.id, userId: lockedIntent.userId };
  }

  const currentPeriodEnd = squareSubscriptionPeriodEnd({
    anchor: now,
    estimateWhenMissing: true,
    plan: lockedIntent.plan,
  });

  await claimCustomerOwnership({ customerId: paymentCustomerId, userId: lockedIntent.userId });

  const candidates = await transaction.subscription.findMany({
    where: {
      userId: lockedIntent.userId,
      provider: "square",
      providerCustomerId: paymentCustomerId,
    },
    orderBy: { updatedAt: "desc" },
  });
  const existing = selectSquarePaymentActivationTarget(candidates);
  await assertNoConflictingExternalPaidAgreement(transaction, {
    allowedSubscriptionIds: existing ? [existing.id] : [],
    incomingProvider: "square",
    now,
    userId: lockedIntent.userId,
  });
  const data = {
    cancelAtPeriodEnd: false,
    currentPeriodEnd,
    plan: lockedIntent.plan,
    providerCustomerId: paymentCustomerId,
    providerUpdatedAt: now,
    status: SubscriptionStatus.ACTIVE,
  };

  if (existing) {
    await transaction.subscription.update({ where: { id: existing.id }, data });
  } else {
    const terminalRows = selectSquareTerminalCustomerRowsToDetach(candidates);
    const unsafeHolder = candidates.find((candidate) =>
      !terminalRows.some((terminal) => terminal.id === candidate.id));
    if (unsafeHolder) {
      throw reconciliationError(
        "Square payment customer is still linked to a different non-terminal subscription.",
      );
    }
    if (terminalRows.length) {
      await transaction.subscription.updateMany({
        where: { id: { in: terminalRows.map((candidate) => candidate.id) } },
        data: { providerCustomerId: null },
      });
    }
    await transaction.subscription.create({
      data: { ...data, provider: "square", userId: lockedIntent.userId },
    });
  }

  await transaction.billingCheckoutIntent.update({
    where: { id: lockedIntent.id },
    data: {
      checkoutUrl: null,
      expiresAt: new Date(0),
      providerPaymentId: paymentId,
      status: "paid_pending_subscription",
    },
  });

  return { activated: true, intentId: lockedIntent.id, userId: lockedIntent.userId };
}

function reconciliationError(message: string) {
  const error = new Error(message);
  error.name = "BillingWebhookReconciliationError";
  return error;
}
