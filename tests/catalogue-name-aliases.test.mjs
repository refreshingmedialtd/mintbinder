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

test("provides English catalogue labels across international set languages", () => {
  assert.equal(catalogueDisplaySetForText("きせきの結晶"), "Miracle Crystal");
  assert.equal(catalogueDisplaySetForText("火箭隊的榮耀"), "Glory of Team Rocket");
  assert.equal(catalogueDisplaySetForText("미래의 일섬"), "Future Flash");
});

test("uses a readable provider-code fallback for future untranslated sets", () => {
  assert.equal(
    catalogueDisplaySetForText("未知のセット", { language: "ja", providerCode: "NEW1" }),
    "Japanese set NEW1",
  );
});
