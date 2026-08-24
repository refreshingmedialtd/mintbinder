import { SubscriptionStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "../db/prisma.ts";

type LocalScheduledCancellation = {
  id: string;
  provider: string;
  providerSubscriptionId: string | null;
};

type SquareSubscriptionTruth = {
  canceled_date?: string | null;
  charged_through_date?: string | null;
  customer_id?: string | null;
  id?: string | null;
  plan_variation_id?: string | null;
  status?: string | null;
};

type StripeSubscriptionTruth = {
  cancel_at_period_end?: boolean | null;
  current_period_end?: number | null;
  customer?: string | { id?: string | null } | null;
  id?: string | null;
  items?: { data?: Array<{ price?: { id?: string | null } | null }> } | null;
  metadata?: Record<string, string | undefined> | null;
  status?: string | null;
};

type ReconciliationStore = {
  subscription: {
    findMany(args: unknown): Promise<LocalScheduledCancellation[]>;
  };
};

type ReconciliationProviders = {
  retrieveSquare(subscriptionId: string): Promise<SquareSubscriptionTruth | null>;
  retrieveStripe(subscriptionId: string): Promise<StripeSubscriptionTruth>;
  syncSquare(subscription: SquareSubscriptionTruth, observedAt: Date): Promise<unknown>;
  syncStripe(subscription: StripeSubscriptionTruth, observedAt: Date): Promise<unknown>;
};

export class ProviderSubscriptionStillActiveError extends Error {
  constructor(provider: string) {
    super(
      `${provider === "square" ? "Square" : "Stripe"} still reports an active or pending subscription. ` +
      "Use Billing or contact support before starting another checkout.",
    );
    this.name = "ProviderSubscriptionStillActiveError";
  }
}

export function scheduledCancellationNeedsProviderTruth({
  cancelAtPeriodEnd,
  currentPeriodEnd,
  now,
}: {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  now: Date;
}) {
  return cancelAtPeriodEnd && currentPeriodEnd !== null && currentPeriodEnd <= now;
}

export function providerSubscriptionBlocksCheckout(provider: string, status?: string | null) {
  const normalized = status?.trim().toUpperCase() ?? "";

  if (provider === "square") {
    return normalized !== "CANCELED" && normalized !== "COMPLETED" && normalized !== "DEACTIVATED";
  }

  if (provider === "stripe") {
    return normalized !== "CANCELED" && normalized !== "INCOMPLETE_EXPIRED";
  }

  return true;
}

export async function reconcileExpiredScheduledCancellations({
  now = new Date(),
  prisma = defaultPrisma,
  providers = defaultProviders,
  userId,
}: {
  now?: Date;
  prisma?: ReconciliationStore;
  providers?: ReconciliationProviders;
  userId: string;
}) {
  const candidates = await prisma.subscription.findMany({
    where: {
      userId,
      provider: { in: ["square", "stripe"] },
      providerSubscriptionId: { not: null },
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { lte: now },
      status: {
        notIn: [SubscriptionStatus.CANCELED, SubscriptionStatus.INCOMPLETE_EXPIRED],
      },
    },
    select: {
      id: true,
      provider: true,
      providerSubscriptionId: true,
    },
    orderBy: { updatedAt: "asc" },
  });

  for (const candidate of candidates) {
    const subscriptionId = candidate.providerSubscriptionId;
    if (!subscriptionId) {
      throw new Error("An expired scheduled cancellation is missing its provider subscription identifier.");
    }

    if (candidate.provider === "square") {
      const remote = await providers.retrieveSquare(subscriptionId);
      if (!remote?.id) {
        throw new Error("Square subscription truth could not be verified before checkout.");
      }
      await providers.syncSquare(remote, now);
      if (providerSubscriptionBlocksCheckout("square", remote.status)) {
        throw new ProviderSubscriptionStillActiveError("square");
      }
      continue;
    }

    if (candidate.provider === "stripe") {
      const remote = await providers.retrieveStripe(subscriptionId);
      if (!remote?.id) {
        throw new Error("Stripe subscription truth could not be verified before checkout.");
      }
      await providers.syncStripe(remote, now);
      if (providerSubscriptionBlocksCheckout("stripe", remote.status)) {
        throw new ProviderSubscriptionStillActiveError("stripe");
      }
      continue;
    }

    throw new Error(`Unsupported subscription provider: ${candidate.provider}.`);
  }

  return { reconciled: candidates.length };
}

const defaultProviders: ReconciliationProviders = {
  async retrieveSquare(subscriptionId) {
    const { retrieveSquareSubscription } = await import("@/lib/billing/square");
    return retrieveSquareSubscription(subscriptionId);
  },
  async retrieveStripe(subscriptionId) {
    const { retrieveStripeSubscription } = await import("@/lib/billing/stripe");
    return retrieveStripeSubscription(subscriptionId) as Promise<StripeSubscriptionTruth>;
  },
  async syncSquare(subscription, observedAt) {
    const { fulfillSquareSubscription } = await import("@/lib/billing/subscriptions");
    return fulfillSquareSubscription(subscription, observedAt);
  },
  async syncStripe(subscription, observedAt) {
    const { fulfillSubscription } = await import("@/lib/billing/subscriptions");
    return fulfillSubscription(subscription, observedAt);
  },
};
