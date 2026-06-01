import assert from "node:assert/strict";
import test from "node:test";
import {
  bestTcgcsvPrice,
  groupDisplayName,
  isSealedProduct,
  matchTcgcsvGroupsToSets,
  sealedProductType,
} from "../scripts/tcgcsv-sealed-products.mjs";

test("detects sealed products while excluding cards and code cards", () => {
  assert.equal(isSealedProduct({
    name: "Silver Tempest Booster Box",
    extendedData: [{ name: "CardText", value: "36 packs" }],
  }), true);
  assert.equal(isSealedProduct({
    name: "Code Card - Fall 2022 Collector Chest",
    extendedData: [{ name: "Rarity", value: "Code Card" }],
  }), false);
  assert.equal(isSealedProduct({
    name: "Lugia VSTAR",
    extendedData: [{ name: "Number", value: "139/195" }],
  }), false);
});

test("maps sealed product names to local product types", () => {
  assert.equal(sealedProductType("Silver Tempest Booster Box"), "BOOSTER_BOX");
  assert.equal(sealedProductType("Silver Tempest Elite Trainer Box"), "ELITE_TRAINER_BOX");
  assert.equal(sealedProductType("Mini Tin Display Case"), "CASE");
  assert.equal(sealedProductType("Three Pack Blister"), "BLISTER");
});

test("matches TCGCSV group names to local set names", () => {
  assert.deepEqual(
    matchTcgcsvGroupsToSets(
      [{ groupId: 3170, name: "SWSH12: Silver Tempest" }],
      [{ id: "set-1", name: "Silver Tempest" }],
    ),
    [{ group: { groupId: 3170, name: "SWSH12: Silver Tempest" }, set: { id: "set-1", name: "Silver Tempest" } }],
  );

  assert.equal(groupDisplayName("SWSH12: Silver Tempest"), "Silver Tempest");
});

test("selects the strongest usable TCGCSV sealed price", () => {
  assert.deepEqual(
    bestTcgcsvPrice([
      { lowPrice: 10, marketPrice: null, midPrice: 12, productId: 1, subTypeName: "Normal" },
      { lowPrice: 9, marketPrice: 11, midPrice: 12, productId: 1, subTypeName: "Damaged" },
    ]),
    {
      confidenceScore: 66,
      subTypeName: "Normal",
      usd: 12,
    },
  );
});
