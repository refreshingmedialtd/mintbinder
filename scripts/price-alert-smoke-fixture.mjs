import "dotenv/config";
import {
  ItemCondition,
  ItemType,
  NotificationDigestFrequency,
  PrismaClient,
  SubscriptionPlan,
  SubscriptionStatus,
  WishlistPriority,
} from "@prisma/client";

const prisma = new PrismaClient();
const ids = {
  card: "f1000000-0000-4000-8000-000000000004",
  notificationPreference: "f1000000-0000-4000-8000-000000000003",
  priceSnapshot: "f1000000-0000-4000-8000-000000000006",
  set: "f1000000-0000-4000-8000-000000000005",
  subscription: "f1000000-0000-4000-8000-000000000002",
  user: "f1000000-0000-4000-8000-000000000001",
  wishlist: "f1000000-0000-4000-8000-000000000007",
};
const fixtureEmail = process.env.PRICE_ALERT_SMOKE_USER_EMAIL?.trim() || "price-alert-smoke@mintbinder.invalid";
const action = firstPositionalArg() || "status";
const confirmed = process.argv.includes("--confirm") || process.env.PRICE_ALERT_SMOKE_CONFIRM === "true";

try {
  assertDatabaseConfigured();

  if (action === "status") {
    console.log(JSON.stringify(await fixtureStatus(), null, 2));
  } else if (action === "setup") {
    requireConfirmation("setup");
    console.log(JSON.stringify(await setupFixture(), null, 2));
  } else if (action === "cleanup") {
    requireConfirmation("cleanup");
    console.log(JSON.stringify(await cleanupFixture(), null, 2));
  } else {
    throw new Error(`Unknown action "${action}". Use status, setup, or cleanup.`);
  }
} finally {
  await prisma.$disconnect();
}

async function setupFixture() {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 30);

  await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: ids.user },
      update: {
        displayName: "Mint Binder Smoke",
        email: fixtureEmail,
        preferredCurrency: "GBP",
        preferredRegion: "GB",
      },
      create: {
        id: ids.user,
        displayName: "Mint Binder Smoke",
        email: fixtureEmail,
        preferredCurrency: "GBP",
        preferredRegion: "GB",
      },
    });

    await tx.subscription.upsert({
      where: { id: ids.subscription },
      update: {
        cancelAtPeriodEnd: false,
        currentPeriodEnd: periodEnd,
        plan: SubscriptionPlan.PLUS_MONTHLY,
        provider: "internal_smoke",
        providerCustomerId: "mintbinder-price-alert-smoke-customer",
        providerSubscriptionId: "mintbinder-price-alert-smoke-subscription",
        status: SubscriptionStatus.ACTIVE,
      },
      create: {
        id: ids.subscription,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: periodEnd,
        plan: SubscriptionPlan.PLUS_MONTHLY,
        provider: "internal_smoke",
        providerCustomerId: "mintbinder-price-alert-smoke-customer",
        providerSubscriptionId: "mintbinder-price-alert-smoke-subscription",
        status: SubscriptionStatus.ACTIVE,
        userId: ids.user,
      },
    });

    await tx.notificationPreference.upsert({
      where: { userId: ids.user },
      update: {
        digestFrequency: NotificationDigestFrequency.DAILY,
        priceAlertsEnabled: true,
        weakPriceAlertsEnabled: true,
        wishlistTargetAlertsEnabled: true,
      },
      create: {
        id: ids.notificationPreference,
        digestFrequency: NotificationDigestFrequency.DAILY,
        priceAlertsEnabled: true,
        userId: ids.user,
        weakPriceAlertsEnabled: true,
        wishlistTargetAlertsEnabled: true,
      },
    });

    await tx.cardSet.upsert({
      where: { id: ids.set },
      update: {
        metadata: { smokeFixture: true },
        name: "Mint Binder Smoke Set",
        providerIds: { mintbinder_smoke: "price-alert-smoke-set" },
        releaseDate: now,
        series: "Smoke QA",
        total: 1,
      },
      create: {
        id: ids.set,
        metadata: { smokeFixture: true },
        name: "Mint Binder Smoke Set",
        printedTotal: 1,
        providerIds: { mintbinder_smoke: "price-alert-smoke-set" },
        releaseDate: now,
        series: "Smoke QA",
        total: 1,
      },
    });

    await tx.cardPrinting.upsert({
      where: { id: ids.card },
      update: {
        cardSetId: ids.set,
        name: "Smoke Test Pikachu",
        providerIds: { mintbinder_smoke: "price-alert-smoke-card" },
        searchText: "smoke test pikachu mint binder smoke set",
        variantMetadata: { smokeFixture: true },
      },
      create: {
        id: ids.card,
        cardSetId: ids.set,
        name: "Smoke Test Pikachu",
        number: "001",
        providerIds: { mintbinder_smoke: "price-alert-smoke-card" },
        rarity: "Promo",
        searchText: "smoke test pikachu mint binder smoke set",
        subtypes: ["Smoke"],
        supertype: "Pokemon",
        variantMetadata: { smokeFixture: true },
      },
    });

    await tx.priceSnapshot.deleteMany({
      where: { id: ids.priceSnapshot },
    });
    await tx.priceSnapshot.create({
      data: {
        id: ids.priceSnapshot,
        cardPrintingId: ids.card,
        condition: ItemCondition.NEAR_MINT,
        confidenceScore: 95,
        currency: "GBP",
        itemType: ItemType.CARD,
        language: "en",
        metadata: { smokeFixture: true },
        observedAt: now,
        priceMinor: 1000,
        source: "mintbinder_smoke",
        sourceRef: "price-alert-smoke",
        variantLabel: "Normal",
      },
    });

    await tx.wishlistItem.upsert({
      where: { id: ids.wishlist },
      update: {
        cardPrintingId: ids.card,
        priority: WishlistPriority.HIGH,
        targetCurrency: "GBP",
        targetPriceMinor: 1200,
      },
      create: {
        id: ids.wishlist,
        cardPrintingId: ids.card,
        itemType: ItemType.CARD,
        notes: "Disposable controlled price-alert smoke fixture.",
        priority: WishlistPriority.HIGH,
        targetCurrency: "GBP",
        targetPriceMinor: 1200,
        userId: ids.user,
      },
    });
  });

  return {
    action: "setup",
    alert: {
      currentPriceMinor: 1000,
      expectedStatus: "Hit",
      targetPriceMinor: 1200,
    },
    nextCommand: "npm run job:price-alerts",
    ok: true,
    testRecipientReminder: "Set PRICE_ALERT_DIGEST_TEST_RECIPIENT before a live send.",
    userEmail: fixtureEmail,
  };
}

