import assert from "node:assert/strict";
import test from "node:test";
import { tcgdexJapaneseImageUrlFromProviderIds } from "../src/lib/catalogue/tcgdex-images.ts";

test("builds a same-card Japanese artwork fallback for international TCGdex IDs", () => {
  assert.equal(
    tcgdexJapaneseImageUrlFromProviderIds({ tcgdex: "SV4K-001" }),
    "https://assets.tcgdex.net/ja/SV/SV4K/001/high.png",
  );
});

test("ignores provider IDs that cannot identify a set and local number", () => {
  assert.equal(tcgdexJapaneseImageUrlFromProviderIds({ tcgdex: "invalid" }), undefined);
  assert.equal(tcgdexJapaneseImageUrlFromProviderIds(null), undefined);
});
