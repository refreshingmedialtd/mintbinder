import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeBulkWishlistCardIds,
  normalizeSetGoalInput,
  planSetWishlistBulkAdd,
  SET_BUILDER_BULK_WISHLIST_LIMIT,
  SetBuilderInputError,
} from "../src/lib/set-builder.ts";
import {
  bulkAddActiveSetWishlistInTransaction,
  deleteActiveSetGoal,
  getActiveSetGoal,
  putActiveSetGoal,
} from "../src/lib/db/set-builder.ts";

const userId = uuid(1);
const setId = uuid(2);
const otherSetId = uuid(3);
const cardA = uuid(10);
const cardB = uuid(11);
const cardC = uuid(12);
const outsideCard = uuid(13);

test("normalizes bounded set-goal settings and rejects malformed input", () => {
  assert.deepEqual(normalizeSetGoalInput({
    cardSetId: setId.toUpperCase(),
    targetCompletionPercent: 85,
    wishlistPriority: "high",
  }), {
    cardSetId: setId,
    targetCompletionPercent: 85,
    wishlistPriority: "HIGH",
  });
  assert.throws(
    () => normalizeSetGoalInput({ cardSetId: setId, targetCompletionPercent: 0 }),
    /whole number from 1 to 100/,
  );
  assert.throws(
    () => normalizeSetGoalInput({ cardSetId: "not-an-id" }),
    /valid id/,
  );

  assert.deepEqual(normalizeBulkWishlistCardIds([cardA, cardA, cardB]), [cardA, cardB]);
  assert.throws(
    () => normalizeBulkWishlistCardIds(
      Array.from({ length: SET_BUILDER_BULK_WISHLIST_LIMIT + 1 }, (_, index) => uuid(index + 100)),
    ),
    (error) => error instanceof SetBuilderInputError && error.status === 413,
  );
});

test("plans only missing, non-wishlisted printings from the active set", () => {
  assert.deepEqual(planSetWishlistBulkAdd({
    setCardIds: [cardA, cardB, cardC],
    requestedCardIds: [cardA, cardB, cardC, outsideCard],
    wishlistedCardIds: [cardB],
    ownedCardIds: [cardC],
  }), {
    requested: 4,
    selected: 3,
    outsideActiveSetSkipped: 1,
    alreadyWishlistedCardIds: [cardB],
    ownedCardIdsToSkip: [cardC],
    cardPrintingIdsToAdd: [cardA],
  });
});

test("reads, upserts, and deletes the one goal using only the authenticated user", async () => {
  const calls = [];
  const record = goalRecord();
  const client = {
    cardSet: {
      async findUnique(args) {
        calls.push(["find-set", args]);
        return { id: setId };
      },
    },
    setGoal: {
      async findUnique(args) {
        calls.push(["find-goal", args]);
        return record;
      },
      async upsert(args) {
        calls.push(["upsert-goal", args]);
        return record;
      },
      async deleteMany(args) {
        calls.push(["delete-goal", args]);
        return { count: 1 };
      },
    },
  };

  const fetched = await getActiveSetGoal(userId, client);
  const saved = await putActiveSetGoal(userId, {
    cardSetId: setId,
    targetCompletionPercent: 90,
    wishlistPriority: "Grail",
  }, client);
  const deleted = await deleteActiveSetGoal(userId, client);

  assert.equal(fetched.cardSetId, setId);
  assert.equal(fetched.wishlistPriority, "Medium");
  assert.equal(saved.set.name, "Test Set");
  assert.equal(deleted, true);
  assert.deepEqual(calls[0][1].where, { userId });
  assert.deepEqual(calls[1][1].where, { id: setId });
  assert.deepEqual(calls[2][1].where, { userId });
  assert.equal(calls[2][1].create.userId, userId);
  assert.equal(calls[2][1].create.cardSetId, setId);
  assert.deepEqual(calls[3][1], { where: { userId } });
});

test("bulk wishlist writes are tenant-scoped, active-set-limited, and duplicate-safe", async () => {
  const calls = [];
  const transaction = bulkTransaction({
    calls,
    setCards: [cardA, cardB, cardC],
    wishlistedCards: [cardB],
    ownedCards: [cardC],
    inserted: 0,
  });

  const result = await bulkAddActiveSetWishlistInTransaction(
    transaction,
    userId,
    [cardA, cardB, cardC, outsideCard],
  );

  assert.deepEqual(calls[0], ["goal", { userId }]);
  assert.deepEqual(calls[1][1].where, {
    cardSetId: setId,
    id: { in: [cardA, cardB, cardC, outsideCard] },
  });
  assert.equal(calls[2][1].where.userId, userId);
  assert.equal(calls[3][1].where.userId, userId);
  assert.deepEqual(calls[4], ["lock"]);
  assert.deepEqual(calls[5], ["count", { userId }]);
  assert.deepEqual(calls[6][1], {
    data: [{
      userId,
      itemType: "CARD",
      cardPrintingId: cardA,
      priority: "MEDIUM",
      notes: "Added from Set Builder.",
    }],
    skipDuplicates: true,
  });
  assert.deepEqual(result, {
    activeSetId: setId,
    requested: 4,
    selected: 3,
    added: 0,
    alreadyWishlisted: 1,
    ownedSkipped: 1,
    outsideActiveSetSkipped: 1,
    concurrentDuplicatesSkipped: 1,
    cappedAt: SET_BUILDER_BULK_WISHLIST_LIMIT,
  });
});

