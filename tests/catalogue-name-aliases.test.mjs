import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogueDisplayCardForText,
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

test("translates Pokemon names across Korean, Japanese, and Chinese catalogues", () => {
  assert.equal(catalogueDisplayNameForText("\uC57C\uB098\uD504"), "Pansage");
  assert.equal(catalogueDisplayNameForText("\u30E1\u30AC\u30EA\u30B6\u30FC\u30C9\u30F3Xex"), "Mega Charizard X ex");
  assert.equal(catalogueDisplayNameForText("\u55B7\u706B\u9F99 ex"), "Charizard ex");
});

test("uses a readable numbered fallback for untranslated trainer cards", () => {
  assert.equal(
    catalogueDisplayCardForText("\uBD88\uC0AC\uB974\uAE30", { number: "087", supertype: "Trainer" }),
    "Trainer card 087",
  );
});

test("does not leak residual international script from a partial card translation", () => {
  assert.equal(
    catalogueDisplayCardForText(`\uBD88\uBA85 ${"\uC57C\uB098\uD504"}`, { number: "001" }),
    "Pokemon card 001",
  );
});
