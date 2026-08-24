import assert from "node:assert/strict";
import test from "node:test";
import {
  clearAuthThrottleReservation,
  consumeAuthThrottleAttempt,
} from "../src/lib/auth/rate-limit-core.ts";

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const NOW = new Date("2026-08-24T12:00:00.000Z");

test("50 concurrent attempts reserve atomically and only the email allowance reaches the verifier", async () => {
  const store = new InMemoryAtomicThrottleStore();
  let verifierCalls = 0;
  const keys = [
    { action: "credentials", hash: "email:collector@example.com", limit: 8 },
    { action: "credentials", hash: "ip:192.0.2.1", limit: 30 },
  ];

  const results = await Promise.all(Array.from({ length: 50 }, async () => {
    const consumption = await consume(store, keys, NOW);

    if (!consumption.allowed) return false;
    verifierCalls += 1;
    return true;
  }));

  assert.equal(verifierCalls, 8);
  assert.equal(results.filter(Boolean).length, 8);
  assert.equal(store.get("email:collector@example.com").attempts, 8);
  assert.equal(store.get("ip:192.0.2.1").attempts, 8);
  assert.equal(
    store.get("email:collector@example.com").blockedUntil.toISOString(),
    "2026-08-24T12:15:00.000Z",
  );
});

test("the shared IP allowance remains atomic across different email keys", async () => {
  const store = new InMemoryAtomicThrottleStore();
  let verifierCalls = 0;

  await Promise.all(Array.from({ length: 50 }, async (_, index) => {
    const consumption = await consume(store, [
      { action: "credentials", hash: `email:collector-${index}@example.com`, limit: 8 },
      { action: "credentials", hash: "ip:198.51.100.8", limit: 30 },
    ], NOW);

    if (consumption.allowed) verifierCalls += 1;
  }));

  assert.equal(verifierCalls, 30);
  assert.equal(store.get("ip:198.51.100.8").attempts, 30);
  assert.equal(
    store.get("ip:198.51.100.8").blockedUntil.toISOString(),
    "2026-08-24T12:15:00.000Z",
  );
  assert.equal(store.size, 31, "blocked attempts must not consume otherwise-unblocked email scopes");
});

test("an active block rejects without consuming another scope", async () => {
  const store = new InMemoryAtomicThrottleStore();
  const blockedEmail = { action: "credentials", hash: "email:blocked@example.com", limit: 8 };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    assert.equal((await consume(store, [blockedEmail], NOW)).allowed, true);
  }

  const denied = await consume(store, [
    blockedEmail,
    { action: "credentials", hash: "ip:new-address", limit: 30 },
  ], NOW);

  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 15 * 60);
  assert.equal(store.has("ip:new-address"), false);
});

test("an expired block starts a fresh window and allowance", async () => {
  const store = new InMemoryAtomicThrottleStore();
  const key = { action: "credentials", hash: "email:retry@example.com", limit: 8 };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await consume(store, [key], NOW);
  }

  const afterBlock = new Date(NOW.getTime() + BLOCK_MS + 1);
  const retried = await consume(store, [key], afterBlock);

  assert.equal(retried.allowed, true);
  assert.equal(store.get(key.hash).attempts, 1);
  assert.equal(store.get(key.hash).blockedUntil, null);
  assert.equal(store.get(key.hash).windowStartedAt.toISOString(), afterBlock.toISOString());
});

test("successful clearing cannot erase a newer concurrent reservation", async () => {
  const store = new InMemoryAtomicThrottleStore();
  const key = { action: "credentials", hash: "email:success@example.com", limit: 8 };
  const first = await consume(store, [key], NOW);
  const second = await consume(store, [key], new Date(NOW.getTime() + 1));

  await clearAuthThrottleReservation(store, first.reservation);
  assert.equal(store.get(key.hash).attempts, 2, "the later attempt must survive an older success");

  await clearAuthThrottleReservation(store, second.reservation);
  assert.equal(store.has(key.hash), false, "the latest successful reservation clears its own history");
});

test("mail-send keys enforce an hourly and daily recipient ceiling under concurrency", async () => {
  const store = new InMemoryAtomicThrottleStore();
  const mailKeys = [
    { action: "password-reset", hash: "email-hour", limit: 3, windowMs: 60 * 60 * 1_000, blockMs: 60 * 60 * 1_000 },
    { action: "password-reset", hash: "email-day", limit: 6, windowMs: 24 * 60 * 60 * 1_000, blockMs: 24 * 60 * 60 * 1_000 },
  ];
  const firstWave = await Promise.all(Array.from({ length: 12 }, () => consume(store, mailKeys, NOW)));
  assert.equal(firstWave.filter((entry) => entry.allowed).length, 3);

  const secondHour = new Date(NOW.getTime() + 60 * 60 * 1_000 + 1);
  const secondWave = await Promise.all(Array.from({ length: 6 }, () => consume(store, mailKeys, secondHour)));
  assert.equal(secondWave.filter((entry) => entry.allowed).length, 3);

  const thirdHour = new Date(secondHour.getTime() + 60 * 60 * 1_000 + 1);
  const dailyBlocked = await consume(store, mailKeys, thirdHour);
  assert.equal(dailyBlocked.allowed, false);
  assert.equal(dailyBlocked.retryAfterSeconds > 20 * 60 * 60, true);
});

function consume(store, keys, now) {
  return consumeAuthThrottleAttempt(store, keys, {
    blockMs: BLOCK_MS,
    now,
    windowMs: WINDOW_MS,
  });
}

class InMemoryAtomicThrottleStore {
  #records = new Map();
  #tail = Promise.resolve();

  get size() {
    return this.#records.size;
  }

  get(keyHash) {
    const record = this.#records.get(keyHash);
    assert.ok(record, `Expected throttle record ${keyHash}.`);
    return cloneRecord(record);
  }

  has(keyHash) {
    return this.#records.has(keyHash);
  }

  async withLockedKeys(_keyHashes, operation) {
    const previous = this.#tail;
    let release;
    this.#tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      return await operation({
        deleteMatching: async (records) => {
          for (const expected of records) {
            const current = this.#records.get(expected.keyHash);

            if (current &&
              current.attempts === expected.attempts &&
              current.updatedAt.getTime() === expected.updatedAt.getTime() &&
              current.windowStartedAt.getTime() === expected.windowStartedAt.getTime()) {
              this.#records.delete(expected.keyHash);
            }
          }
        },
        findMany: async (keyHashes) => keyHashes
          .map((keyHash) => this.#records.get(keyHash))
          .filter(Boolean)
          .map(cloneRecord),
        save: async (records) => {
          for (const record of records) {
            this.#records.set(record.keyHash, cloneRecord(record));
          }
        },
      });
    } finally {
      release();
    }
  }
}

function cloneRecord(record) {
  return {
    ...record,
    blockedUntil: record.blockedUntil ? new Date(record.blockedUntil) : null,
    updatedAt: new Date(record.updatedAt),
    windowStartedAt: new Date(record.windowStartedAt),
  };
}
