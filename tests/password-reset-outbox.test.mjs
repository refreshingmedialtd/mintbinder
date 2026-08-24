import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  passwordResetRecipientKey,
  processPasswordResetOutbox,
} from "../src/lib/auth/password-reset-outbox-core.ts";
import { accountTokenIssueCleanupFilter } from "../src/lib/auth/account-token-policy.ts";

const NOW = new Date("2026-08-24T12:00:00.000Z");
const SECRET = "test-auth-secret-with-enough-entropy";

test("public password-reset requests use canonical validation and only await durable enqueue work", () => {
  const route = readFileSync("src/app/api/auth/password-reset/request/route.ts", "utf8");

  assert.match(route, /normalizeAccountEmail\(body\.email\)/);
  assert.match(route, /await enqueuePasswordResetRequest\(email\)/);
  assert.doesNotMatch(route, /sendPasswordResetEmail|sendEmail|prisma\.user/);
  assert.match(route, /status: 202/);
  assert.match(route, /cache-control.*no-store/);
});

test("outbox persists only a keyed recipient fingerprint for unknown addresses", () => {
  const store = readFileSync("src/lib/auth/password-reset-outbox.ts", "utf8");
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync(
    "prisma/migrations/20260824133000_add_binders_billing_events/migration.sql",
    "utf8",
  );

  assert.match(store, /transaction\.user\.findUnique/);
  assert.match(store, /transaction\.passwordResetOutbox\.upsert/);
  assert.match(store, /userId: user\?\.id \?\? null/);
  assert.doesNotMatch(schema, /model PasswordResetOutbox[\s\S]*recipientEmail/);
  assert.doesNotMatch(migration, /CREATE TABLE "password_reset_outbox"[\s\S]*recipient_email/);
  assert.notEqual(
    passwordResetRecipientKey("missing@example.com", SECRET),
    "missing@example.com",
  );
  assert.equal(passwordResetRecipientKey("missing@example.com", SECRET).length, 64);
});

