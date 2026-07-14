import "dotenv/config";
import { PrismaClient, SubscriptionPlan, SubscriptionStatus, UserRole } from "@prisma/client";

const prisma = new PrismaClient();
const adminEmail = (process.env.ADMIN_EMAIL || process.env.ADMIN_QA_EMAIL || "liam@refreshing.media")
  .trim()
  .toLowerCase();

if (!adminEmail.includes("@")) {
  throw new Error("ADMIN_EMAIL must be a valid email address.");
}

try {
  const user = await prisma.user.findUnique({
    where: { email: adminEmail },
    include: {
      notificationPreference: true,
      subscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!user) {
    throw new Error(`User ${adminEmail} was not found. Sign in once before promoting the account.`);
  }

  const [updatedUser, subscription, notificationPreference] = await prisma.$transaction(async (tx) => {
    const promoted = await tx.user.update({
      where: { id: user.id },
      data: { role: UserRole.ADMIN },
      select: {
        displayName: true,
        email: true,
        id: true,
        role: true,
      },
    });

    const currentSubscription = user.subscriptions[0] ?? await tx.subscription.create({
      data: {
        provider: "local",
        plan: SubscriptionPlan.FREE,
        status: SubscriptionStatus.ACTIVE,
        userId: user.id,
      },
    });

    const preferences = await tx.notificationPreference.upsert({
      where: { userId: user.id },
      update: {
        digestFrequency: "DAILY",
        priceAlertsEnabled: true,
        weakPriceAlertsEnabled: true,
        wishlistTargetAlertsEnabled: true,
      },
      create: {
        digestFrequency: "DAILY",
        priceAlertsEnabled: true,
        userId: user.id,
        weakPriceAlertsEnabled: true,
        wishlistTargetAlertsEnabled: true,
      },
      select: {
        digestFrequency: true,
        priceAlertsEnabled: true,
        weakPriceAlertsEnabled: true,
        wishlistTargetAlertsEnabled: true,
      },
    });

    return [promoted, currentSubscription, preferences];
  });

  console.log(JSON.stringify({
    admin: {
      displayName: updatedUser.displayName,
      email: updatedUser.email,
      id: updatedUser.id,
      role: updatedUser.role,
    },
    notificationPreference,
    ok: updatedUser.role === UserRole.ADMIN,
    subscription: {
      id: subscription.id,
      plan: subscription.plan,
      provider: subscription.provider,
      status: subscription.status,
    },
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
