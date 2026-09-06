import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTcgcsvPriceIdentityRepairPlan,
  runTcgcsvPriceIdentityRepair,
} from "../scripts/repair-tcgcsv-price-identities.mjs";

test("builds a non-destructive relabelling plan for historical parallel printings", () => {
  const rows = [
    {
      cardPrintingId: "card-162",
      metadata: { tcgplayerUrl: "https://example.test/giovanni-normal" },
      source: "tcgcsv-japan-card",
      sourceRef: "566507",
      variantLabel: "Holofoil",
    },
    {
      cardPrintingId: "card-162",
      metadata: { tcgplayerUrl: "https://example.test/giovanni-poke-ball-pattern" },
      source: "tcgcsv-japan-card",
      sourceRef: "566702",
      variantLabel: "Holofoil",
    },
    {
      cardPrintingId: "card-162",
      metadata: { tcgplayerUrl: "https://example.test/giovanni-poke-ball-pattern" },
      source: "tcgcsv-japan-card",
      sourceRef: "566702",
      variantLabel: "Holofoil",
    },
    {
      cardPrintingId: "card-162",
      metadata: { tcgplayerUrl: "https://example.test/giovanni-master-ball-pattern" },
      source: "tcgcsv-japan-card",
      sourceRef: "566855",
      variantLabel: "Holofoil",
    },
  ];
  const plan = buildTcgcsvPriceIdentityRepairPlan(rows);

  assert.equal(plan.collisionStreams, 1);
  assert.equal(plan.snapshotsToRelabel, 3);
  assert.deepEqual(plan.operations.map((operation) => ({
    count: operation.snapshotCount,
    ref: operation.sourceRef,
    to: operation.toVariantLabel,
  })), [
    { count: 2, ref: "566702", to: "Poke Ball Reverse Holofoil" },
    { count: 1, ref: "566855", to: "Master Ball Reverse Holofoil" },
  ]);
});

test("separates collapsed raw subtypes for a card actually named Master Ball", () => {
  const rows = [
    {
      cardPrintingId: "card-master-ball",
      metadata: {
        subTypeName: "Normal",
        tcgplayerUrl: "https://example.test/master-ball-153-165",
      },
      source: "tcgcsv-card",
      sourceRef: "555153",
      variantLabel: "Master Ball Reverse Holofoil",
    },
    {
      cardPrintingId: "card-master-ball",
      metadata: {
        subTypeName: "Reverse Holofoil",
        tcgplayerUrl: "https://example.test/master-ball-153-165",
      },
      source: "tcgcsv-card",
      sourceRef: "555153",
      variantLabel: "Master Ball Reverse Holofoil",
    },
  ];
  const plan = buildTcgcsvPriceIdentityRepairPlan(rows);

  assert.equal(plan.collisionStreams, 1);
  assert.equal(plan.snapshotsToRelabel, 2);
  assert.deepEqual(plan.operations.map((operation) => ({
    from: operation.fromVariantLabel,
    rawSubtypeName: operation.rawSubtypeName,
    to: operation.toVariantLabel,
  })), [
    {
      from: "Master Ball Reverse Holofoil",
      rawSubtypeName: "Normal",
      to: "Normal",
    },
    {
      from: "Master Ball Reverse Holofoil",
      rawSubtypeName: "Reverse Holofoil",
      to: "Reverse Holofoil",
    },
  ]);
});

