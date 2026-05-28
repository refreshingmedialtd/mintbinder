import { randomBytes, scryptSync } from "node:crypto";
import {
  CatalogueVisibility,
  CollectionEventType,
  GradingCompany,
  ItemCondition,
  ItemType,
  PrismaClient,
  SealedProductType,
  StorageLocationType,
  SubscriptionPlan,
  SubscriptionStatus,
  WishlistPriority,
} from "@prisma/client";

const prisma = new PrismaClient();
const demoPassword = "PokeStop2026!";

const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  subscription: "11111111-1111-4111-8111-111111111112",
  sets: {
    sv151: "22222222-2222-4222-8222-222222222221",
    evolvingSkies: "22222222-2222-4222-8222-222222222222",
    crownZenith: "22222222-2222-4222-8222-222222222223",
  },
  cards: {
    charizard151: "33333333-3333-4333-8333-333333333331",
    umbreonVmax: "33333333-3333-4333-8333-333333333332",
    mew151: "33333333-3333-4333-8333-333333333333",
    pikachuCrownZenith: "33333333-3333-4333-8333-333333333334",
  },
  sealed: {
    bundle151: "44444444-4444-4444-8444-444444444441",
    evolvingSkiesBox: "44444444-4444-4444-8444-444444444442",
  },
  storage: {
    binder: "55555555-5555-4555-8555-555555555551",
    sealedBox: "55555555-5555-4555-8555-555555555552",
    safe: "55555555-5555-4555-8555-555555555553",
  },
  collection: {
    umbreon: "66666666-6666-4666-8666-666666666661",
    charizard: "66666666-6666-4666-8666-666666666662",
    bundle: "66666666-6666-4666-8666-666666666663",
  },
  wishlist: {
    mew: "77777777-7777-4777-8777-777777777771",
    evolvingSkiesBox: "77777777-7777-4777-8777-777777777772",
  },
};

const observedAt = new Date("2026-05-28T12:00:00.000Z");

async function main() {
  const demoPasswordHash = hashPassword(demoPassword);

  await prisma.user.upsert({
    where: { email: "liam@example.com" },
    update: {
      displayName: "Liam",
      passwordHash: demoPasswordHash,
      preferredCurrency: "GBP",
      preferredRegion: "GB",
    },
    create: {
      id: ids.user,
      email: "liam@example.com",
      displayName: "Liam",
      passwordHash: demoPasswordHash,
      preferredCurrency: "GBP",
      preferredRegion: "GB",
    },
  });

  await prisma.subscription.upsert({
    where: { id: ids.subscription },
    update: {
      plan: SubscriptionPlan.FREE,
      status: SubscriptionStatus.ACTIVE,
    },
    create: {
      id: ids.subscription,
      userId: ids.user,
      provider: "stripe",
      plan: SubscriptionPlan.FREE,
      status: SubscriptionStatus.ACTIVE,
    },
  });

  await seedCardSets();
  await seedCards();
  await seedSealedProducts();
  await seedStorageLocations();
  await seedCollectionItems();
  await seedWishlistItems();
  await seedPriceSnapshots();
  await seedCollectionEvents();
}

async function seedCardSets() {
  const sets = [
    {
      id: ids.sets.sv151,
      providerIds: { pokemon_tcg_api: "sv3pt5" },
      name: "Scarlet & Violet 151",
      series: "Scarlet & Violet",
      releaseDate: new Date("2023-09-22T00:00:00.000Z"),
      printedTotal: 165,
      total: 207,
    },
    {
      id: ids.sets.evolvingSkies,
      providerIds: { pokemon_tcg_api: "swsh7" },
      name: "Evolving Skies",
      series: "Sword & Shield",
      releaseDate: new Date("2021-08-27T00:00:00.000Z"),
      printedTotal: 203,
      total: 237,
    },
    {
      id: ids.sets.crownZenith,
      providerIds: { pokemon_tcg_api: "swsh12pt5" },
      name: "Crown Zenith",
      series: "Sword & Shield",
      releaseDate: new Date("2023-01-20T00:00:00.000Z"),
      printedTotal: 159,
      total: 230,
    },
  ];

  for (const set of sets) {
    await prisma.cardSet.upsert({
      where: { id: set.id },
      update: set,
      create: set,
    });
  }
}

