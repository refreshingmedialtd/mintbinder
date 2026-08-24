import { prisma } from "./db/prisma.ts";
import { effectivePlusAccessWhere, hasEffectivePlusAccess } from "./billing/effective-access.ts";
export { entitlementStatus } from "./entitlement-status.ts";

export type Entitlement =
  | "exports.insurance_report"
  | "pricing.alerts"
  | "billing.portal";

export type EntitlementResult = {
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string;
  plan: "free" | "plus";
  provider?: string;
  providerSubscriptionId?: string;
  status?: string;
  entitlements: Record<Entitlement, boolean>;
};

export async function getEntitlements(userId: string): Promise<EntitlementResult> {
  const now = new Date();
  const activePlus = await prisma.subscription.findFirst({
    where: {
      userId,
      ...effectivePlusAccessWhere(now),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: true,
      plan: true,
      provider: true,
      providerSubscriptionId: true,
      status: true,
    },
  });
  const subscription = activePlus ?? await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: true,
      plan: true,
      provider: true,
      providerSubscriptionId: true,
      status: true,
    },
  });
  const isPlus = hasEffectivePlusAccess(subscription, now);

  return {
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString(),
    plan: isPlus ? "plus" : "free",
    provider: subscription?.provider,
    providerSubscriptionId: subscription?.providerSubscriptionId ?? undefined,
    status: subscription?.status,
    entitlements: {
      "billing.portal": isPlus,
      "exports.insurance_report": isPlus,
      "pricing.alerts": isPlus,
    },
  };
}

export async function requireEntitlement(userId: string, entitlement: Entitlement) {
  const result = await getEntitlements(userId);

  if (!result.entitlements[entitlement]) {
    const error = new Error("Plus subscription required.");
    error.name = "EntitlementError";
    throw error;
  }

  return result;
}