test("concurrent duplicate reset requests coalesce through one database-unique active key", async () => {
  const store = readFileSync("src/lib/auth/password-reset-outbox.ts", "utf8");
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync(
    "prisma/migrations/20260824133000_add_binders_billing_events/migration.sql",
    "utf8",
  );

  assert.match(schema, /coalesceKey\s+String\?\s+@unique\s+@map\("coalesce_key"\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "password_reset_outbox_coalesce_key_key"/);
  assert.match(migration, /CONSTRAINT "password_reset_outbox_active_coalesce_check" CHECK/);
  assert.match(store, /where: \{ coalesceKey: recipientKey \}/);
  assert.match(store, /create: \{[\s\S]*coalesceKey: recipientKey/);
  assert.equal((store.match(/coalesceKey: null/g) ?? []).length, 4);

  const activeRows = new Map();
  let nextId = 0;
  const atomicUpsert = async (recipientKey, userId) => {
    const existing = activeRows.get(recipientKey);
    if (existing) {
      existing.userId = userId;
      return existing;
    }

    const row = { id: `row-${++nextId}`, recipientKey, userId };
    activeRows.set(recipientKey, row);
    await Promise.resolve();
    return row;
  };

  const recipientKey = passwordResetRecipientKey("liam@example.com", SECRET);
  const rows = await Promise.all(
    Array.from({ length: 25 }, () => atomicUpsert(recipientKey, "user-1")),
  );

  assert.equal(activeRows.size, 1);
  assert.equal(new Set(rows.map((row) => row.id)).size, 1);
});

test("known and decoy requests use the same atomic coalescing operation", () => {
  const store = readFileSync("src/lib/auth/password-reset-outbox.ts", "utf8");
  const upsertCalls = store.match(/passwordResetOutbox\.upsert/g) ?? [];

  assert.equal(upsertCalls.length, 1);
  assert.match(store, /userId: user\?\.id \?\? null/);
  assert.doesNotMatch(store, /if \(user\)[\s\S]{0,200}passwordResetOutbox/);
});

test("unknown-recipient decoys traverse the claim and discard path without provider delivery", async () => {
  const store = storeDouble({
    rows: [{ id: "decoy-1", recipientKey: passwordResetRecipientKey("unknown@example.com", SECRET), userId: null }],
  });
  let deliveries = 0;
  const result = await processPasswordResetOutbox({
    batchSize: 10,
    deliver: async () => {
      deliveries += 1;
      return { id: "unexpected" };
    },
    now: NOW,
    recipientMatches,
    staleAfterMs: 15 * 60 * 1_000,
    store,
  });

  assert.equal(deliveries, 0);
  assert.deepEqual(result, {
    claimed: 1,
    discarded: 1,
    queued: 1,
    sent: 0,
    skippedClaims: 0,
    staleClaimsMarkedUnresolved: 0,
    unresolved: 0,
  });
  assert.deepEqual(store.calls, ["stale", "find", "claim:decoy-1", "discard:decoy-1"]);
});

test("known recipients send once after an atomic claim", async () => {
  const recipient = { displayName: "Liam", email: "liam@example.com", id: "user-1" };
  const store = storeDouble({
    recipient,
    rows: [{ id: "reset-1", recipientKey: passwordResetRecipientKey(recipient.email, SECRET), userId: recipient.id }],
  });
  let deliveries = 0;
  const result = await processPasswordResetOutbox({
    batchSize: 10,
    deliver: async () => {
      deliveries += 1;
      return { id: "provider-1" };
    },
    now: NOW,
    recipientMatches,
    staleAfterMs: 15 * 60 * 1_000,
    store,
  });

  assert.equal(deliveries, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.unresolved, 0);
  assert.deepEqual(store.calls.slice(-3), ["attempt:reset-1", "deliver-boundary", "sent:reset-1:provider-1"]);
});

test("a lost concurrent claim skips delivery", async () => {
  const recipient = { displayName: null, email: "liam@example.com", id: "user-1" };
  const store = storeDouble({
    claim: false,
    recipient,
    rows: [{ id: "reset-1", recipientKey: passwordResetRecipientKey(recipient.email, SECRET), userId: recipient.id }],
  });
  let deliveries = 0;
  const result = await processPasswordResetOutbox({
    batchSize: 10,
    deliver: async () => {
      deliveries += 1;
      return { id: "provider-1" };
    },
    now: NOW,
    recipientMatches,
    staleAfterMs: 15 * 60 * 1_000,
    store,
  });

  assert.equal(deliveries, 0);
  assert.equal(result.skippedClaims, 1);
  assert.equal(store.calls.some((call) => call.startsWith("attempt:")), false);
});

test("provider or post-send persistence errors become unresolved and are not retried", async () => {
  const recipient = { displayName: null, email: "liam@example.com", id: "user-1" };

  for (const failure of ["provider", "mark-sent"]) {
    const store = storeDouble({
      markSentError: failure === "mark-sent",
      recipient,
      rows: [{ id: `reset-${failure}`, recipientKey: passwordResetRecipientKey(recipient.email, SECRET), userId: recipient.id }],
    });
    let deliveries = 0;
    const result = await processPasswordResetOutbox({
      batchSize: 10,
      deliver: async () => {
        deliveries += 1;
        if (failure === "provider") throw new Error("response lost after acceptance");
        return { id: "provider-1" };
      },
      now: NOW,
      recipientMatches,
      staleAfterMs: 15 * 60 * 1_000,
      store,
    });

    assert.equal(deliveries, 1);
    assert.equal(result.sent, 0);
    assert.equal(result.unresolved, 1);
    assert.equal(store.calls.filter((call) => call.startsWith("unresolved:")).length, 1);
  }
});

test("abandoned claims are marked unresolved before new work and never reclaimed", async () => {
  const store = storeDouble({ rows: [], staleClaims: 2 });
  const result = await processPasswordResetOutbox({
    batchSize: 10,
    deliver: async () => ({ id: "provider-1" }),
    now: NOW,
    recipientMatches,
    staleAfterMs: 15 * 60 * 1_000,
    store,
  });

  assert.equal(result.staleClaimsMarkedUnresolved, 2);
  assert.equal(result.unresolved, 2);
  assert.deepEqual(store.calls, ["stale", "find"]);
});

test("reordered reset-email delivery leaves every live issued link usable", () => {
  const later = new Date(NOW.getTime() + 30 * 60 * 1_000);
  const issued = [
    { id: "first-email", expiresAt: later, usedAt: null },
    { id: "second-email", expiresAt: later, usedAt: null },
  ];
  const cleanup = accountTokenIssueCleanupFilter("PASSWORD_RESET", NOW);
  const retained = issued.filter((token) => !matchesCleanupFilter(token, cleanup));

  assert.deepEqual(retained.map((token) => token.id), ["first-email", "second-email"]);
  assert.deepEqual(
    ["second-email", "first-email"].map((id) => retained.some((token) => token.id === id)),
    [true, true],
  );

  assert.equal(
    matchesCleanupFilter({ expiresAt: new Date(NOW.getTime() - 1), usedAt: null }, cleanup),
    true,
  );
  assert.equal(matchesCleanupFilter({ expiresAt: later, usedAt: NOW }, cleanup), false);
  assert.deepEqual(accountTokenIssueCleanupFilter("EMAIL_VERIFICATION", NOW), { usedAt: null });

  const accountTokens = readFileSync("src/lib/auth/account-tokens.ts", "utf8");
  assert.match(accountTokens, /accountTokenIssueCleanupFilter\(type, issuedAt\)/);
  assert.match(accountTokens, /id: \{ not: accountToken\.id \}/);
});

function recipientMatches(recipientKey, recipient) {
  return recipientKey === passwordResetRecipientKey(recipient.email, SECRET);
}

function matchesCleanupFilter(token, filter) {
  if (filter.expiresAt && token.expiresAt > filter.expiresAt.lte) return false;
  if (filter.usedAt === null && token.usedAt !== null) return false;
  return true;
}

function storeDouble({
  claim = true,
  markSentError = false,
  recipient = null,
  rows = [],
  staleClaims = 0,
} = {}) {
  const calls = [];

  return {
    calls,
    async claim(id) {
      calls.push(`claim:${id}`);
      return claim;
    },
    async discard(id) {
      calls.push(`discard:${id}`);
    },
    async findQueued() {
      calls.push("find");
      return rows;
    },
    async loadRecipient(userId) {
      calls.push(`load:${userId}`);
      return recipient;
    },
    async markAttempted(id) {
      calls.push(`attempt:${id}`);
      calls.push("deliver-boundary");
    },
    async markSent(id, providerMessageId) {
      calls.push(`sent:${id}:${providerMessageId}`);
      if (markSentError) throw new Error("database response lost");
    },
    async markStaleClaimsUnresolved() {
      calls.push("stale");
      return staleClaims;
    },
    async markUnresolved(id, error) {
      calls.push(`unresolved:${id}:${error instanceof Error ? error.name : "UnknownError"}`);
    },
  };
}