async function seedCards() {
  const cards = [
    {
      id: ids.cards.charizard151,
      cardSetId: ids.sets.sv151,
      providerIds: { pokemon_tcg_api: "sv3pt5-199" },
      name: "Charizard ex",
      number: "199/165",
      rarity: "Special Illustration Rare",
      supertype: "Pokemon",
      subtypes: ["Stage 2", "ex"],
      artist: "Akira Egawa",
      imageSmallUrl: "https://images.pokemontcg.io/sv3pt5/199.png",
      imageLargeUrl: "https://images.pokemontcg.io/sv3pt5/199_hires.png",
      variantMetadata: { finish: "holofoil", showcase: "special_illustration" },
      searchText: "charizard ex scarlet violet 151 199/165 special illustration rare",
    },
    {
      id: ids.cards.umbreonVmax,
      cardSetId: ids.sets.evolvingSkies,
      providerIds: { pokemon_tcg_api: "swsh7-215" },
      name: "Umbreon VMAX",
      number: "215/203",
      rarity: "Secret Rare",
      supertype: "Pokemon",
      subtypes: ["VMAX"],
      artist: "Keiichiro Ito",
      imageSmallUrl: "https://images.pokemontcg.io/swsh7/215.png",
      imageLargeUrl: "https://images.pokemontcg.io/swsh7/215_hires.png",
      variantMetadata: { finish: "holofoil", showcase: "alternate_art" },
      searchText: "umbreon vmax evolving skies 215/203 secret rare alternate art",
    },
    {
      id: ids.cards.mew151,
      cardSetId: ids.sets.sv151,
      providerIds: { pokemon_tcg_api: "sv3pt5-193" },
      name: "Mew ex",
      number: "193/165",
      rarity: "Special Illustration Rare",
      supertype: "Pokemon",
      subtypes: ["Basic", "ex"],
      artist: "USGMEN",
      imageSmallUrl: "https://images.pokemontcg.io/sv3pt5/193.png",
      imageLargeUrl: "https://images.pokemontcg.io/sv3pt5/193_hires.png",
      variantMetadata: { finish: "holofoil", showcase: "special_illustration" },
      searchText: "mew ex scarlet violet 151 193/165 special illustration rare",
    },
    {
      id: ids.cards.pikachuCrownZenith,
      cardSetId: ids.sets.crownZenith,
      providerIds: { pokemon_tcg_api: "swsh12pt5-160" },
      name: "Pikachu",
      number: "160/159",
      rarity: "Secret Rare",
      supertype: "Pokemon",
      subtypes: ["Basic"],
      artist: "Mizue",
      imageSmallUrl: "https://images.pokemontcg.io/swsh12pt5/160.png",
      imageLargeUrl: "https://images.pokemontcg.io/swsh12pt5/160_hires.png",
      variantMetadata: { finish: "holofoil", showcase: "secret_rare" },
      searchText: "pikachu crown zenith 160/159 secret rare",
    },
  ];

  for (const card of cards) {
    await prisma.cardPrinting.upsert({
      where: { id: card.id },
      update: card,
      create: card,
    });
  }
}

