import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogueDisplayNameForText,
  catalogueDisplaySetForText,
} from "../src/lib/catalogue/name-aliases.ts";

test("provides readable English labels for Japanese Mega Charizard records", () => {
  assert.equal(catalogueDisplayNameForText("メガリザードンXex"), "Mega Charizard X ex");
  assert.equal(catalogueDisplaySetForText("インフェルノX"), "Inferno X");
});
