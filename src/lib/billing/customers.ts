import { BillingCustomerProvenance, SubscriptionPlan, SubscriptionStatus, type Prisma } from "@prisma/client";
import {
  BillingAccountDeletionError,
  assertBillingAccountAvailable,
} from "@/lib/billing/checkout-lock";
import {
  BillingCustomerOwnershipError,
  claimBillingCustomerOwnership,
} from "@/lib/billing/customer-ownership";
import {
  billingCustomerCreationIdempotencyKey,
  establishDurableProviderCustomer,
} from "@/lib/billing/customer-creation";
import { activeBillingProvider } from "@/lib/billing/provider";
import { createSquareCustomer, deleteSquareCustomer } from "@/lib/billing/square";
import { createStripeCustomer, deleteStripeCustomer } from "@/lib/billing/stripe";
import { prisma } from "@/lib/db/prisma";

type Provider = "square" | "stripe";
type CustomerInput = {
  email?: string | null;
  idempotencyKey: string;
  name?: string | null;
  userId: string;
};

export async function getOrCreateBillingCustomer(input: CustomerInput) {
  return activeBillingProvider() === "square"
    ? getOrCreateSquareCustomer(input)
    : getOrCreateStripeCustomer(input);
}

export async function getBillingCustomer(userId: string) {
  return activeBillingProvider() === "square"
    ? getSquareCustomer(userId)
    : getStripeCustomer(userId);
}

export async function getOrCreateSquareCustomer(input: CustomerInput) {
  const idempotencyKey = billingCustomerCreationIdempotencyKey("square", input.idempotencyKey);
  return getOrCreateProviderCustomer({
    ...input,
    create: () => createSquareCustomer({ ...input, idempotencyKey }),
    destroy: deleteSquareCustomer,
    provider: "square",
  });
}

export async function getOrCreateStripeCustomer(input: CustomerInput) {
  const idempotencyKey = billingCustomerCreationIdempotencyKey("stripe", input.idempotencyKey);
  return getOrCreateProviderCustomer({
    ...input,
    create: () => createStripeCustomer({ ...input, idempotencyKey }),
    destroy: deleteStripeCustomer,
    provider: "stripe",
  });
}

export async function getSquareCustomer(userId: string) {
  return getProviderCustomer({ provider: "square", userId });
}

export async function getStripeCustomer(userId: string) {
  return getProviderCustomer({ provider: "stripe", userId });
}

async function getOrCreateProviderCustomer({
  create,
  destroy,
  provider,
  userId,
}: CustomerInput & {
  create: () => Promise<{ id: string }>;
  destroy: (customerId: string) => Promise<unknown>;
  provider: Provider;
}) {
  const existingCustomerId = await getProviderCustomer({ provider, userId });
  if (existingCustomerId) return existingCustomerId;

  return establishDurableProviderCustomer({
    compensate: destroy,
    create,
    finalize: (createdCustomer) => prisma.$transaction(async (transaction) => {
      await assertBillingAccountAvailable(transaction, userId, provider);

      // A concurrent request may have committed a customer while the remote
      // create call was in flight. Keep the committed winner and compensate
      // the redundant provider object after this transaction releases its lock.
      const winnerId = await findProviderCustomer(transaction, { provider, userId });
      if (winnerId) {
        return { customerId: winnerId, discardCreated: winnerId !== createdCustomer.id };
      }

      await claimBillingCustomerOwnership({
        client: transaction,
        customerId: createdCustomer.id,
        provenance: BillingCustomerProvenance.APP_CREATED,
        provider,
        userId,
      });

      const providerSubscription = await transaction.subscription.findFirst({
        where: { provider, userId },
        orderBy: { updatedAt: "desc" },
      });
      const existingSubscription = providerSubscription ?? await transaction.subscription.findFirst({
        where: { userId },
        orderBy: { updatedAt: "desc" },
      });

      if (existingSubscription && canReuseSubscriptionForProvider(existingSubscription, provider)) {
        await transaction.subscription.update({
          where: { id: existingSubscription.id },
          data: { provider, providerCustomerId: createdCustomer.id },
        });
      } else {
        await createFreeProviderSubscription(transaction, {
          customerId: createdCustomer.id,
          provider,
          userId,
        });
      }

      return { customerId: createdCustomer.id, discardCreated: false };
    }),
    shouldCompensate: (error) =>
      error instanceof BillingAccountDeletionError || error instanceof BillingCustomerOwnershipError,
  });
}

async function getProviderCustomer({ provider, userId }: { provider: Provider; userId: string }) {
  return prisma.$transaction(async (transaction) => {
    await assertBillingAccountAvailable(transaction, userId, provider);
    return findProviderCustomer(transaction, { provider, userId });
  });
}

async function findProviderCustomer(
  transaction: Prisma.TransactionClient,
  { provider, userId }: { provider: Provider; userId: string },
) {
  const ownedCustomer = await transaction.billingCustomer.findFirst({
    where: { provider, userId },
    orderBy: { updatedAt: "desc" },
    select: { providerCustomerId: true },
  });
  if (ownedCustomer) return ownedCustomer.providerCustomerId;

  const subscription = await transaction.subscription.findFirst({
    where: { provider, userId, providerCustomerId: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { providerCustomerId: true },
  });
  if (!subscription?.providerCustomerId) return null;

  await claimBillingCustomerOwnership({
    client: transaction,
    customerId: subscription.providerCustomerId,
    provenance: BillingCustomerProvenance.LEGACY_SUBSCRIPTION,
    provider,
    userId,
  });
  return subscription.providerCustomerId;
}

function canReuseSubscriptionForProvider(
  subscription: { provider: string; providerCustomerId: string | null; providerSubscriptionId: string | null },
  provider: string,
) {
  return subscription.provider === provider || (!subscription.providerCustomerId && !subscription.providerSubscriptionId);
}

async function createFreeProviderSubscription(
  transaction: Prisma.TransactionClient,
  { customerId, provider, userId }: { customerId: string; provider: Provider; userId: string },
) {
  await transaction.subscription.create({
    data: {
      userId,
      provider,
      providerCustomerId: customerId,
      plan: SubscriptionPlan.FREE,
      status: SubscriptionStatus.ACTIVE,
    },
  });
}
