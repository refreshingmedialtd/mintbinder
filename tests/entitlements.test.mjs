import assert from "node:assert/strict";
import test from "node:test";
import { entitlementStatus } from "../src/lib/entitlement-status.ts";
import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { hasEffectivePlusAccess } from "../src/lib/billing/effective-access.ts";

test("entitlement failures return forbidden", () => {
  const error = new Error("Plus subscription required.");
  error.name = "EntitlementError";

  assert.equal(entitlementStatus(error), 403);
});

test("unexpected entitlement-path failures return a server error", () => {
  assert.equal(entitlementStatus(new Error("database unavailable")), 500);
  assert.equal(entitlementStatus(undefined), 500);
});

test("scheduled cancellation expires exactly at the known paid-through time", () => {
  const currentPeriodEnd = new Date("2026-09-01T00:00:00.000Z");
  const subscription = {
    cancelAtPeriodEnd: true,
    currentPeriodEnd,
    plan: SubscriptionPlan.PLUS_MONTHLY,
    status: SubscriptionStatus.ACTIVE,
  };

  assert.equal(hasEffectivePlusAccess(subscription, new Date(currentPeriodEnd.getTime() - 1)), true);
  assert.equal(hasEffectivePlusAccess(subscription, currentPeriodEnd), false);
  assert.equal(hasEffectivePlusAccess(subscription, new Date(currentPeriodEnd.getTime() + 1)), false);
  assert.equal(hasEffectivePlusAccess({ ...subscription, currentPeriodEnd: null }), true);
});
