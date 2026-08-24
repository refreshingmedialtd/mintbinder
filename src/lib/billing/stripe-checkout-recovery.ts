export type RecoverableStripeCheckoutSession = {
  customer?: string | { id?: string | null } | null;
  id: string;
  metadata?: Record<string, string | undefined> | null;
};

export function stripeCheckoutSessionMatchesIntent(
  session: RecoverableStripeCheckoutSession,
  checkoutIntentId: string,
  customerId: string,
) {
  return stripeId(session.customer) === customerId &&
    session.metadata?.checkout_intent_id === checkoutIntentId;
}

export function stripeCheckoutReplayIsSafe({
  createdAt,
  maxAgeMs,
  now = new Date(),
}: {
  createdAt: Date;
  maxAgeMs: number;
  now?: Date;
}) {
  return createdAt.getTime() >= now.getTime() - maxAgeMs;
}

export async function recoverStripeCheckoutAfterResponseLoss<T extends RecoverableStripeCheckoutSession>({
  checkoutIntentId,
  createdAt,
  customerId,
  findExact,
  maxAgeMs,
  now = new Date(),
  replay,
}: {
  checkoutIntentId: string;
  createdAt: Date;
  customerId: string;
  findExact: () => Promise<T | null>;
  maxAgeMs: number;
  now?: Date;
  replay: () => Promise<T>;
}) {
  const found = await findExact();
  if (found) {
    if (!stripeCheckoutSessionMatchesIntent(found, checkoutIntentId, customerId)) {
      throw new Error("Recovered Stripe checkout did not match its durable intent metadata.");
    }
    return { replayed: false, session: found };
  }

  if (!stripeCheckoutReplayIsSafe({ createdAt, maxAgeMs, now })) {
    throw new Error("Stripe checkout is outside the safe idempotency replay window.");
  }
  const session = await replay();
  if (!stripeCheckoutSessionMatchesIntent(session, checkoutIntentId, customerId)) {
    throw new Error("Replayed Stripe checkout did not match its durable intent metadata.");
  }
  return { replayed: true, session };
}

function stripeId(value: RecoverableStripeCheckoutSession["customer"]) {
  return typeof value === "string" ? value : value?.id ?? null;
}
