import assert from "node:assert/strict";
import test from "node:test";
import {
  booleanSetting,
  pageFromStatus,
  pageSetting,
  positiveInteger,
} from "../scripts/catalogue-batch-options.mjs";

test("parses positive integer environment values", () => {
  assert.equal(positiveInteger("20", 5), 20);
  assert.equal(positiveInteger("7.9", 5), 7);
  assert.equal(positiveInteger("", 5), 5);
  assert.equal(positiveInteger("-1", 5), 5);
});

test("recognizes auto page mode", () => {
  assert.equal(pageSetting("auto"), "auto");
  assert.equal(pageSetting(" AUTO "), "auto");
  assert.equal(pageSetting("36"), 36);
});

test("parses boolean environment values", () => {
  assert.equal(booleanSetting("true"), true);
  assert.equal(booleanSetting("1"), true);
  assert.equal(booleanSetting("yes"), true);
  assert.equal(booleanSetting("false", true), false);
  assert.equal(booleanSetting("0", true), false);
  assert.equal(booleanSetting("", true), true);
  assert.equal(booleanSetting("maybe", true), true);
});

test("resolves auto page from matching catalogue status", () => {
  assert.equal(
    pageFromStatus({
      status: {
        latestCatalogueResult: { query: "" },
        nextCataloguePage: 36,
      },
    }),
    36,
  );

  assert.equal(
    pageFromStatus(
      {
        status: {
          latestCatalogueResult: { query: "set.id:sv3pt5" },
          nextCataloguePage: 2,
        },
      },
      "set.id:sv3pt5",
    ),
    2,
  );
});

test("rejects auto page when status is missing or query mismatches", () => {
  assert.throws(() => pageFromStatus({ status: { nextCataloguePage: 36 } }, "set.id:sv3pt5"));
  assert.throws(() => pageFromStatus({ status: { latestCatalogueResult: { query: "" } } }));
});
