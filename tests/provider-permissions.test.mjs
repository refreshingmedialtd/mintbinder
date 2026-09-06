import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertPriceChartingWriteAllowed,
  customerVisiblePriceSource,
  priceChartingLicenceConfirmed,
  restrictedCustomerPriceSources,
} from "../src/lib/pricing/provider-permissions.mjs";

test("requires an explicit true PriceCharting licence flag", () => {
  assert.equal(priceChartingLicenceConfirmed({}), false);
  assert.equal(priceChartingLicenceConfirmed({ PRICECHARTING_LICENCE_CONFIRMED: "false" }), false);
  assert.equal(priceChartingLicenceConfirmed({ PRICECHARTING_LICENCE_CONFIRMED: "TRUE" }), true);
});

test("hides licence-restricted and quarantined price sources", () => {
  assert.equal(customerVisiblePriceSource("tcgcsv", {}), true);
  assert.equal(customerVisiblePriceSource("pricecharting-sealed", {}), false);
  assert.equal(customerVisiblePriceSource("pricecharting-graded-card", {
    PRICECHARTING_LICENCE_CONFIRMED: "true",
  }), true);
  assert.equal(customerVisiblePriceSource("cardtrader-sealed-quarantined", {
    PRICECHARTING_LICENCE_CONFIRMED: "true",
  }), false);
  assert.deepEqual(restrictedCustomerPriceSources({}), [
    "pricecharting-graded-card",
    "pricecharting-sealed",
    "cardtrader-sealed-quarantined",
  ]);
  assert.deepEqual(restrictedCustomerPriceSources({ PRICECHARTING_LICENCE_CONFIRMED: "true" }), [
    "cardtrader-sealed-quarantined",
  ]);
});

test("rejects PriceCharting writes unless permission is confirmed", () => {
  assert.doesNotThrow(() => assertPriceChartingWriteAllowed({ writePrices: false }));
  assert.doesNotThrow(() => assertPriceChartingWriteAllowed({ licenceConfirmed: true, writePrices: true }));
  assert.throws(
    () => assertPriceChartingWriteAllowed({ licenceConfirmed: false, writePrices: true }),
    /PRICECHARTING_LICENCE_CONFIRMED=true/,
  );
});

test("customer-facing readiness coverage excludes restricted historical sources", () => {
  for (const relativePath of [
    "../scripts/report-catalogue-gaps.mjs",
    "../scripts/report-pricing-health.mjs",
    "../scripts/admin-qa-smoke.mjs",
    "../src/lib/jobs/catalogue-status.ts",
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");

    assert.match(source, /restrictedCustomerPriceSources\(process\.env\)/);
  }
});
