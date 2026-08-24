import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hashPassword, verifyPassword } from "../src/lib/auth/password.ts";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordPolicyError,
} from "../src/lib/auth/password-policy.ts";
import { requiredAuthSecret } from "../src/lib/auth/secret.ts";
import {
  ACCOUNT_DISPLAY_NAME_MAX_LENGTH,
  ACCOUNT_EMAIL_MAX_LENGTH,
  normalizeAccountDisplayName,
  normalizeAccountEmail,
} from "../src/lib/auth/registration-input.ts";
import {
  credentialsRegistrationAvailable,
  passwordResetSessionUpdate,
  sessionVersionMatches,
} from "../src/lib/auth/session-security.ts";

test("requires the dedicated Auth.js secret and never falls back to the job secret", () => {
  assert.throws(
    () => requiredAuthSecret({ JOB_SECRET: "job-secret-only" }),
    /AUTH_SECRET is required/,
  );
  assert.equal(
    requiredAuthSecret({ AUTH_SECRET: "dedicated-auth-secret", JOB_SECRET: "job-secret" }),
    "dedicated-auth-secret",
  );
});

test("hashes and verifies passwords asynchronously", async () => {
  const hashPromise = hashPassword("correct horse battery staple");

  assert.equal(hashPromise instanceof Promise, true);
  const storedHash = await hashPromise;
  assert.equal(await verifyPassword("correct horse battery staple", storedHash), true);
  assert.equal(await verifyPassword("incorrect", storedHash), false);
  assert.equal(await verifyPassword("anything", "not-a-supported-hash"), false);
});

test("enforces bounded, non-trivial account passwords", () => {
  assert.match(passwordPolicyError("a".repeat(PASSWORD_MIN_LENGTH - 1)), /at least/);
  assert.equal(passwordPolicyError("correct horse battery staple"), null);
  assert.match(passwordPolicyError("password1234"), /less predictable/);
  assert.match(passwordPolicyError("a".repeat(PASSWORD_MAX_LENGTH + 1)), /no more than/);
});

test("does not let registration claim a pre-created passwordless account", () => {
  assert.equal(credentialsRegistrationAvailable(null), true);
  assert.equal(credentialsRegistrationAvailable({ passwordHash: null, role: "ADMIN" }), false);
});

test("password reset increments the session version and invalidates old JWTs", () => {
  assert.deepEqual(passwordResetSessionUpdate("new-hash"), {
    passwordHash: "new-hash",
    sessionVersion: { increment: 1 },
  });
  assert.equal(sessionVersionMatches(2, 1), false);
  assert.equal(sessionVersionMatches(2, 2), true);
  assert.equal(sessionVersionMatches(0, undefined), true);
});

test("registration creates notification preferences atomically with the user", async () => {
  const source = await readFile(new URL("../src/auth.ts", import.meta.url), "utf8");

  assert.match(source, /notificationPreference:\s*\{\s*create:\s*\{\s*\}/);
  assert.doesNotMatch(source, /await\s+ensureNotificationPreferences/);
});

test("registration canonicalizes practical bounded email addresses", () => {
  assert.equal(
    normalizeAccountEmail("Collector.Example+tag@Example.CO.UK"),
    "collector.example+tag@example.co.uk",
  );

  for (const malformed of [
    "collector",
    "collector@@example.com",
    ".collector@example.com",
    "collector..example@example.com",
    "collector@example",
    "collector@-example.com",
    " collector@example.com",
    "collector@example.com ",
    "collector @example.com",
    "collector\n@example.com",
    "collector@example.com\r\nBcc: victim@example.com",
  ]) {
    assert.equal(normalizeAccountEmail(malformed), null, malformed);
  }

  const maxLengthEmail = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
  const overLengthEmail = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`;
  assert.equal(maxLengthEmail.length, ACCOUNT_EMAIL_MAX_LENGTH);
  assert.equal(normalizeAccountEmail(maxLengthEmail), maxLengthEmail);
  assert.equal(overLengthEmail.length, ACCOUNT_EMAIL_MAX_LENGTH + 1);
  assert.equal(normalizeAccountEmail(overLengthEmail), null);
});

test("registration display names are optional, trimmed, control-free, and bounded", () => {
  assert.deepEqual(normalizeAccountDisplayName(undefined), { valid: true, value: null });
  assert.deepEqual(normalizeAccountDisplayName("  Collector  "), { valid: true, value: "Collector" });
  assert.deepEqual(normalizeAccountDisplayName("a".repeat(ACCOUNT_DISPLAY_NAME_MAX_LENGTH)), {
    valid: true,
    value: "a".repeat(ACCOUNT_DISPLAY_NAME_MAX_LENGTH),
  });
  assert.deepEqual(normalizeAccountDisplayName("a".repeat(ACCOUNT_DISPLAY_NAME_MAX_LENGTH + 1)), {
    valid: false,
    value: null,
  });
  assert.deepEqual(normalizeAccountDisplayName("Collector\nAdmin"), { valid: false, value: null });
});

test("registration rejects bounded-input failures before password hashing or database access", async () => {
  const source = await readFile(new URL("../src/auth.ts", import.meta.url), "utf8");
  const validation = source.indexOf("!displayNameInput.valid || passwordPolicyError(password)");
  const lookup = source.indexOf("prisma.user.findUnique");
  const hashing = source.indexOf("const passwordHash = await hashPassword(password)");

  assert.ok(validation >= 0);
  assert.ok(validation < lookup);
  assert.ok(validation < hashing);
  assert.match(source, /const passwordHash = await hashPassword\(password\)[\s\S]+credentialsRegistrationAvailable/);
});
