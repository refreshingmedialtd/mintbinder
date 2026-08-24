import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSaleQuantity,
  proportionalMinor,
  remainingMinor,
} from "../src/lib/collection/mutations.ts";

test("defaults a sale to the full lot and accepts bounded partial quantities", () => {
  assert.equal(normalizeSaleQuantity(undefined, 3), 3);
  assert.equal(normalizeSaleQuantity(1, 3), 1);
  assert.equal(normalizeSaleQuantity(3, 3), 3);
});

test("rejects invalid partial-sale quantities", () => {
  assert.throws(() => normalizeSaleQuantity(0, 3), /between 1 and 3/);
  assert.throws(() => normalizeSaleQuantity(4, 3), /between 1 and 3/);
  assert.throws(() => normalizeSaleQuantity(1.5, 3), /between 1 and 3/);
});

test("prorates lot-level monetary values for partial sales", () => {
  assert.equal(proportionalMinor(10_000, 1, 4), 2_500);
  assert.equal(proportionalMinor(10_001, 3, 4), 7_501);
  assert.equal(proportionalMinor(null, 1, 4), null);
  assert.equal(remainingMinor(10_001, 7_501), 2_500);
  assert.equal(remainingMinor(10_001, proportionalMinor(10_001, 1, 2)), 5_000);
  assert.equal(remainingMinor(null, null), null);
});