test("explicit repair reports and gates active, archived, and wishlisted affected variants", async () => {
  const countCalls = [];
  let updateCalls = 0;
  let transactionOptions;
  const prisma = {
    $queryRawUnsafe: async () => collapsedMasterBallRows(),
    $transaction: async (operation, options) => {
      transactionOptions = options;
      return operation(prisma);
    },
    collectionItem: {
      count: async ({ where }) => {
        countCalls.push({ model: "collectionItem", where });
        return where.archivedAt === null ? 1 : 2;
      },
    },
    priceSnapshot: {
      updateMany: async () => {
        updateCalls += 1;
        return { count: 1 };
      },
    },
    wishlistItem: {
      count: async ({ where }) => {
        countCalls.push({ model: "wishlistItem", where });
        return 3;
      },
    },
  };

  const dryRun = await runTcgcsvPriceIdentityRepair({ confirm: false, prisma });

  assert.equal(dryRun.affectedActiveCollectionItems, 1);
  assert.equal(dryRun.affectedArchivedCollectionItems, 2);
  assert.equal(dryRun.affectedCollectionItems, 3);
  assert.equal(dryRun.affectedWishlistItems, 3);
  assert.equal(dryRun.affectedUserVariantReferences, 6);
  assert.equal(updateCalls, 0);
  assert.deepEqual(countCalls.map(({ model, where }) => ({
    archivedAt: where.archivedAt,
    model,
    streams: where.OR,
  })), [
    {
      archivedAt: null,
      model: "collectionItem",
      streams: [{
        cardPrintingId: "card-master-ball",
        variantLabel: "Master Ball Reverse Holofoil",
      }],
    },
    {
      archivedAt: { not: null },
      model: "collectionItem",
      streams: [{
        cardPrintingId: "card-master-ball",
        variantLabel: "Master Ball Reverse Holofoil",
      }],
    },
    {
      archivedAt: undefined,
      model: "wishlistItem",
      streams: [{
        cardPrintingId: "card-master-ball",
        variantLabel: "Master Ball Reverse Holofoil",
      }],
    },
  ]);

  await assert.rejects(
    runTcgcsvPriceIdentityRepair({ confirm: true, prisma }),
    /6 user variant reference\(s\).*1 active collection.*2 archived collection.*3 wishlist.*--allow-ambiguous-user-variants/s,
  );
  assert.deepEqual(transactionOptions, {
    isolationLevel: "Serializable",
    maxWait: 10_000,
    timeout: 60_000,
  });
  assert.equal(updateCalls, 0);
});

test("explicit repair mutates historical rows only after the comprehensive reference override", async () => {
  const updates = [];
  let transactionOptions;
  const prisma = {
    $queryRawUnsafe: async () => collapsedMasterBallRows(),
    $transaction: async (operation, options) => {
      transactionOptions = options;
      return operation(prisma);
    },
    collectionItem: {
      count: async () => 1,
    },
    priceSnapshot: {
      updateMany: async (args) => {
        updates.push(args);
        return { count: 1 };
      },
    },
    wishlistItem: {
      count: async () => 1,
    },
  };

  const result = await runTcgcsvPriceIdentityRepair({
    allowAmbiguousUserVariants: true,
    confirm: true,
    prisma,
  });

  assert.equal(result.snapshotsRelabelled, 2);
  assert.deepEqual(transactionOptions, {
    isolationLevel: "Serializable",
    maxWait: 10_000,
    timeout: 60_000,
  });
  assert.equal(updates.length, 2);
  assert.deepEqual(updates.map(({ data, where }) => ({
    metadata: where.metadata,
    to: data.variantLabel,
  })), [
    {
      metadata: { equals: "Normal", path: ["subTypeName"] },
      to: "Normal",
    },
    {
      metadata: { equals: "Reverse Holofoil", path: ["subTypeName"] },
      to: "Reverse Holofoil",
    },
  ]);
});

test("explicit repair rolls every relabel back when a later operation fails", async () => {
  let committedUpdates = 0;
  let transactionCalls = 0;
  const prisma = {
    $transaction: async (operation, options) => {
      transactionCalls += 1;
      assert.deepEqual(options, {
        isolationLevel: "Serializable",
        maxWait: 10_000,
        timeout: 60_000,
      });
      let stagedUpdates = 0;
      const transaction = {
        $queryRawUnsafe: async () => collapsedMasterBallRows(),
        collectionItem: { count: async () => 0 },
        priceSnapshot: {
          updateMany: async () => {
            stagedUpdates += 1;
            if (stagedUpdates === 2) {
              throw new Error("simulated second relabel failure");
            }
            return { count: 1 };
          },
        },
        wishlistItem: { count: async () => 0 },
      };

      const result = await operation(transaction);
      committedUpdates += stagedUpdates;
      return result;
    },
  };

  await assert.rejects(
    runTcgcsvPriceIdentityRepair({ confirm: true, prisma }),
    /simulated second relabel failure/,
  );
  assert.equal(transactionCalls, 1);
  assert.equal(committedUpdates, 0);
});

function collapsedMasterBallRows() {
  return [
    {
      cardPrintingId: "card-master-ball",
      metadata: {
        subTypeName: "Normal",
        tcgplayerUrl: "https://example.test/master-ball-153-165",
      },
      source: "tcgcsv-card",
      sourceRef: "555153",
      variantLabel: "Master Ball Reverse Holofoil",
    },
    {
      cardPrintingId: "card-master-ball",
      metadata: {
        subTypeName: "Reverse Holofoil",
        tcgplayerUrl: "https://example.test/master-ball-153-165",
      },
      source: "tcgcsv-card",
      sourceRef: "555153",
      variantLabel: "Master Ball Reverse Holofoil",
    },
  ];
}