async function cleanupFixture() {
  const deleted = await prisma.$transaction(async (tx) => {
    const wishlist = await tx.wishlistItem.deleteMany({ where: { id: ids.wishlist } });
    const subscriptions = await tx.subscription.deleteMany({ where: { id: ids.subscription } });
    const preferences = await tx.notificationPreference.deleteMany({
      where: { userId: ids.user },
    });
    const users = await tx.user.deleteMany({ where: { id: ids.user } });
    const prices = await tx.priceSnapshot.deleteMany({ where: { cardPrintingId: ids.card } });
    const cards = await tx.cardPrinting.deleteMany({ where: { id: ids.card } });
    const sets = await tx.cardSet.deleteMany({ where: { id: ids.set } });

    return {
      cards: cards.count,
      preferences: preferences.count,
      prices: prices.count,
      sets: sets.count,
      subscriptions: subscriptions.count,
      users: users.count,
      wishlist: wishlist.count,
    };
  });

  return {
    action: "cleanup",
    deleted,
    ok: true,
  };
}

async function fixtureStatus() {
  const [user, card, price, wishlist] = await Promise.all([
    prisma.user.findUnique({
      where: { id: ids.user },
      include: {
        notificationPreference: true,
        subscriptions: true,
      },
    }),
    prisma.cardPrinting.findUnique({
      where: { id: ids.card },
      include: { cardSet: true },
    }),
    prisma.priceSnapshot.findUnique({
      where: { id: ids.priceSnapshot },
    }),
    prisma.wishlistItem.findUnique({
      where: { id: ids.wishlist },
    }),
  ]);

  return {
    action: "status",
    exists: Boolean(user && card && price && wishlist),
    fixtureEmail,
    hasActivePlus:
      user?.subscriptions.some(
        (subscription) =>
          subscription.status === SubscriptionStatus.ACTIVE &&
          [SubscriptionPlan.PLUS_MONTHLY, SubscriptionPlan.PLUS_YEARLY].includes(subscription.plan),
      ) ?? false,
    hasDailyPreferences: user?.notificationPreference?.digestFrequency === NotificationDigestFrequency.DAILY,
    item: card
      ? {
          id: card.id,
          name: card.name,
          set: card.cardSet.name,
        }
      : null,
    price: price
      ? {
          confidenceScore: price.confidenceScore,
          priceMinor: price.priceMinor,
          source: price.source,
        }
      : null,
    wishlist: wishlist
      ? {
          targetPriceMinor: wishlist.targetPriceMinor,
        }
      : null,
  };
}

function assertDatabaseConfigured() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL must be configured before using the price-alert smoke fixture.");
  }
}

function firstPositionalArg() {
  return process.argv.slice(2).find((arg) => !arg.startsWith("-"));
}

function requireConfirmation(targetAction) {
  if (confirmed) {
    return;
  }

  throw new Error(
    `Refusing to ${targetAction} without confirmation. Re-run with: npm run job:price-alert-fixture -- ${targetAction} --confirm`,
  );
}
