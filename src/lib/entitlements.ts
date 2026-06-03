import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

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

const activeStatuses = new Set<SubscriptionStatus>([
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
]);

export async function getEntitlements(userId: string): Promise<EntitlementResult> {
  const subscription = await prisma.subscription.findFirst({
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
  const isPlus =
    Boolean(subscription && activeStatuses.has(subscription.status)) &&
    (subscription?.plan === SubscriptionPlan.PLUS_MONTHLY ||
      subscription?.plan === SubscriptionPlan.PLUS_YEARLY);

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

export function entitlementStatus(error: unknown) {
  return error instanceof Error && error.name === "EntitlementError" ? 403 : 400;
}