async function seedSealedProducts() {
  const products = [
    {
      id: ids.sealed.bundle151,
      relatedCardSetId: ids.sets.sv151,
      providerIds: { sample: "sealed-151-booster-bundle" },
      name: "151 Booster Bundle",
      productType: SealedProductType.BOOSTER_PACK,
      releaseDate: new Date("2023-09-22T00:00:00.000Z"),
      notes: "Sample sealed product for the MVP prototype.",
      visibility: CatalogueVisibility.GLOBAL,
    },
    {
      id: ids.sealed.evolvingSkiesBox,
      relatedCardSetId: ids.sets.evolvingSkies,
      providerIds: { sample: "sealed-evolving-skies-booster-box" },
      name: "Evolving Skies Booster Box",
      productType: SealedProductType.BOOSTER_BOX,
      releaseDate: new Date("2021-08-27T00:00:00.000Z"),
      notes: "Sample sealed product for the MVP prototype.",
      visibility: CatalogueVisibility.GLOBAL,
    },
  ];

  for (const product of products) {
    await prisma.sealedProduct.upsert({
      where: { id: product.id },
      update: product,
      create: product,
    });
  }
}

async function seedStorageLocations() {
  const locations = [
    {
      id: ids.storage.binder,
      userId: ids.user,
      name: "Blue Binder",
      type: StorageLocationType.BINDER,
    },
    {
      id: ids.storage.sealedBox,
      userId: ids.user,
      name: "Sealed Box 1",
      type: StorageLocationType.BOX,
    },
    {
      id: ids.storage.safe,
      userId: ids.user,
      name: "Safe",
      type: StorageLocationType.SAFE,
    },
  ];

  for (const location of locations) {
    await prisma.storageLocation.upsert({
      where: {
        userId_name: {
          userId: ids.user,
          name: location.name,
        },
      },
      update: location,
      create: location,
    });
  }
}

async function seedCollectionItems() {
  const items = [
    {
      id: ids.collection.umbreon,
      userId: ids.user,
      itemType: ItemType.CARD,
      cardPrintingId: ids.cards.umbreonVmax,
      quantity: 1,
      condition: ItemCondition.NEAR_MINT,
      language: "en",
      variantLabel: "Alternate art",
      purchasePriceMinor: 32000,
      purchaseCurrency: "GBP",
      purchaseDate: new Date("2024-11-12T00:00:00.000Z"),
      storageLocationId: ids.storage.binder,
      notes: "Long-term hold.",
    },
    {
      id: ids.collection.charizard,
      userId: ids.user,
      itemType: ItemType.CARD,
      cardPrintingId: ids.cards.charizard151,
      quantity: 1,
      condition: ItemCondition.NEAR_MINT,
      language: "en",
      variantLabel: "Reverse Holo",
      purchasePriceMinor: 9200,
      purchaseCurrency: "GBP",
      purchaseDate: new Date("2026-05-01T00:00:00.000Z"),
      currentValueOverrideMinor: 11800,
      currentValueOverrideCurrency: "GBP",
      storageLocationId: ids.storage.binder,
      notes: "Bought at card show.",
    },
    {
      id: ids.collection.bundle,
      userId: ids.user,
      itemType: ItemType.SEALED_PRODUCT,
      sealedProductId: ids.sealed.bundle151,
      quantity: 2,
      condition: ItemCondition.SEALED,
      language: "en",
      variantLabel: "Factory sealed",
      purchasePriceMinor: 4800,
      purchaseCurrency: "GBP",
      purchaseDate: new Date("2025-08-18T00:00:00.000Z"),
      storageLocationId: ids.storage.sealedBox,
      notes: "Keep sealed.",
    },
  ];

  for (const item of items) {
    await prisma.collectionItem.upsert({
      where: { id: item.id },
      update: item,
      create: item,
    });
  }
}

async function seedWishlistItems() {
  const items = [
    {
      id: ids.wishlist.mew,
      userId: ids.user,
      itemType: ItemType.CARD,
      cardPrintingId: ids.cards.mew151,
      targetPriceMinor: 3500,
      targetCurrency: "GBP",
      priority: WishlistPriority.HIGH,
      notes: "Clean copy preferred.",
    },
    {
      id: ids.wishlist.evolvingSkiesBox,
      userId: ids.user,
      itemType: ItemType.SEALED_PRODUCT,
      sealedProductId: ids.sealed.evolvingSkiesBox,
      targetPriceMinor: 45000,
      targetCurrency: "GBP",
      priority: WishlistPriority.GRAIL,
      notes: "Only at the right price.",
    },
  ];

  for (const item of items) {
    await prisma.wishlistItem.upsert({
      where: { id: item.id },
      update: item,
      create: item,
    });
  }
}

