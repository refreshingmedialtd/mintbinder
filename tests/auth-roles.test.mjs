import assert from "node:assert/strict";
import test from "node:test";
import {
  canUseOperations,
  canUseOperationsForUser,
  normalizeAppRole,
} from "../src/lib/auth/roles.ts";

test("normalizes supported app roles", () => {
  assert.equal(normalizeAppRole("ADMIN"), "ADMIN");
  assert.equal(normalizeAppRole("USER"), "USER");
  assert.equal(normalizeAppRole(undefined), "USER");
  assert.equal(normalizeAppRole("admin"), "USER");
});

test("allows Operations for admins only", () => {
  assert.equal(canUseOperations("ADMIN"), true);
  assert.equal(canUseOperations("USER"), false);
  assert.equal(canUseOperations(null), false);
});

test("allows Operations only for stored admin roles", () => {
  assert.equal(canUseOperationsForUser("USER", "liam@refreshing.media"), false);
  assert.equal(canUseOperationsForUser("USER", "liam@example.com"), false);
  assert.equal(canUseOperationsForUser("ADMIN", "liam@example.com"), true);
});
