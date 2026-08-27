import { BillingCustomerProvenance, Prisma, type BillingCustomer } from "@prisma/client";
import { prisma } from "../db/prisma.ts";
import { assertBillingAccountAvailable } from "./checkout-lock.ts";

type BillingCustomerClient = Pick<
  Prisma.TransactionClient,
  "$executeRaw" | "billingCheckoutIntent" | "billingCustomer" | "user"
>;

export class BillingCustomerOwnershipError extends Error {
  constructor(message = "This provider customer is already linked to another Mint Binder account.") {
    super(message);
    this.name = "BillingCustomerOwnershipError";
  }
}

export async function claimBillingCustomerOwnership({
  allowDuringDeletion = false,
  client,
  customerId,
  provenance = BillingCustomerProvenance.PROVIDER_MATCHED,
  provider,
  userId,
}: {
  allowDuringDeletion?: boolean;
  client?: BillingCustomerClient;
  customerId: string;
  provenance?: BillingCustomerProvenance;
  provider: string;
  userId: string;
}): Promise<BillingCustomer> {
  if (!client) {
    return prisma.$transaction((transaction) => claimBillingCustomerOwnership({
      allowDuringDeletion,
      client: transaction,
      customerId,
      provenance,
      provider,
      userId,
    }));
  }

  await assertBillingAccountAvailable(client, userId, provider, { allowDuringDeletion });
  const where = { provider_providerCustomerId: { provider, providerCustomerId: customerId } };
  const existing = await client.billingCustomer.findUnique({ where });

  if (existing) {
    if (existing.userId !== userId) throw new BillingCustomerOwnershipError();
    return existing;
  }

  try {
    return await client.billingCustomer.create({
      data: { provenance, provider, providerCustomerId: customerId, userId },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const winner = await client.billingCustomer.findUnique({ where });
    if (!winner || winner.userId !== userId) throw new BillingCustomerOwnershipError();
    return winner;
  }
}
