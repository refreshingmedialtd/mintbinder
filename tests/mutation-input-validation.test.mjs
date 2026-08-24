import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  boundedOptionalText,
  boundedRequiredText,
  moneyInputToMinor,
  PERSISTED_INPUT_LIMITS,
  PersistedInputError,
} from "../src/lib/db/input-validation.ts";

test("persisted text accepts each exact limit and rejects max plus one", () => {
  for (const [field, limit] of Object.entries(PERSISTED_INPUT_LIMITS)) {
    assert.equal(boundedOptionalText("x".repeat(limit), field, limit).length, limit);
    assert.throws(
      () => boundedOptionalText("x".repeat(limit + 1), field, limit),
      (error) => error instanceof PersistedInputError && /characters or fewer/.test(error.message),
    );
  }
  assert.equal(boundedRequiredText(" Main binder ", "Name", 20), "Main binder");
  assert.throws(() => boundedRequiredText(" ", "Name", 20), /Name is required/);
  assert.throws(() => boundedOptionalText({ text: "no" }, "Notes", 20), /must be text/);
  assert.throws(() => boundedOptionalText("unsafe\u0000text", "Notes", 20), /control characters/);
});

test("money parsing rejects signs, decorations, malformed decimals, and database overflow", () => {
  assert.equal(moneyInputToMinor("0"), 0);
  assert.equal(moneyInputToMinor("12.34"), 1_234);
  assert.equal(moneyInputToMinor(12.34), 1_234);
  assert.equal(moneyInputToMinor(""), undefined);

  for (const invalid of ["-1", "+1", "£1.00", "1,000", "1.234", "1..2", "01.00", -1, 1.234]) {
    assert.throws(() => moneyInputToMinor(invalid), PersistedInputError);
  }
  assert.throws(() => moneyInputToMinor("21474836.48"), /outside the supported range/);
});

test("collection, storage, sealed, sale, and wishlist writes use bounded validators", async () => {
  const source = await readFile(new URL("../src/lib/db/app-data.ts", import.meta.url), "utf8");
  for (const label of [
    "Catalogue item id",
    "Purchase price",
    "Value override",
    "Variant",
    "Valuation note",
    "Sale notes",
    "Storage location name",
    "Storage notes",
    "Sealed product name",
    "Estimated value",
    "Wishlist target price",
    "Wishlist notes",
  ]) {
    assert.match(source, new RegExp(label));
  }
  assert.doesNotMatch(source, /function parseMoneyToMinor/);
});