test("bulk wishlist rejects an atomic plan that would exceed the account ceiling", async () => {
  const calls = [];
  const transaction = bulkTransaction({
    calls,
    currentWishlistCount: 1_999,
    setCards: [cardA, cardB],
    wishlistedCards: [],
    ownedCards: [],
    inserted: 0,
  });

  await assert.rejects(
    bulkAddActiveSetWishlistInTransaction(transaction, userId, [cardA, cardB]),
    /wishlist items limit \(2,000\)/,
  );
  assert.equal(calls.some(([kind]) => kind === "create"), false);
});

test("bulk wishlist requires an active goal and refuses an unbounded all-set action", async () => {
  await assert.rejects(
    bulkAddActiveSetWishlistInTransaction({
      setGoal: { async findUnique() { return null; } },
    }, userId),
    (error) => error instanceof SetBuilderInputError && error.status === 409,
  );

  let downstreamQueries = 0;
  await assert.rejects(
    bulkAddActiveSetWishlistInTransaction({
      setGoal: { async findUnique() { return { cardSetId: setId, wishlistPriority: "LOW" }; } },
      cardPrinting: {
        async findMany() {
          return Array.from(
            { length: SET_BUILDER_BULK_WISHLIST_LIMIT + 1 },
            (_, index) => ({ id: uuid(index + 1_000) }),
          );
        },
      },
      wishlistItem: { async findMany() { downstreamQueries += 1; return []; } },
      collectionItem: { async findMany() { downstreamQueries += 1; return []; } },
    }, userId),
    (error) => error instanceof SetBuilderInputError && error.status === 413,
  );
  assert.equal(downstreamQueries, 0);
});

test("the migration enforces one goal per user and cascades account/set deletion", async () => {
  const migration = await readFile(
    new URL("../prisma/migrations/20260824133000_add_binders_billing_events/migration.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /CREATE UNIQUE INDEX "set_goals_user_id_key"/);
  assert.match(
    migration,
    /"set_goals_user_id_fkey"[^;]+REFERENCES "users"\("id"\) ON DELETE CASCADE/,
  );
  assert.match(
    migration,
    /"set_goals_card_set_id_fkey"[^;]+REFERENCES "card_sets"\("id"\) ON DELETE CASCADE/,
  );
});

function bulkTransaction({ calls, currentWishlistCount = 0, inserted, ownedCards, setCards, wishlistedCards }) {
  return {
    async $executeRaw() {
      calls.push(["lock"]);
      return 1;
    },
    setGoal: {
      async findUnique(args) {
        calls.push(["goal", args.where]);
        return { cardSetId: setId, wishlistPriority: "MEDIUM" };
      },
    },
    cardPrinting: {
      async findMany(args) {
        calls.push(["cards", args]);
        assert.notEqual(args.where.cardSetId, otherSetId);
        return setCards.map((id) => ({ id }));
      },
    },
    wishlistItem: {
      async findMany(args) {
        calls.push(["wishlist", args]);
        return wishlistedCards.map((cardPrintingId) => ({ cardPrintingId }));
      },
      async createMany(args) {
        calls.push(["create", args]);
        return { count: inserted };
      },
      async count(args) {
        calls.push(["count", args.where]);
        return currentWishlistCount;
      },
    },
    collectionItem: {
      async findMany(args) {
        calls.push(["collection", args]);
        return ownedCards.map((cardPrintingId) => ({ cardPrintingId }));
      },
    },
  };
}

function goalRecord() {
  return {
    id: uuid(20),
    userId,
    cardSetId: setId,
    targetCompletionPercent: 100,
    wishlistPriority: "MEDIUM",
    createdAt: new Date("2026-08-24T12:00:00.000Z"),
    updatedAt: new Date("2026-08-24T13:00:00.000Z"),
    cardSet: {
      id: setId,
      name: "Test Set",
      language: "en",
      region: "international",
      series: "Test Series",
      releaseDate: new Date("2026-01-01T00:00:00.000Z"),
      printedTotal: 100,
      total: 110,
      symbolImageUrl: null,
      logoImageUrl: null,
    },
  };
}

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}