async function seedPriceSnapshots() {
  const snapshots = [
    {
      itemType: ItemType.CARD,
      cardPrintingId: ids.cards.charizard151,
      condition: ItemCondition.NEAR_MINT,
      language: "en",
      variantLabel: "Standard",
      priceMinor: 11800,
      confidenceScore: 68,
      sampleSize: 12,
    },
    {
      itemType: ItemType.CARD,
      cardPrintingId: ids.cards.umbreonVmax,
      condition: ItemCondition.NEAR_MINT,
      language: "en",
      variantLabel: "Alternate art",
      gradedCompany: GradingCompany.OTHER,
      priceMinor: 74000,
      confidenceScore: 84,
      sampleSize: 25,
    },
    {
      itemType: ItemType.CARD,
      cardPrintingId: ids.cards.mew151,
      condition: ItemCondition.NEAR_MINT,
      language: "en",
      variantLabel: "Standard",
      priceMinor: 3500,
      confidenceScore: 72,
      sampleSize: 18,
    },
    {
      itemType: ItemType.CARD,
      cardPrintingId: ids.cards.pikachuCrownZenith,
      condition: ItemCondition.NEAR_MINT,
      language: "en",
      variantLabel: "Standard",
      priceMinor: 1450,
      confidenceScore: 86,
      sampleSize: 40,
    },
    {
      itemType: ItemType.SEALED_PRODUCT,
      sealedProductId: ids.sealed.bundle151,
      condition: ItemCondition.SEALED,
      language: "en",
      variantLabel: "Factory sealed",
      priceMinor: 3200,
      confidenceScore: 48,
      sampleSize: 7,
    },
    {
      itemType: ItemType.SEALED_PRODUCT,
      sealedProductId: ids.sealed.evolvingSkiesBox,
      condition: ItemCondition.SEALED,
      language: "en",
      variantLabel: "Factory sealed",
      priceMinor: 45000,
      confidenceScore: 65,
      sampleSize: 9,
    },
  ];

  await prisma.priceSnapshot.deleteMany({
    where: {
      source: "sample",
      observedAt,
    },
  });

  for (const snapshot of snapshots) {
    await prisma.priceSnapshot.create({
      data: {
        ...snapshot,
        source: "sample",
        sourceRef: "seed",
        currency: "GBP",
        observedAt,
        metadata: { note: "Seeded sample price snapshot." },
      },
    });
  }
}

async function seedCollectionEvents() {
  const events = [
    {
      collectionItemId: ids.collection.umbreon,
      quantity: 1,
      occurredAt: new Date("2024-11-12T00:00:00.000Z"),
      notes: "Seeded initial collection item.",
    },
    {
      collectionItemId: ids.collection.charizard,
      quantity: 1,
      occurredAt: new Date("2026-05-01T00:00:00.000Z"),
      notes: "Seeded initial collection item.",
    },
    {
      collectionItemId: ids.collection.bundle,
      quantity: 2,
      occurredAt: new Date("2025-08-18T00:00:00.000Z"),
      notes: "Seeded initial collection item.",
    },
  ];

  await prisma.collectionEvent.deleteMany({
    where: {
      userId: ids.user,
      eventType: CollectionEventType.ADDED,
      notes: "Seeded initial collection item.",
    },
  });

  for (const event of events) {
    await prisma.collectionEvent.create({
      data: {
        ...event,
        userId: ids.user,
        eventType: CollectionEventType.ADDED,
        metadata: { source: "seed" },
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seed data created.");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  }).toString("base64url");

  return `scrypt$16384$8$1$${salt}$${hash}`;
}
